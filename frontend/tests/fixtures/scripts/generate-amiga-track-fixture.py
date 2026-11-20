"""
Cut a short, time-aligned window out of a real Amiga log for ground-pipeline
tests: binary/2024_07_15_15_49_18_998387_track-fixture.0000.bin.

The name matters: the extractor derives its base timestamp from farm-ng's
`YYYY_MM_DD_HH_MM_SS_<micros>_<name>.0000.bin` form and refuses anything
else ("File name is not compatible with this script").

The older fixture (generate-amiga-fixture.py) keeps the *first* few events
of each topic, so its two GPS fixes never bracket a camera frame and GPS
sync yields an empty msgs_synced.csv. This one keeps everything the
pipeline needs from the same stretch of the pass:

  * every GPS message (pvt, relposned, ecef) and IMU sample in the window,
    padded by PAD_S each side so every kept frame has a fix before and after
  * every STRIDE-th frame of the top camera (oak0) — the stitching camera
  * all three camera calibrations (the extractor reads them)
  * no disparity (large, unused by stitching)

Runs anywhere farm_ng.core is installed, e.g. the amiga worker:

    docker cp <source>.0000.bin geminibase-worker-amiga:/tmp/src.0000.bin
    docker cp generate-amiga-track-fixture.py geminibase-worker-amiga:/tmp/
    docker exec geminibase-worker-amiga python /tmp/generate-amiga-track-fixture.py \\
        /tmp/src.0000.bin /tmp/2024_07_15_15_49_18_998387_track-fixture
    docker cp geminibase-worker-amiga:/tmp/2024_07_15_15_49_18_998387_track-fixture.0000.bin ../binary/

Result (12 s window): 30 top-camera frames, 35 GPS fixes of each kind,
and a 30-row msgs_synced.csv with lat/lon and direction.

Source used: ExampleDatasets/Subset Amiga Data/2024-07-15/Onboard/
             2024_07_15_15_49_18_998387_moats-unproved.0000.bin
"""
import sys

from farm_ng.core.events_file_reader import EventsFileReader, build_events_dict
from farm_ng.core.events_file_writer import EventsFileWriter

WINDOW_START_FRACTION = 0.45  # start ~mid-pass, where the rover is moving
WINDOW_S = 12.0
PAD_S = 1.0
STRIDE = 4  # keep every 4th top-camera frame (~2.5 fps)


def stamp(e) -> float:
    return e.event.timestamps[0].stamp if e.event.timestamps else 0.0


def main(src: str, out_base: str) -> None:
    reader = EventsFileReader(src)
    if not reader.open():
        sys.exit(f"cannot open {src}")
    events = build_events_dict(reader.get_index())

    gps = events["/gps/pvt"]
    t_first, t_last = stamp(gps[0]), stamp(gps[-1])
    t0 = t_first + (t_last - t_first) * WINDOW_START_FRACTION
    t1 = t0 + WINDOW_S

    plan = {}
    for topic, evs in events.items():
        if "calibration" in topic:
            plan[topic] = evs[:1]
        elif topic.startswith("/gps/") or topic.endswith("/imu"):
            plan[topic] = [e for e in evs if t0 - PAD_S <= stamp(e) <= t1 + PAD_S]
        elif topic == "/oak0/rgb":
            plan[topic] = [e for e in evs if t0 <= stamp(e) <= t1][::STRIDE]
        # everything else (other cameras' frames, disparity) is dropped

    writer = EventsFileWriter(file_base=out_base)
    if not writer.open():
        sys.exit("cannot open writer")

    def put(e):
        writer.write(
            path=e.event.uri.path,
            message=e.read_message(),
            timestamps=list(e.event.timestamps),
        )

    # Calibrations first (as headers, like the original fixture), then
    # everything else in timestamp order across topics, as a real log is.
    for topic, evs in plan.items():
        if "calibration" in topic:
            for e in evs:
                put(e)
    rest = sorted(
        (e for topic, evs in plan.items() if "calibration" not in topic for e in evs),
        key=stamp,
    )
    for e in rest:
        put(e)
    writer.close()
    counts = {t: len(v) for t, v in plan.items() if v}
    print(f"window {t0:.1f}-{t1:.1f} s: {counts}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
