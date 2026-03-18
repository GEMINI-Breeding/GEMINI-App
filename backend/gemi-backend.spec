# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files
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

# AgRowStitch + LightGlue (bundled as git submodules, installed into venv before build)
try:
    hiddenimports += collect_submodules('panorama_maker')
except Exception:
    pass
try:
    hiddenimports += collect_submodules('lightglue')
except Exception:
    pass

# PyTorch — required by AgRowStitch for image matching
# CPU-only build (~800 MB) is sufficient; exclude CUDA internals to reduce size
try:
    hiddenimports += collect_submodules('torch')
    hiddenimports += collect_submodules('torchvision')
except Exception:
    pass

# farm-ng-amiga — Amiga .bin extraction SDK
try:
    hiddenimports += collect_submodules('farm_ng')
except Exception:
    pass

# bin_to_images — vendored script (backend/bin_to_images/)
hiddenimports += collect_submodules('bin_to_images')

# Collect data files for packages that need them at runtime
datas = []
datas += collect_data_files('rasterio')   # bundled GDAL + PROJ data
datas += collect_data_files('pyproj')     # PROJ database (proj.db)
datas += collect_data_files('pyogrio')    # bundled GDAL/OGR drivers for GeoJSON I/O
datas += collect_data_files('shapely')    # Cython header stubs
datas += collect_data_files('certifi')    # CA certs (for HTTPS / Roboflow)

# AgRowStitch / LightGlue data files
try:
    datas += collect_data_files('lightglue')
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
    runtime_hooks=['hooks/rthook_proj.py'],
    excludes=[
        # Exclude heavy optional packages not needed at runtime
        'matplotlib', 'tkinter', 'wx', 'IPython', 'notebook',
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
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
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
