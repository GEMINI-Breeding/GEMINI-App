"""
Entry point for the gemi-bin-extractor Docker container.

Usage (inside container):
    python run_extraction.py <bin_file> <output_dir>

Both paths are container-side paths mounted from the host.
Exits with code 0 on success, 1 on failure (error printed to stderr).
"""

import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        print(
            "Usage: run_extraction.py <bin_file> <output_dir>",
            file=sys.stderr,
        )
        sys.exit(1)

    bin_file = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])

    if not bin_file.exists():
        print(f"Error: .bin file not found at {bin_file}", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        from bin_to_images.bin_to_images import extract_binary  # type: ignore
    except ImportError as exc:
        print(
            f"Error: could not import bin_to_images inside container: {exc}",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        extract_binary([bin_file], output_dir, granular_progress=False)
    except Exception as exc:
        print(f"Extraction failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
