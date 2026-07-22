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
  CUDA DLLs are bundled for users with NVIDIA GPUs. On machines without a
  compatible NVIDIA driver, torch._load_dll_libraries() raises [WinError 127]
  at startup — CUDA_VISIBLE_DEVICES alone does NOT prevent this in newer PyTorch.

  Fix: probe for nvcuda.dll (the NVIDIA kernel driver DLL, present only when a
  compatible NVIDIA GPU driver is installed) before torch loads. If the probe
  succeeds the user has working CUDA — leave all DLLs in place so GPU is used.
  If it fails, rename the bundled CUDA DLLs so torch falls back to CPU cleanly.
"""

import os
import sys

if getattr(sys, "frozen", False):
    os.environ.setdefault("PYTORCH_JIT", "0")

    if sys.platform == "win32":
        import ctypes
        import pathlib

        _cuda_prefixes = (
            "torch_cuda", "libcuda", "libcublas", "libcufft", "libcurand",
            "libcusolver", "libcusparse", "libcudnn", "cudart64_", "cufft64_",
            "cublas64_", "cublaslt64_", "curand64_", "cusolver64_",
            "cusparse64_", "cudnn64_", "nvrtc", "nvToolsExt",
        )

        # Probe for a compatible NVIDIA driver. nvcuda.dll is the CUDA kernel
        # driver DLL shipped with NVIDIA GPU drivers — it is NOT part of the
        # CUDA Toolkit and cannot be bundled. Its presence means the driver
        # supports CUDA and torch_cuda.dll will load successfully.
        _cuda_available = False
        try:
            ctypes.WinDLL("nvcuda.dll")
            _cuda_available = True
        except OSError:
            pass

        if not _cuda_available:
            # No compatible NVIDIA driver — disable bundled CUDA DLLs so
            # torch._load_dll_libraries() falls back to CPU without crashing.
            _torch_lib = pathlib.Path(sys._MEIPASS) / "torch" / "lib"
            if _torch_lib.is_dir():
                for _dll in list(_torch_lib.glob("*.dll")):
                    if any(_dll.name.lower().startswith(p.lower()) for p in _cuda_prefixes):
                        try:
                            _dll.rename(_dll.with_name(_dll.name + ".disabled"))
                        except Exception:
                            pass
