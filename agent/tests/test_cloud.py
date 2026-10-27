"""Online storage: the words sent to the cluster's gate, rclone's progress
lines, which files a copy keeps, and where orthomosaics and DEMs are filed."""
import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemi_agent import cloud, uploads  # noqa: E402


def gate_decode(word: str) -> str:
    """What the gate's b64word does."""
    if word == ".":
        return ""
    return base64.urlsafe_b64decode(word + "=" * (-len(word) % 4)).decode()


# A remote path is one word of the gate's characters, and comes back unchanged.
for p in ["Kearney 2022/orthos (final)", "Été/données", "a", "x/y/z.tif"]:
    w = cloud.encode_path(p)
    assert all(c.isalnum() or c in "-_" for c in w), w
    assert gate_decode(w) == p, (p, w)
assert cloud.encode_path("") == "." and cloud.encode_path("/") == "."
assert gate_decode(cloud.encode_path("/top/sub/")) == "top/sub"

# Settings: plain ones as they are, others (spaces) encoded; the uploader decodes them.
assert uploads.encode_setting("Kearney") == "Kearney"
enc = uploads.encode_setting("Interspecific Kearney")
assert enc.startswith("b64:") and " " not in enc
assert uploads.decode_setting(enc) == "Interspecific Kearney"
assert uploads.decode_setting("2022-08-23") == "2022-08-23"
assert uploads.decode_setting(uploads.encode_setting("b64:literal")) == "b64:literal"

# rclone's one-line stats, from a log line.
line = "2024/11/20 10:00:00 NOTICE:   1.234 GiB / 6.300 GiB, 19%, 50.1 MiB/s, ETA 1m42s"
assert cloud.progress_line(line) == "1.234 GiB / 6.300 GiB, 19%, 50.1 MiB/s, ETA 1m42s"
assert cloud.progress_line("2024/11/20 10:00:00 INFO  : a.tif: Copied (new)") is None

# What a copy keeps: the data type's files, or the name endings asked for.
assert "*.tif" in cloud.includes("orthomosaic") and "*.bin" not in cloud.includes("orthomosaic")
assert cloud.includes("images", "_V.JPG, _N.JPG") == ["*_V.JPG", "*_N.JPG"]
assert cloud.includes("") == []

# Connection names.
assert cloud.check_name(" KBox ") == "kbox"
for bad in ["1box", "a b", "", "x" * 40, "a/b"]:
    try:
        cloud.check_name(bad)
        raise AssertionError(bad)
    except ValueError:
        pass

# Elevation models are told from orthomosaics by name.
for n in ["2022-08-23-DEM.tif", "odm_dem_dsm.tif", "field_DSM.TIF", "dtm.tif", "elevation.tif"]:
    assert uploads.is_elevation(n), n
for n in ["2022-08-23-RGB.tif", "odm_orthophoto.tif", "demeter_site.tif", "academy.tif"]:
    assert not uploads.is_elevation(n), n

# Every provider the app offers is one the cluster's gate accepts.
gate = (Path(__file__).resolve().parents[2] / "hpc" / "remote" / "gemi-gate").read_text()
for p in cloud.PROVIDERS:
    assert f" {p['type']} " in gate.split("cloud-add)")[1].split("refuse")[0] + " ", p["type"]
    for f in p.get("fields", []):
        assert f["key"] in gate.split("cloud-add)")[1].split("audit CONFIG")[0], f["key"]

print("cloud ok")
