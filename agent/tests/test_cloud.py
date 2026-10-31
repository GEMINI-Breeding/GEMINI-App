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
# One date's files of a folder of several dates.
assert cloud.includes("orthomosaic", "", "2023-06-15") == ["*2023-06-15*.tif", "*2023-06-15*.tiff"]
assert cloud.includes("orthomosaic", "_DEM.tif", "2023-06-15") == ["*2023-06-15*_DEM.tif"]
assert cloud.includes("", "", "20230615") == ["*20230615*"]

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

# Platform and sensor come from a fixed list (they choose the processing).
from gemi_agent.uploads import check_kit  # noqa: E402

assert check_kit("drone", "rgb") == ("Drone", "RGB")
assert check_kit("Rover", "RGB - Sony A7R") == ("Rover", "RGB-SonyA7R")
for bad in (("P4", "RGB"), ("Drone", "FC6310"), ("Amiga", "RGB")):
    try:
        check_kit(*bad)
        raise AssertionError(f"{bad} accepted")
    except ValueError:
        pass
print("kit ok")

# A cluster copy refused for want of a job slot waits, and starts by itself once one frees.
import tempfile  # noqa: E402
from pathlib import Path  # noqa: E402

cloud.WAITING = Path(tempfile.mkdtemp())
cloud._WAIT_SECONDS = 0
calls = {"n": 0}


def fake_submit(words, cluster):
    calls["n"] += 1
    if calls["n"] < 3:
        raise cloud.JobSlotsFull("refused by the job limits")
    return "4242"


cloud._submit_cluster_copy = fake_submit
rec = cloud._wait_for_slot(["cloud", "fetch", "box", "x", "d"], "c", "d", "box:x", "2023-07-20")
assert rec["state"] == "WAITING" and rec["id"].startswith("w") and "words" not in rec
import time as _t  # noqa: E402

for _ in range(50):
    if calls["n"] >= 3:
        break
    _t.sleep(0.05)
_t.sleep(0.1)
saved = __import__("json").loads((cloud.WAITING / f"{rec['id']}.json").read_text())
assert saved["job_id"] == "4242" and saved["state"] == "QUEUED", saved
print("waiting ok")

# The same files uploaded again are not sent twice (another camera's folder does not count).
from gemi_agent import uploads as U  # noqa: E402


class FakeClient:
    def list_page(self, prefix, limit, offset):
        return {"total_count": 3, "files": [
            {"object_name": "Raw/2023/E/K/P/2023-07-20/Drone/RGB/Orthomosaic/2023-07-20-RGB.tif", "size": 10},
            {"object_name": "Raw/2023/E/K/P/2023-07-20/Drone/RGB/Orthomosaic-DEM/2023-07-20-DEM.tif", "size": 5},
            {"object_name": "Raw/2023/E/K/P/2023-07-20/Drone/RGB-SonyA7R/ab12cd34/Images/x.jpg", "size": 7},
        ]}


have = U.already_uploaded(FakeClient(), "Raw/2023/E/K/P/2023-07-20/Drone/RGB/")
assert have == {("2023-07-20-RGB.tif", 10), ("2023-07-20-DEM.tif", 5)}, have
print("dedupe ok")


def test_filter_rules_skip_names_in_the_app_then_keep_the_includes():
    from gemi_agent import cloud

    rules = cloud.filter_rules(["*.tif"], {"2023-07-27-RGB.tif", "odd [1].tif"}).splitlines()
    assert rules == ["- 2023-07-27-RGB.tif", "- odd \\[1\\].tif", "+ *.tif", "- **"]
    # No include patterns: everything else is copied.
    assert cloud.filter_rules([], {"a.JPG"}).splitlines() == ["- a.JPG"]


def test_in_app_names_looks_in_the_upload_scope(monkeypatch):
    from gemi_agent import cloud, uploads

    seen = {}
    monkeypatch.setattr(uploads, "already_uploaded",
                        lambda client, prefix: seen.setdefault("p", prefix) and {("a.tif", 5), ("b.tif", 7)})
    names = cloud.in_app_names(None, {"experiment": "Interspecific Kearney", "site": "Kearney",
                                      "population": "Interspecific", "date": "2023-08-03",
                                      "platform": "Drone", "sensor": "RGB"})
    assert names == {"a.tif", "b.tif"}
    assert seen["p"] == "Raw/2023/Interspecific Kearney/Kearney/Interspecific/2023-08-03/Drone/RGB/"
