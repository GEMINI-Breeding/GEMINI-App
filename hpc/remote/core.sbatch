#!/bin/bash -l
#SBATCH --job-name=gemi-core
#SBATCH --requeue
#SBATCH --signal=B:TERM@120
# The GEMINIbase core for one working session: Postgres, MinIO, Redis and the
# REST API, each from its published image with the current backend source
# mounted over the image's code. Submitted by `gemi-hpc up`, which adds
# --partition/--account/--cpus/--mem/--time/--output and exports GEMI_HPC_ROOT.
#
# Preemption (and scancel, and the time limit) arrive as SIGTERM with ~130 s
# before SIGKILL: the trap stops the database and storage cleanly. With
# --requeue Slurm then restarts this script, usually on another node, so every
# start rewrites run/session.env with the new address and ports.
#
# Postgres runs on NODE-LOCAL disk (the group NAS is slow for it: a checkpoint
# took ~2 min there), with a private /dev/shm — see private_ipc in lib.sh. The
# database is restored from $DATA/pgsnap at start and saved back there at
# clean shutdown (clean.tar) and every GEMI_DB_BACKUP_SECONDS (base/, a
# pg_basebackup) so a node that dies without warning loses at most that long.

source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"
load_apptainer
[ -s "$RUN/secrets.env" ] || bash "$HPC/remote/make-env.sh"
set -a; source "$RUN/secrets.env"; set +a

IP=$(node_ip)
DB_PORT=$(free_port); S3_PORT=$(free_port); S3_CONSOLE_PORT=$(free_port)
REDIS_PORT=$(free_port); API_PORT=$(free_port); TITILER_PORT=$(free_port)
TMP=/tmp/gemi-$USER-$SLURM_JOB_ID
PGLOCAL=$TMP/pgdata
SNAP=$DATA/pgsnap
mkdir -p "$TMP/pgrun" "$PGLOCAL" "$SNAP" "$DATA/minio" "$DATA/redis"
chmod 700 "$PGLOCAL"
SLOG=$LOGS/session-$SLURM_JOB_ID; mkdir -p "$SLOG"

# Everything a service or worker needs to find the others (owner-only).
umask 077
cat "$RUN/secrets.env" > "$RUN/stack.env"
cat >> "$RUN/stack.env" <<EOF
GEMINI_DB_HOSTNAME=127.0.0.1
GEMINI_DB_PORT=$DB_PORT
GEMINI_DB_URL=postgresql://$GEMINI_DB_USER:$GEMINI_DB_PASSWORD@127.0.0.1:$DB_PORT/$GEMINI_DB_NAME
GEMINI_LOGGER_HOSTNAME=$IP
GEMINI_LOGGER_PORT=$REDIS_PORT
GEMINI_STORAGE_HOSTNAME=$IP
GEMINI_STORAGE_PORT=$S3_PORT
GEMINI_STORAGE_API_PORT=$S3_CONSOLE_PORT
GEMINI_REST_API_HOSTNAME=$IP
GEMINI_REST_API_PORT=$API_PORT
GEMINI_REST_API_URL=http://$IP:$API_PORT
PYTHONDONTWRITEBYTECODE=1
PYTHONUNBUFFERED=1
GEMINI_PASSWORDLESS_LOGIN=$(share_flag PASSWORDLESS && echo true || echo false)
EOF

APT="apptainer run --cleanenv --no-home --writable-tmpfs"
DB_READY=0

restore_db() {
  if [ -s "$SNAP/clean.tar" ] && { [ ! -s "$SNAP/base/base.tar" ] || [ "$SNAP/clean.tar" -nt "$SNAP/base/base.tar" ]; }; then
    tar -C "$PGLOCAL" -xf "$SNAP/clean.tar"
    log "database restored from the last clean shutdown ($(date -r "$SNAP/clean.tar" '+%F %T'))"
  elif [ -s "$SNAP/base/base.tar" ]; then
    tar -C "$PGLOCAL" -xf "$SNAP/base/base.tar"
    tar -C "$PGLOCAL/pg_wal" -xf "$SNAP/base/pg_wal.tar"
    log "WARNING: last session did not shut down cleanly; database restored from the periodic backup of $(date -r "$SNAP/base/base.tar" '+%F %T')"
  else
    log "no saved database: starting a new one"
  fi
}

backup_db() {  # consistent copy of the running database -> $SNAP/base
  rm -rf "$SNAP/base.tmp"
  if apptainer exec --cleanenv --no-home -B "$TMP/pgrun:/var/run/postgresql" -B "$SNAP:/snap" "$IMAGES/db.sif" \
       pg_basebackup -h /var/run/postgresql -p "$DB_PORT" -U "$GEMINI_DB_USER" -D /snap/base.tmp -Ft -X stream -c fast \
       >>"$SLOG/db-backup.log" 2>&1; then
    rm -rf "$SNAP/base.old"; [ -d "$SNAP/base" ] && mv "$SNAP/base" "$SNAP/base.old"
    mv "$SNAP/base.tmp" "$SNAP/base"; rm -rf "$SNAP/base.old"
  else
    log "periodic database backup failed (see $SLOG/db-backup.log)"
  fi
}

