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
  CUDA DLLs are bundled but their system dependencies (NVIDIA CUDA runtime
  DLLs like nvcuda.dll) aren't present on machines without a GPU or without
  the exact CUDA toolkit version PyTorch was built against. Windows raises
  [WinError 127] which can propagate as an unhandled exception.

  Fix: CUDA_VISIBLE_DEVICES="" tells PyTorch's initialization to skip CUDA
  device enumeration, preventing the DLL load attempt at startup.
"""

import os
import sys

if getattr(sys, "frozen", False):
    os.environ.setdefault("PYTORCH_JIT", "0")
    # Force CPU-only mode — prevents torch_cuda.dll load attempt on machines
    # without the NVIDIA CUDA runtime. Users who need GPU can override this
    # by setting CUDA_VISIBLE_DEVICES before launching the app.
    if "CUDA_VISIBLE_DEVICES" not in os.environ:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
