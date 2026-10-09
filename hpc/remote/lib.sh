# Sourced by every remote script. Needs GEMI_HPC_ROOT.
: "${GEMI_HPC_ROOT:?GEMI_HPC_ROOT not set}"

IMAGES=$GEMI_HPC_ROOT/images
SRC=$GEMI_HPC_ROOT/src/backend          # current backend source, mounted over image code
DATA=$GEMI_HPC_ROOT/data                # postgres/ minio/ redis/ nodeodm/ models/
RUN=$GEMI_HPC_ROOT/run                  # secrets.env, session.env (owner-only)
LOGS=$GEMI_HPC_ROOT/logs
HPC=$GEMI_HPC_ROOT/hpc                  # these scripts
JOB_PREFIX=gemi                         # every job this tooling submits is named gemi-*

# Home directories on clusters are small (a few GB): keep Apptainer's cache and temp files out of it.
export APPTAINER_CACHEDIR=$GEMI_HPC_ROOT/apptainer_cache
export APPTAINER_TMPDIR=${TMPDIR:-/tmp}

mkdir -p "$IMAGES" "$DATA" "$RUN" "$LOGS"
chmod 700 "$RUN" "$DATA" 2>/dev/null || true   # group dir is setgid group-writable

log() { echo "[$(date +%H:%M:%S)] $*"; }

load_apptainer() { command -v apptainer >/dev/null 2>&1 || module load apptainer; }

# A TCP port nobody is listening on (nodes are shared with other users).
free_port() {
  python3 - <<'PY'
import socket
s = socket.socket(); s.bind(("0.0.0.0", 0)); print(s.getsockname()[1]); s.close()
PY
}

# Apptainer flags for a private IPC namespace and /dev/shm.
# By default a container shares the node's /dev/shm, and systemd-logind
# (RemoveIPC) deletes a user's shared-memory files and SysV IPC there whenever
# one of that user's sessions on the node ends — e.g. another of their jobs
# finishing. Postgres then fails with "could not open shared memory segment".
# A directory on local disk bound over /dev/shm is outside logind's reach.
private_ipc() {  # private_ipc <dir>
  mkdir -p "$1"; echo "--ipc -B $1:/dev/shm"
}

# Address other nodes can reach this one on.
node_ip() { hostname -I | awk '{print $1}'; }

wait_for() {  # wait_for <seconds> <description> <command...>
  local timeout=$1 what=$2; shift 2
  local t=0
  until "$@" >/dev/null 2>&1; do
    sleep 2; t=$((t + 2))
    if [ "$t" -ge "$timeout" ]; then log "timed out waiting for $what"; return 1; fi
  done
  log "$what ready (${t}s)"
}

# ── limits ───────────────────────────────────────────────────────────────────
# The cluster is shared: no GEMI job may ask for more than this, whatever a
# launch.conf, the app or an agent says. A cluster's launch.conf may set its
# own (lower or higher) values; GEMI_ALLOW_UNSAFE=1 there switches the checks
# off, and is meant to be written by a person on purpose, never by a tool.
: "${GEMI_MAX_CPUS:=32}" "${GEMI_MAX_MEM_GB:=128}" "${GEMI_MAX_GPUS:=1}" "${GEMI_MAX_TIME:=2-00:00:00}" "${GEMI_MAX_JOBS:=10}"

_mem_gb() {  # 56G | 16000M | 1T -> whole GB, rounded up
  local v=${1%[bB]}; local n=${v%[kKmMgGtT]} u=${v: -1}
  case "$u" in [tT]) echo $(( n * 1024 )) ;; [gG]) echo "$n" ;; [mM]) echo $(( (n + 1023) / 1024 )) ;;
               [kK]) echo 1 ;; *) echo $(( (v + 1023) / 1024 )) ;; esac
}
_seconds() {  # [D-]HH:MM:SS | MM:SS | minutes -> seconds
  local t=$1 d=0 h=0 m=0 s=0
  case "$t" in *-*) d=${t%%-*}; t=${t#*-} ;; esac
  IFS=: read -r a b c <<< "$t"
  if [ -n "${c:-}" ]; then h=$a m=$b s=$c; elif [ -n "${b:-}" ]; then [ "$d" -gt 0 ] && { h=$a; m=$b; } || { m=$a; s=$b; }; else m=$a; fi
  echo $(( 10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s ))
}

# check_job <cpus> <mem> <gpus> <time>: non-zero (with the reason on stderr) if over a limit.
check_job() {
  [ "${GEMI_ALLOW_UNSAFE:-0}" = 1 ] && return 0
  local why=""
  [ "$1" -le "$GEMI_MAX_CPUS" ] || why="$why cpus $1 > $GEMI_MAX_CPUS;"
  [ "$(_mem_gb "$2")" -le "$GEMI_MAX_MEM_GB" ] || why="$why mem $2 > ${GEMI_MAX_MEM_GB}G;"
  [ "$3" -le "$GEMI_MAX_GPUS" ] || why="$why gpus $3 > $GEMI_MAX_GPUS;"
  [ "$(_seconds "$4")" -le "$(_seconds "$GEMI_MAX_TIME")" ] || why="$why time $4 > $GEMI_MAX_TIME;"
  local n; n=$(squeue -h -u "$USER" -o '%j' 2>/dev/null | grep -c '^gemi-')
  [ "$n" -lt "$GEMI_MAX_JOBS" ] || why="$why $n GEMI jobs already queued or running (limit $GEMI_MAX_JOBS);"
  [ -z "$why" ] && return 0
  echo "refused by the job limits:$why set GEMI_MAX_* (or GEMI_ALLOW_UNSAFE=1) in the cluster's launch.conf to change them" >&2
  return 1
}

# Placements ("partition:account[:gres]") this cluster's launch.conf names.
places() {
  { echo "${CORE_PARTITION:-}:${CORE_ACCOUNT:-}"; tr ' ' '\n' <<< "${WORKER_TRY:-} ${LLM_TRY:-} ${GEMI_EXTRA_PLACES:-}"; } \
    | grep -E '^[^:]+:[^:]+' | sort -u
}
# allowed_place <partition:account[:gres] ...>: every entry must be one of them (gres aside).
allowed_place() {
  local e pa
  for e in $1; do
    pa=$(cut -d: -f1,2 <<< "$e")
    places | cut -d: -f1,2 | grep -qxF "$pa" || return 1
  done
}
