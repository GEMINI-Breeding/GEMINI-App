# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files, copy_metadata
import os, sys

block_cipher = None

hiddenimports = [
    # Uvicorn internals
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    # App modules
    'app.api.main',
    'app.api.deps',
    'app.api.routes.login',
    'app.api.routes.users',
    'app.api.routes.items',
    'app.api.routes.utils',
    'app.api.routes.private',
    'app.api.routes.files',
    'app.api.routes.app_settings',
    'app.api.routes.workspaces',
    'app.api.routes.pipelines',
    'app.api.routes.processing',
    'app.api.routes.analyze',
    'app.api.routes.agml_datasets',
    'app.core.config',
    'app.core.db',
    'app.core.security',
    'app.core.paths',
    'app.models',
    'app.models.user',
    'app.models.item',
    'app.models.file_upload',
    'app.models.app_settings',
    'app.models.common',
    'app.models.workspace',
    'app.models.pipeline',
    'app.models.agml_dataset',
    'app.crud',
    'app.crud.user',
    'app.crud.item',
    'app.crud.file_upload',
    'app.crud.app_settings',
    'app.crud.workspace',
    'app.crud.pipeline',
    'app.processing.runner',
    'app.processing.ground',
    'app.processing.aerial',
    'app.processing.geo_utils',
    'app.processing.inference_utils',
    'app.processing.agml_utils',
    # Core dependencies
    'email_validator',
    'passlib.handlers.bcrypt',
    'bcrypt',
    'sqlmodel',
    'pydantic',
    'pydantic_settings',
    'aiosqlite',
    'sqlite3',
    'jwt',
    'jwt.exceptions',
    'sentry_sdk',
    # Processing dependencies
    'PIL',
    'PIL.Image',
    'PIL.ExifTags',
    'rasterio',
    'rasterio.windows',
    'rasterio.transform',
    'rasterio.crs',
    'rasterio.merge',
    'rasterio.enums',
    'pyproj',
    'geopandas',
    'shapely',
    'shapely.geometry',
    'cv2',
    'numpy',
    'scipy',
    'scipy.ndimage',
    'yaml',
    'zipfile',
    'csv',
    'threading',
    'subprocess',
    'tempfile',
    # Geo I/O — geopandas uses pyogrio (no fiona) for GeoJSON read/write
    'pyogrio',
    'pyogrio._io',
    'pyogrio._env',
    'pyogrio._geometry',
    'pyogrio.geopandas',
]

# Collect all submodules for complex packages
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('pydantic_core')
hiddenimports += collect_submodules('sqlmodel')
hiddenimports += collect_submodules('fastapi')
hiddenimports += collect_submodules('starlette')
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('sentry_sdk')
hiddenimports += collect_submodules('rasterio')
hiddenimports += collect_submodules('pyproj')
hiddenimports += collect_submodules('shapely')
hiddenimports += collect_submodules('geopandas')
hiddenimports += collect_submodules('pyogrio')

# AgRowStitch — single-file module (AgRowStitch.py), installed via pip install -e vendor/AgRowStitch
try:
    hiddenimports += ['AgRowStitch']
except Exception:
    pass
# LightGlue (dependency of AgRowStitch) — installed via pyproject.toml (git dep)
try:
    hiddenimports += collect_submodules('lightglue')
except Exception as e:
    import warnings
    warnings.warn(f"lightglue not found — stitching will be broken in the built app: {e}", stacklevel=1)

# PyTorch — required by AgRowStitch for image matching
# CUDA DLLs are stripped from a.binaries after Analysis (see below) — machines
# without NVIDIA CUDA runtime get [WinError 127] if they are present.
try:
    hiddenimports += collect_submodules('torch')
    hiddenimports += collect_submodules('torchvision')
except Exception:
    pass

# ultralytics — local YOLO weights inference (detection/segmentation)
try:
    hiddenimports += collect_submodules('ultralytics')
except Exception as e:
    import warnings
    warnings.warn(f"ultralytics not found — local weights inference will be broken in the built app: {e}", stacklevel=1)

# transformers + timm — local HuggingFace model inference (pipeline-based)
try:
    hiddenimports += collect_submodules('transformers')
    hiddenimports += collect_submodules('timm')
except Exception as e:
    import warnings
    warnings.warn(f"transformers/timm not found — HuggingFace inference will be broken in the built app: {e}", stacklevel=1)

# onnx / onnxruntime / onnxslim — .onnx exports of Ultralytics local-weights models
try:
    hiddenimports += collect_submodules('onnxruntime')
    hiddenimports += collect_submodules('onnx')
    hiddenimports += collect_submodules('onnxslim')
