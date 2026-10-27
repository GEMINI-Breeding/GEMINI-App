"""The flight's other cameras beside a folder of frames (cluster_folder's same_flight)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gemi_agent.tools  # noqa: E402,F401  (the tools module loads hpc_tools in its order)
from gemi_agent import hpc_tools as H  # noqa: E402

ROOT = "/data/2026-08-17/DJI/DJI_202608170958_056/rgb_and_thermal_conv"


def peek(folder, names, n=None):
    body = "\n".join(names)
    return f"folder: {folder}\nentries: {n or len(names)}\n{body}\nfiles by type (two levels):\n   3 jpg\n"


LISTINGS = {
    ROOT: peek(ROOT, ["rgb", "run_params.txt", "thermal_conv", "weather_match.csv", "later_flight"]),
    f"{ROOT}/rgb": peek(f"{ROOT}/rgb", [f"DJI_2026081709591{i}_000{i}_V.JPG" for i in range(3, 8)], 1031),
    f"{ROOT}/thermal_conv": peek(f"{ROOT}/thermal_conv",
                                 [f"DJI_2026081709591{i}_000{i}_T.tif" for i in range(4, 9)], 1031),
    # Frames of another flight that day: not this flight's.
    f"{ROOT}/later_flight": peek(f"{ROOT}/later_flight", [f"DJI_2026081713001{i}_000{i}_T.tif" for i in range(5)]),
}


def main():
    H._gemi_hpc = lambda args, cluster, timeout=0: LISTINGS[args[1]]
    got = H.same_flight_folders(f"{ROOT}/rgb", LISTINGS[f"{ROOT}/rgb"], "c")
    assert got == [{"folder": f"{ROOT}/thermal_conv", "sensor": "Thermal", "files": 1031, "name_ends": "_T.tif",
                    "seconds_apart_at_start": 1.0}], got
    # A folder that is not camera frames has no companions.
    assert H.same_flight_folders(ROOT, LISTINGS[ROOT], "c") == []
    assert H._sensor_name("thermal_conv") == "Thermal" and H._sensor_name("MS") == "Multispectral"
    print("same flight ok")


if __name__ == "__main__":
    main()