stop_all() {
  trap '' TERM INT
  log "stopping core (job $SLURM_JOB_ID)"
  rm -f "$RUN/session.env"
  [ -n "${BK_PID:-}" ] && kill "$BK_PID" 2>/dev/null
  [ -n "${API_PID:-}" ] && kill -TERM "$API_PID" 2>/dev/null
  [ -n "${TITILER_PID:-}" ] && kill -TERM "$TITILER_PID" 2>/dev/null
  sleep 2
  [ -n "${PG_PID:-}" ] && kill -INT "$PG_PID" 2>/dev/null      # Postgres "fast" shutdown
  [ -n "${MINIO_PID:-}" ] && kill -TERM "$MINIO_PID" 2>/dev/null
  [ -n "${REDIS_PID:-}" ] && kill -TERM "$REDIS_PID" 2>/dev/null
  [ -n "${PG_PID:-}" ] && wait "$PG_PID" 2>/dev/null
  if [ "$DB_READY" = 1 ]; then
    # Only a database that came up fully is worth keeping.
    if tar -C "$PGLOCAL" -cf "$SNAP/clean.tar.tmp" . && mv "$SNAP/clean.tar.tmp" "$SNAP/clean.tar"; then
      log "database saved ($(du -h "$SNAP/clean.tar" | cut -f1))"
    else
      log "ERROR: could not save the database to $SNAP"
    fi
  fi
  wait
  rm -rf "$TMP"
  log "core stopped cleanly"
}
trap 'stop_all; exit 0' TERM INT

log "core starting on $(hostname) ($IP), job $SLURM_JOB_ID"
restore_db

# --- Postgres (only the API talks to it, so it listens on localhost only) ---
$APT --env "POSTGRES_USER=$GEMINI_DB_USER,POSTGRES_PASSWORD=$GEMINI_DB_PASSWORD,POSTGRES_DB=$GEMINI_DB_NAME,POSTGRESQL_USERNAME=$GEMINI_DB_USER,POSTGRESQL_PASSWORD=$GEMINI_DB_PASSWORD,POSTGRESQL_DATABASE=$GEMINI_DB_NAME" \
  $(private_ipc "$TMP/shm-db") -B "$PGLOCAL:/var/lib/postgresql/data" -B "$TMP/pgrun:/var/run/postgresql" \
  "$IMAGES/db.sif" postgres -p "$DB_PORT" -c listen_addresses=127.0.0.1 \
  >"$SLOG/db.log" 2>&1 &
PG_PID=$!

# --- MinIO (object data stays on the group storage) ---
$APT --env "MINIO_ROOT_USER=$GEMINI_STORAGE_ROOT_USER,MINIO_ROOT_PASSWORD=$GEMINI_STORAGE_ROOT_PASSWORD" \
  $(private_ipc "$TMP/shm-storage") -B "$DATA/minio:/data" \
  "$IMAGES/storage.sif" server /data --address ":$S3_PORT" --console-address ":$S3_CONSOLE_PORT" \
  >"$SLOG/storage.log" 2>&1 &
MINIO_PID=$!

# --- Redis ---
$APT $(private_ipc "$TMP/shm-logger") -B "$DATA/redis:/data" \
  "$IMAGES/logger.sif" redis-server /usr/local/etc/redis/redis.conf \
  --requirepass "$GEMINI_LOGGER_PASSWORD" --port "$REDIS_PORT" --maxmemory 256mb \
  >"$SLOG/logger.log" 2>&1 &
REDIS_PID=$!

pg_ready() { apptainer exec --cleanenv --no-home "$IMAGES/db.sif" pg_isready -h 127.0.0.1 -p "$DB_PORT" -U "$GEMINI_DB_USER" -d "$GEMINI_DB_NAME"; }
wait_for 300 "postgres" pg_ready || { tail -20 "$SLOG/db.log"; stop_all; exit 1; }
DB_READY=1
wait_for 120 "minio" curl -sf "http://127.0.0.1:$S3_PORT/minio/health/live" || { tail -20 "$SLOG/storage.log"; stop_all; exit 1; }
wait_for 60 "redis" bash -c "exec 3<>/dev/tcp/127.0.0.1/$REDIS_PORT" || { tail -20 "$SLOG/logger.log"; stop_all; exit 1; }