except Exception as e:
    import warnings
    warnings.warn(f"onnx/onnxruntime not found — .onnx local weights inference will be broken in the built app: {e}", stacklevel=1)

# agml — public agricultural dataset catalog (metadata/discovery only, no
# training). Pulls in HF `datasets` (+ pyarrow) and `albumentations`.
try:
    hiddenimports += collect_submodules('agml')
except Exception as e:
    import warnings
    warnings.warn(f"agml not found — AgML dataset browsing will be broken in the built app: {e}", stacklevel=1)

try:
    hiddenimports += collect_submodules('datasets')
    hiddenimports += collect_submodules('pyarrow')
except Exception as e:
    import warnings
    warnings.warn(f"datasets/pyarrow not found — AgML dataset browsing will be broken in the built app: {e}", stacklevel=1)

try:
    hiddenimports += collect_submodules('albumentations')
except Exception:
    pass

# dji_thermal_sdk — thin ctypes wrapper for the proprietary DJI Thermal SDK
# native library (libdirp.so/.dll). The wrapper itself is a small pip package
# (no native binary bundled); the actual .so/.dll is downloaded separately by
# the user and its folder configured via Settings — this only needs to
# ensure the ctypes wrapper module itself is bundled.
try:
    hiddenimports += collect_submodules('dji_thermal_sdk')
except Exception as e:
    import warnings
    warnings.warn(f"dji_thermal_sdk not found — thermal image conversion will be broken in the built app: {e}", stacklevel=1)

# farm-ng-amiga — Amiga .bin extraction SDK
try:
    hiddenimports += collect_submodules('farm_ng')
except Exception:
    pass

# bin_to_images — vendored script (backend/bin_to_images/)
try:
    hiddenimports += collect_submodules('bin_to_images')
except Exception:
    pass

# kornia + kornia_rs — used by bin_to_images for image decoding
try:
    hiddenimports += collect_submodules('kornia')
    hiddenimports += collect_submodules('kornia_rs')
except Exception:
    pass

# google.protobuf — used by farm_ng for event file parsing
try:
    hiddenimports += collect_submodules('google.protobuf')
except Exception:
    pass

# pandas + tqdm — used by bin_to_images
try:
    hiddenimports += collect_submodules('pandas')
    hiddenimports += ['tqdm', 'tqdm.auto']
except Exception:
    pass

# Collect data files for packages that need them at runtime
datas = []

# Docker build context for Windows .bin extraction — bundled so the app can
# build the gemi-bin-extractor image automatically on first use.
datas += [
    ('docker/bin-extractor/Dockerfile',        'docker/bin-extractor'),
    ('docker/bin-extractor/run_extraction.py', 'docker/bin-extractor'),
    # bin_to_images source (no setup.py — copied directly into the Docker context)
    ('bin_to_images/bin_to_images.py', 'docker/bin-extractor/bin_to_images'),
    ('bin_to_images/__init__.py',       'docker/bin-extractor/bin_to_images'),
]

# Docker build context for DJI thermal conversion on macOS — DJI ships no
# native macOS library, so the app runs it in a small Linux container built
# from this context (see backend/app/processing/thermal_utils.py:
# _convert_dji_rjpeg_docker). No proprietary code is bundled here — the
# vendored libdirp.so (see dji_thermal_sdk vendoring below) is bind-mounted
# into the container at run time, not baked into this image.
datas += [
    ('docker/dji-thermal/Dockerfile',       'docker/dji-thermal'),
    ('docker/dji-thermal/measure_rjpeg.py', 'docker/dji-thermal'),
]

# farm_ng_core / farm_ng_amiga — bin_to_images uses importlib.metadata to find these;
# copy_metadata includes the .dist-info so PackageNotFoundError doesn't occur at runtime.
try:
    datas += copy_metadata('farm_ng_core')
except Exception:
    pass
try:
    datas += copy_metadata('farm_ng_amiga')
except Exception:
    pass

# transformers/timm/huggingface_hub use importlib.metadata to check optional-dep
# versions at import time (same class of issue as farm_ng_core above).
for _pkg in ('transformers', 'timm', 'huggingface_hub', 'tokenizers', 'safetensors'):
    try:
        datas += copy_metadata(_pkg)
    except Exception:
        pass

# agml's bundled dataset catalog + benchmark JSON files (agml/_assets/*.json)
# are loaded via package-relative paths at runtime — same class of gotcha as
# ultralytics' YAML configs (see docs/INSTRUCTIONS.md): without bundling
# these as datas, the dataset browser/leaderboard will be empty in the
# frozen app even though `import agml` succeeds.
try:
    datas += collect_data_files('agml')
