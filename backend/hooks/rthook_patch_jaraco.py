"""
Runtime hook — must run before pyi_rth_pkgres.

setuptools vendors jaraco.text, which reads 'Lorem ipsum.txt' at module
import time.  When PyInstaller bundles with a flat layout (contents_directory='.')
and Tauri's resource bundler omits subdirectories, that file is missing and
the import crashes before the app starts.

Patch Path.read_text to return a safe fallback for that specific file so the
import succeeds regardless of whether the file is present on disk.
"""
import pathlib

_orig_read_text = pathlib.Path.read_text


def _safe_read_text(self, *args, **kwargs):
    if self.name == "Lorem ipsum.txt":
        try:
            return _orig_read_text(self, *args, **kwargs)
        except FileNotFoundError:
            return "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
    return _orig_read_text(self, *args, **kwargs)


pathlib.Path.read_text = _safe_read_text