# --- MinIO users/buckets (idempotent) ---
apptainer exec --cleanenv --no-home --writable-tmpfs \
  --env "MC_CONFIG_DIR=/tmp/gemi-mc-$SLURM_JOB_ID,MINIO_SERVER_HOST=127.0.0.1,MINIO_SERVER_PORT=$S3_PORT,MINIO_ACCESS_KEY=$GEMINI_STORAGE_ROOT_USER,MINIO_SECRET_KEY=$GEMINI_STORAGE_ROOT_PASSWORD,GEMINI_STORAGE_ACCESS_KEY=$GEMINI_STORAGE_ACCESS_KEY,GEMINI_STORAGE_SECRET_KEY=$GEMINI_STORAGE_SECRET_KEY,GEMINI_STORAGE_BUCKET_NAME=$GEMINI_STORAGE_BUCKET_NAME" \
  -B "$HPC/remote/init_minio.sh:/init_minio.sh:ro" \
  "$IMAGES/storage-init.sif" sh /init_minio.sh >"$SLOG/storage-init.log" 2>&1 \
  || { log "storage init failed"; tail -20 "$SLOG/storage-init.log"; stop_all; exit 1; }
rm -rf "/tmp/gemi-mc-$SLURM_JOB_ID"
log "storage initialised"

# --- REST API (current source over the image's /geminibase) ---
$APT $(private_ipc "$TMP/shm-api") --env-file "$RUN/stack.env" --env GEMINI_RUN_MIGRATIONS=${GEMI_RUN_MIGRATIONS:-0} \
  -B "$SRC/gemini:/geminibase/gemini" -B "$SRC/alembic:/geminibase/alembic" -B "$SRC/alembic.ini:/geminibase/alembic.ini" \
  -B "$SRC/gemini/rest_api/entrypoint.sh:/usr/local/bin/entrypoint.sh:ro" \
  "$IMAGES/rest-api.sif" poetry run litestar --app gemini.rest_api.app:app run --host 0.0.0.0 --port "$API_PORT" \
  >"$SLOG/rest-api.log" 2>&1 &
API_PID=$!
wait_for 300 "rest-api" curl -sf "http://127.0.0.1:$API_PORT/healthz" || { tail -30 "$SLOG/rest-api.log"; stop_all; exit 1; }

# --- TiTiler: map tiles of orthomosaics and rover mosaics, read from the session's storage ---
# Without it the app's maps (orthomosaic preview, plot boundaries, Analyze map) show no imagery.
# Not needed for processing: a TiTiler that does not start is logged and the session goes on.
if [ -s "$IMAGES/titiler.sif" ]; then
  apptainer exec --cleanenv --no-home --writable-tmpfs \
    --env "AWS_ACCESS_KEY_ID=$GEMINI_STORAGE_ACCESS_KEY,AWS_SECRET_ACCESS_KEY=$GEMINI_STORAGE_SECRET_KEY,AWS_S3_ENDPOINT=http://127.0.0.1:$S3_PORT,AWS_HTTPS=NO,AWS_VIRTUAL_HOSTING=FALSE,GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR,GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=YES,VSI_CACHE=TRUE,VSI_CACHE_SIZE=5000000" \
    "$IMAGES/titiler.sif" uvicorn titiler.application.main:app --host 0.0.0.0 --port "$TITILER_PORT" \
    >"$SLOG/titiler.log" 2>&1 &
  TITILER_PID=$!
  if ! wait_for 120 "titiler" curl -sf "http://127.0.0.1:$TITILER_PORT/healthz"; then
    log "titiler did not come up (maps will show no imagery): $(tail -3 "$SLOG/titiler.log" | tr '\n' ' ')"
    kill "$TITILER_PID" 2>/dev/null; TITILER_PID=""; TITILER_PORT=""
  fi
else
  log "no titiler.sif (gemi-hpc pull titiler): maps will show no imagery"
  TITILER_PORT=""
fi

( while sleep "${GEMI_DB_BACKUP_SECONDS:-600}"; do backup_db; done ) &
BK_PID=$!

# Published last: workers and the tunnel only see a session that is up.
cat > "$RUN/session.env" <<EOF
CORE_JOB_ID=$SLURM_JOB_ID
CORE_NODE=$(hostname)
CORE_IP=$IP
API_PORT=$API_PORT
S3_PORT=$S3_PORT
TITILER_PORT=$TITILER_PORT
REDIS_PORT=$REDIS_PORT
SESSION_LOGS=$SLOG
STARTED=$(date -Is)
EOF
share_perms   # a shared session: the group reads what joining and their workers need
rm -f "$RUN/share/start-request"
log "core up: API http://$IP:$API_PORT (session.env written)"

# Stay up until a service dies or a signal arrives.
wait -n "$PG_PID" "$MINIO_PID" "$REDIS_PID" "$API_PID"
log "a core service exited unexpectedly"
stop_all
exit 1