except Exception as e:
    import warnings
    warnings.warn(f"agml data files not found — dataset catalog will be empty in the built app: {e}", stacklevel=1)

# datasets/pyarrow/dill/multiprocess/xxhash/fsspec use importlib.metadata for
# optional-dep version checks at import time (same class of issue as above).
for _pkg in ('datasets', 'pyarrow', 'dill', 'multiprocess', 'xxhash', 'fsspec'):
    try:
        datas += copy_metadata(_pkg)
    except Exception:
        pass

datas += collect_data_files('setuptools')  # jaraco.text data files needed by pkg_resources hook
datas += collect_data_files('rasterio')   # bundled GDAL + PROJ data
datas += collect_data_files('pyproj')     # PROJ database (proj.db)
datas += collect_data_files('pyogrio')    # bundled GDAL/OGR drivers for GeoJSON I/O
datas += collect_data_files('shapely')    # Cython header stubs
datas += collect_data_files('certifi')    # CA certs (for HTTPS / Roboflow)

# AgRowStitch.py — single-file module; explicitly copy it into the bundle root
# so `import AgRowStitch` works even if the editable install wasn't detected by
# PyInstaller during analysis.  sys._MEIPASS (the bundle root) is on sys.path.
_ars_src = 'vendor/AgRowStitch/AgRowStitch.py'
_ars_cfg = 'vendor/AgRowStitch/config.yaml'
if os.path.exists(_ars_src):
    # Bundle into vendor/AgRowStitch/ so Path(__file__).parent.parent.parent / "vendor/AgRowStitch"
    # resolves correctly inside the frozen app.  _find_agrowstitch_dir() finds AgRowStitch.py
    # there, and run_server.py adds that dir to sys.path for the subprocess import.
    datas += [(_ars_src, 'vendor/AgRowStitch')]
if os.path.exists(_ars_cfg):
    datas += [(_ars_cfg, 'vendor/AgRowStitch')]

# DJI Thermal SDK native library — vendored (not pip-installable, DJI-licensed).
# Bundled into the packaged app so end users need zero separate install step;
# DJI's EULA (https://developer.dji.com/policies/eula/) explicitly permits
# shipping the SDK's object code, execution-form-only, as part of a compiled
# Application. Not committed to git (see backend/vendor/dji_thermal_sdk/README.md)
# — this block is a no-op (warns, doesn't fail the build) until a maintainer
# places the actual libdirp.so/.dll there per that README.
_dji_sdk_root = 'vendor/dji_thermal_sdk/utility/bin'
if os.path.isdir(_dji_sdk_root):
    for _dji_dirpath, _dji_dirnames, _dji_filenames in os.walk(_dji_sdk_root):
        for _dji_fname in _dji_filenames:
            _dji_src = os.path.join(_dji_dirpath, _dji_fname)
            # Mirror the source tree under vendor/dji_thermal_sdk/utility/bin/...
            # so _bundled_dji_sdk_dir()'s expected relative path resolves inside
            # sys._MEIPASS exactly as it does in dev mode under backend/vendor/.
            _dji_dest = os.path.join('vendor/dji_thermal_sdk', os.path.relpath(_dji_dirpath, 'vendor/dji_thermal_sdk'))
            datas += [(_dji_src, _dji_dest)]
else:
    import warnings
    warnings.warn(
        "backend/vendor/dji_thermal_sdk/utility/bin not found — DJI thermal "
        "conversion will report unavailable in the built app until the SDK is "
        "vendored locally (see backend/vendor/dji_thermal_sdk/README.md).",
        stacklevel=1,
    )

# exiftool — vendored (GPL/Artistic-licensed, freely redistributable, unlike
# the DJI SDK above). Bundled so GPS/timestamp EXIF gets copied onto
# converted thermal GeoTIFFs with zero separate install step. Not committed
# to git (see backend/vendor/exiftool/README.md) purely to keep ~50MB of
# binaries out of git history — this block is a no-op (warns, doesn't fail
# the build) until vendored locally per that README.
_exiftool_root = 'vendor/exiftool'
if os.path.isdir(_exiftool_root) and (
    os.path.isdir(os.path.join(_exiftool_root, 'macos_linux'))
    or os.path.isdir(os.path.join(_exiftool_root, 'windows'))
):
    for _et_dirpath, _et_dirnames, _et_filenames in os.walk(_exiftool_root):
        for _et_fname in _et_filenames:
            _et_src = os.path.join(_et_dirpath, _et_fname)
            # Mirror the source tree under vendor/exiftool/... so
            # _bundled_exiftool_dir()'s expected relative path resolves
            # inside sys._MEIPASS exactly as it does in dev mode.
            _et_dest = os.path.join('vendor/exiftool', os.path.relpath(_et_dirpath, _exiftool_root))
            datas += [(_et_src, _et_dest)]
