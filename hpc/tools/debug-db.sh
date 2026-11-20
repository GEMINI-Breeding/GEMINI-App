#!/bin/bash -l
# Debug helper: run the db image's first initialisation on node-local disk with
# a given dynamic_shared_memory_type and report whether init completes.
#   srun ... bash debug-db.sh <posix|sysv|mmap> [extra apptainer flags...]
source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"; load_apptainer
DSM=${1:-posix}; shift || true
T=/tmp/gemi-dbg-$USER-$$; mkdir -p "$T/data" "$T/run"
PORT=$(free_port)
echo "== dsm=$DSM flags='$*' node=$(hostname)"
apptainer exec --cleanenv --no-home --writable-tmpfs "$@" "$IMAGES/db.sif" sh -c 'echo "in-container /dev/shm: $(grep " /dev/shm " /proc/mounts | head -2 | tr "\n" ";")"; df -h /dev/shm | tail -1'
E="POSTGRES_USER=gemini,POSTGRES_PASSWORD=x,POSTGRES_DB=gemini,POSTGRESQL_USERNAME=gemini,POSTGRESQL_PASSWORD=x,POSTGRESQL_DATABASE=gemini"
apptainer run --cleanenv --no-home --writable-tmpfs "$@" --env "$E" \
  -B "$T/data:/var/lib/postgresql/data" -B "$T/run:/var/run/postgresql" \
  "$IMAGES/db.sif" postgres -p "$PORT" -c listen_addresses=127.0.0.1 -c dynamic_shared_memory_type="$DSM" >"$T/db.log" 2>&1 &
PID=$!
ok=no
for i in $(seq 1 90); do
  if apptainer exec "$IMAGES/db.sif" pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then ok=yes; break; fi
  kill -0 $PID 2>/dev/null || break
  sleep 2
done
echo "init complete: $ok after $((i * 2))s; shm errors: $(grep -c 'shared memory' "$T/db.log"); last script: $(grep 'Running /docker' "$T/db.log" | tail -1)"
grep -iE "error|fatal" "$T/db.log" | grep -v "shared memory" | head -5
kill -INT $PID 2>/dev/null; wait $PID 2>/dev/null
rm -rf "$T"
