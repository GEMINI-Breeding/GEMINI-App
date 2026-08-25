# exiftool (vendored)

Used by `backend/app/processing/thermal_utils.py` to copy GPS/timestamp EXIF
from a source DJI R-JPEG onto its converted GeoTIFF. Bundled here for the
same zero-config reason as `vendor/dji_thermal_sdk/` — end users shouldn't
need to install anything separately — but unlike the DJI SDK, **exiftool is
GPL/Artistic-licensed and freely redistributable**, so this was vendored
directly (no manual per-machine download step required, and no account/
license gate). It's gitignored purely to keep ~50MB of vendored binaries out
of git history, not for any legal reason.

## Layout

```
backend/vendor/exiftool/
├── macos_linux/
│   ├── exiftool     ← portable Perl script (run as `perl exiftool ...`,
│   │                   not executed directly — sidesteps needing it on
│   │                   PATH or marked +x in a frozen bundle)
│   └── lib/          ← Image::ExifTool Perl modules the script needs
└── windows/
    ├── exiftool(-k).exe
    └── exiftool_files/   ← bundled portable Perl + DLLs (no system Perl
                             needed on Windows at all)
```

`macos_linux/` only needs a `perl` binary on PATH — present by default on
macOS and virtually every Linux distro. If genuinely absent, thermal
conversion still works fine; the app just skips the GPS/timestamp EXIF copy
and logs a warning, same graceful-degradation behavior as before this was
bundled.

## Updating to a newer exiftool version

Currently vendored: **13.59** (May 2026). To update:

1. Download from https://exiftool.org/ :
   - `Image-ExifTool-<version>.tar.gz` — extract, copy `exiftool` and `lib/`
     into `macos_linux/` (`chmod +x exiftool`).
   - `exiftool-<version>_64.zip` — extract, copy the whole contents into
     `windows/`.
2. Sanity check: `perl backend/vendor/exiftool/macos_linux/exiftool -ver`
   should print the new version number.

`gemi-backend.spec` bundles whatever's in this folder into packaged builds
automatically — no other changes needed for a version bump.
