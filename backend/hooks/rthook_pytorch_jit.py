"""
Runtime hook — fix PyTorch issues in frozen PyInstaller bundles on Windows.

Problem 1 — TorchScript JIT crash:
  kornia applies @torch.jit.script at import time, which calls
  inspect.getsource(). PyInstaller freezes .py to .pyc bytecode so
  getsource() raises OSError and the import crashes with:
  "Can't get source for <function ...>. TorchScript requires source access."

  Fix: PYTORCH_JIT=0 makes @torch.jit.script a no-op — functions run as
  plain Python. Performance impact is negligible for our LightGlue usage.

Problem 2 — torch_cuda.dll load failure ([WinError 127]):
  torch/__init__.py::_load_dll_libraries() globs *every* .dll in torch/lib and
  loads each one via kernel32.LoadLibraryExW at import time — there is no CUDA
  check and no device enumeration. ERROR_MOD_NOT_FOUND (126) is tolerated, but
  ERROR_PROC_NOT_FOUND (127) raises immediately. So a torch_cuda.dll whose
  dependency chain is unsatisfiable crashes `import torch` outright, long
  before any device selection happens. This is why neither CUDA_VISIBLE_DEVICES
  nor selecting CPU mode avoids it.

  Notably this fires even on machines that DO have an NVIDIA GPU and driver —
  nvcuda.dll loading successfully says nothing about whether torch_cuda.dll's
  own imports resolve. So the driver's presence is not a usable proxy.

  Fix: replicate torch's own load test against torch_cuda.dll before torch is
  imported. If it loads, leave everything alone so the GPU is used. If it
  fails, patch glob.glob so the CUDA DLLs are filtered out of the list
  _load_dll_libraries() iterates, and torch imports CPU-only.

  glob filtering is used rather than renaming the files because it needs no
  write access to the install directory (per-machine installs under
  Program Files are read-only for a non-elevated process) and mutates nothing
  on disk, so the same bundle still works if the driver is fixed later.
"""

import os
import sys

if getattr(sys, "frozen", False):
    os.environ.setdefault("PYTORCH_JIT", "0")

    if sys.platform == "win32":
        import ctypes
        import glob as _glob_mod
        import os.path as _osp

        # Lowercase — compared against a lowercased filename below.
        # Deliberately broad (e.g. "cudnn" not "cudnn64_") so the list does not
        # depend on wheel-specific version suffixes: cuDNN 9 ships split libs
        # (cudnn_graph64_9.dll, cudnn_ops64_9.dll, ...) and cuBLAS ships
        # cublasLt64_*.dll alongside cublas64_*.dll.
        _CUDA_PREFIXES = (
            "torch_cuda", "c10_cuda", "caffe2_nvrtc",
            "cudnn", "cublas", "cudart", "cufft", "curand",
            "cusolver", "cusparse", "cupti", "cufile",
            "nvrtc", "nvtoolsext", "nvjitlink", "nvfuser",
            "libcu",  # linux-style names occasionally present in wheels
        )

        def _is_cuda_dll(path):
            name = _osp.basename(path).lower()
            return name.endswith(".dll") and name.startswith(_CUDA_PREFIXES)

        _torch_lib = _osp.join(sys._MEIPASS, "torch", "lib")
        _probe = _osp.join(_torch_lib, "torch_cuda.dll")

        if _osp.isdir(_torch_lib) and _osp.exists(_probe):
            # Mirror what _load_dll_libraries() does: put torch/lib on the DLL
            # search path first, then LoadLibraryExW with the same flags
            # (LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | ..._DLL_LOAD_DIR).
            try:
                os.add_dll_directory(_torch_lib)
            except Exception:
                pass

            _kernel32 = ctypes.WinDLL("kernel32.dll", use_last_error=True)
            _kernel32.LoadLibraryExW.restype = ctypes.c_void_p
            _prev_mode = _kernel32.SetErrorMode(0x0001)  # suppress the error dialog
            try:
                _handle = _kernel32.LoadLibraryExW(_probe, None, 0x00001100)
                _cuda_ok = _handle is not None
            except Exception:
                _cuda_ok = False
            finally:
                _kernel32.SetErrorMode(_prev_mode)

            if not _cuda_ok:
                # Hide the CUDA DLLs from _load_dll_libraries()'s glob so torch
                # imports CPU-only instead of raising on the broken DLL.
                _orig_glob = _glob_mod.glob

                def _glob_without_cuda(pathname, *args, **kwargs):
                    results = _orig_glob(pathname, *args, **kwargs)
                    if pathname.lower().endswith("*.dll"):
                        results = [r for r in results if not _is_cuda_dll(r)]
                    return results

                _glob_mod.glob = _glob_without_cuda
                # Signal to app code that GPU is unavailable in this process.
                os.environ["GEMI_CUDA_DISABLED"] = "1"
                os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
