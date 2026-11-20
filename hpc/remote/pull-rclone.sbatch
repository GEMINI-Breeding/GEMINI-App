#!/bin/bash -l
#SBATCH --job-name=gemi-pull-rclone
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G
#SBATCH --time=00:20:00
# One-time: rclone (copies from Box, Google Drive, S3, … straight to the
# cluster), the pinned release, checked against its published SHA-256.
# Submitted by `gemi-gate pull-rclone`.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
exec > >(tee -a "$LOGS/pull-rclone-$SLURM_JOB_ID.log") 2>&1
set -euo pipefail
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
zip="rclone-$RCLONE_VERSION-linux-amd64.zip"
log "downloading $zip"
curl -fsSL --retry 3 -o "$tmp/$zip" "https://downloads.rclone.org/$RCLONE_VERSION/$zip"
echo "$RCLONE_SHA256  $tmp/$zip" | sha256sum -c -
python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$tmp/$zip" "$tmp/x"
mkdir -p "$(dirname "$RCLONE")"
install -m 755 "$tmp/x/rclone-$RCLONE_VERSION-linux-amd64/rclone" "$RCLONE.new"
mv -f "$RCLONE.new" "$RCLONE"
log "installed: $("$RCLONE" version | head -1)"
