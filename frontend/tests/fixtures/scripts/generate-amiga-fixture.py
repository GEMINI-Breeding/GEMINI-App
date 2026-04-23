"""
Generate a minimal Amiga binary (.bin) test fixture by extracting a few events
from a real binary file. Uses farm_ng.core to read/write the protobuf-based format.

Usage:
    /path/to/GEMINI-Flask-Server/.conda/bin/python generate-amiga-fixture.py

Output:
    binary/test_amiga.0000.bin  (~100-200KB)
"""

import os
import sys

from farm_ng.core.events_file_reader import EventsFileReader, build_events_dict
from farm_ng.core.events_file_writer import EventsFileWriter

SOURCE_BIN = os.path.expanduser(
    "~/Downloads/Subset Amiga Data/2024-07-15/Onboard/"
    "2024_07_15_15_49_18_998387_moats-unproved.0000.bin"
)
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "binary")
# EventsFileWriter appends .0000.bin automatically
OUTPUT_BASE = os.path.join(OUTPUT_DIR, "test_amiga")

# How many events to extract per topic
MAX_RGB_FRAMES = 1       # 1 RGB frame per camera (~436KB each)
MAX_DISPARITY_FRAMES = 0 # Skip disparity to keep size down
MAX_GPS_EVENTS = 2       # 2 GPS events of each type
MAX_CALIBRATION = 1      # 1 calibration per camera (always 1)


def main():
    if not os.path.exists(SOURCE_BIN):
        print(f"Source binary not found: {SOURCE_BIN}")
        print("Please ensure the Amiga dataset is at ~/Downloads/Subset Amiga Data/")
        sys.exit(1)

    print(f"Reading source: {SOURCE_BIN}")
    reader = EventsFileReader(SOURCE_BIN)
    if not reader.open():
        print("Failed to open events file")
        sys.exit(1)

    events_index = reader.get_index()
    events_dict = build_events_dict(events_index)

    print("Topics found:")
    for topic, events in sorted(events_dict.items()):
        print(f"  {topic}: {len(events)} events")

    # Determine which events to extract
    extract_plan = {}
    for topic, events in events_dict.items():
        if "calibration" in topic:
            extract_plan[topic] = events[:MAX_CALIBRATION]
        elif "rgb" in topic:
            extract_plan[topic] = events[:MAX_RGB_FRAMES]
        elif "disparity" in topic:
            extract_plan[topic] = events[:MAX_DISPARITY_FRAMES]
        elif "pvt" in topic or "relposned" in topic or "ecef" in topic:
            extract_plan[topic] = events[:MAX_GPS_EVENTS]
        elif "imu" in topic:
            extract_plan[topic] = events[:2]  # Minimal IMU

    total_events = sum(len(v) for v in extract_plan.values())
    print(f"\nExtracting {total_events} events across {len(extract_plan)} topics")

    # Write the minimal binary
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    writer = EventsFileWriter(file_base=OUTPUT_BASE)
    if not writer.open():
        print("Failed to open writer")
        sys.exit(1)

    # Write calibration events as headers first
    for topic in sorted(extract_plan.keys()):
        if "calibration" in topic:
            for event_log in extract_plan[topic]:
                msg = event_log.read_message()
                writer.write(
                    path=event_log.event.uri.path,
                    message=msg,
                    timestamps=list(event_log.event.timestamps),
                )
            del extract_plan[topic]

    # Write remaining events in topic order
    for topic in sorted(extract_plan.keys()):
        for event_log in extract_plan[topic]:
            msg = event_log.read_message()
            writer.write(
                path=event_log.event.uri.path,
                message=msg,
                timestamps=list(event_log.event.timestamps),
            )

    writer.close()

    # Check output
    output_file = OUTPUT_BASE + ".0000.bin"
    if os.path.exists(output_file):
        size = os.path.getsize(output_file)
        print(f"\nGenerated: {output_file}")
        print(f"Size: {size:,} bytes ({size / 1024:.1f} KB)")

        # Verify the output is readable
        verify_reader = EventsFileReader(output_file)
        if verify_reader.open():
            verify_index = verify_reader.get_index()
            verify_dict = build_events_dict(verify_index)
            print("\nVerification - topics in output:")
            for t, evts in sorted(verify_dict.items()):
                print(f"  {t}: {len(evts)} events")
            print("\nFixture generated successfully!")
        else:
            print("WARNING: Output file could not be re-read!")
    else:
        print(f"ERROR: Output file not found at {output_file}")
        sys.exit(1)


if __name__ == "__main__":
    main()