else:
    import warnings
    warnings.warn(
        "backend/vendor/exiftool/{macos_linux,windows} not found — converted "
        "thermal images won't get GPS/timestamp EXIF copied in the built app "
        "until exiftool is vendored locally (see backend/vendor/exiftool/README.md).",
        stacklevel=1,
    )

# AgRowStitch / LightGlue data files + Python source files.
# LightGlue imports kornia which uses torch.jit.script — include source for same reason.
try:
    datas += collect_data_files('lightglue', include_py_files=True)
except Exception as e:
    import warnings
    warnings.warn(f"lightglue data files not found — stitching will be broken in the built app: {e}", stacklevel=1)

# kornia / kornia_rs data files + Python source files.
# kornia uses @torch.jit.script at import time, which calls inspect.getsource().
# PyInstaller freezes .py to .pyc so source lookup fails unless we also ship the
# originals. include_py_files=True copies them as data alongside the bytecode.
try:
    datas += collect_data_files('kornia', include_py_files=True)
except Exception:
    pass
try:
    datas += collect_data_files('kornia_rs')
except Exception:
    pass

# ultralytics data files + Python source files. ultralytics loads its YAML
# configs (default.yaml, per-task/model YAMLs under ultralytics/cfg/) via
# paths relative to the package's __file__ at runtime — these must be shipped
# as datas, not just hiddenimports, or model loading fails with
# FileNotFoundError in the frozen app even though `import ultralytics` succeeds.
try:
    datas += collect_data_files('ultralytics', include_py_files=True)
except Exception as e:
    import warnings
    warnings.warn(f"ultralytics data files not found — local weights inference will be broken in the built app: {e}", stacklevel=1)

# google.protobuf descriptor pool data files
try:
    datas += collect_data_files('google.protobuf')
except Exception:
    pass

# pandas data files (timezone data, etc.)
try:
    datas += collect_data_files('pandas')
except Exception:
    pass

# PyTorch data files (pretrained weights path registry, version info, etc.)
try:
    datas += collect_data_files('torch', includes=['**/*.yaml', '**/*.json', '**/*.bin'])
except Exception:
    pass

a = Analysis(
    ['run_server.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=['hooks'],
    hooksconfig={},
    runtime_hooks=['hooks/rthook_patch_jaraco.py', 'hooks/rthook_proj.py', 'hooks/rthook_pytorch_jit.py'],
    excludes=[
        # Exclude heavy optional packages not needed at runtime
        # NOTE: matplotlib is NOT excluded — supervision/draw/color.py imports it at top level
        'tkinter', 'wx', 'IPython', 'notebook',
        'pytest',
        # NOTE: do NOT exclude 'setuptools' or 'distutils' — on Python 3.12,
        # PyInstaller's hook-distutils.py aliases distutils → setuptools._distutils,
        # and excluding distutils first causes a conflict that crashes the build.
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)


# Strip CUDA DLLs from the Windows bundle.
# torch_cuda.dll and its siblings depend on nvcuda.dll from the NVIDIA driver,
# which is NOT present on machines without a GPU or without the matching CUDA
# toolkit. If bundled, Windows raises [WinError 127] at startup.
# The runtime hook sets CUDA_VISIBLE_DEVICES="" so PyTorch doesn't need them.
if sys.platform == 'win32':
    _cuda_prefixes = (
        'torch_cuda', 'libcuda', 'libcublas', 'libcufft', 'libcurand',
        'libcusolver', 'libcusparse', 'libcudnn', 'cudart', 'cufft64_',
        'cublas64_', 'cublaslt64_', 'curand64_', 'cusolver64_',
        'cusparse64_', 'cudnn64_', 'nvrtc', 'nvToolsExt',
    )
    a.binaries = [
        b for b in a.binaries
        if not any(os.path.basename(b[0]).lower().startswith(p.lower()) for p in _cuda_prefixes)
    ]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# --onedir mode: EXE gets exclude_binaries=True; COLLECT gathers everything.
# This avoids the 4 GB CArchive limit that --onefile hits when bundling PyTorch.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='gemi-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # Flat layout: all collected files sit next to the executable rather than
    # in a subdirectory called _internal/. Tauri's resource bundling flattens
    # directory hierarchies, so _internal/ never reaches the .app bundle —
    # using '.' keeps the bootloader and Python library at the same level.
    contents_directory='.',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name='gemi-backend',
)
