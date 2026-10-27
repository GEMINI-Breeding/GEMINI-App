#!/bin/bash -l
# Copy a folder from online storage (a connection made in the app: Box,
# Google Drive, S3, …) straight into the cluster with rclone, then, when the
# run's settings came with it, upload it into the session exactly as
# `ingest` does. Submitted by `gemi-gate cloud-fetch`, which checked
# everything; the args file says what (first line: remote:path, then the
# destination folder, the file patterns to keep, keep=0|1, then the upload
# settings).

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
# Our own copy of the output (the site's end-of-job report can replace the Slurm log):
# `cloud-state` and `gemi-hpc logs fetch` read this one.
exec > >(tee -a "$LOGS/fetch-$SLURM_JOB_ID.log") 2>&1
A=()
while IFS= read -r line || [ -n "$line" ]; do A+=("$line"); done < "$GEMI_FETCH_ARGS"
rm -f "$GEMI_FETCH_ARGS"
src="${A[0]:-}" dest="${A[1]:-}" patterns="${A[2]:-}" keep="${A[3]:-0}"
settings=("${A[@]:4}")
case "$dest" in "$INCOMING"/?*) ;; *) log "bad destination: $dest"; exit 1 ;; esac
[ -n "$src" ] || { log "nothing to copy"; exit 1; }

[ -x "$RCLONE" ] || { log "rclone is not installed (gemi-hpc pull rclone)"; exit 1; }
mkdir -p "$dest"
filters=()
IFS=',' read -r -a pats <<< "$patterns"
for p in "${pats[@]}"; do [ -n "$p" ] && filters+=(--include "$p"); done
log "copy $src -> $dest${patterns:+ (only $patterns)}"
# One-line stats every 10 s: "Transferred: 1.2 GiB / 6.3 GiB, 19%, 50 MiB/s, ETA 1m" (the app shows it).
"$RCLONE" --config "$RCLONE_CONF" copy "$src" "$dest" --ignore-case "${filters[@]}" \
  --transfers 8 --checkers 16 --stats 10s --stats-one-line --stats-log-level NOTICE \
  || { log "copy FAILED"; exit 1; }
n=$(find "$dest" -type f | wc -l)
log "copied: $n files, $(du -sh --apparent-size "$dest" 2>/dev/null | cut -f1)"

[ "${#settings[@]}" -gt 0 ] || { log "done (no upload asked for): $dest"; exit 0; }
args="$RUN/ingest-$(date +%s%N).args"
printf '%s\n' "${settings[@]}" > "$args"; chmod 600 "$args"
log "uploading into the session"
GEMI_INGEST_DIR="$dest" GEMI_INGEST_ARGS="$args" bash "$HPC/remote/ingest.sbatch"
rc=$?
if [ "$rc" -eq 0 ] && [ "$keep" != 1 ]; then
  rm -rf "$dest"; log "uploaded; the copy on the cluster is removed (the files are in the app)"
fi
[ "$rc" -eq 0 ] && log "done" || log "upload FAILED (the copy is kept: $dest)"
exit "$rc"
