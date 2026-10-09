#!/usr/bin/env bash
# Read-only survey of a Slurm cluster for the GEMI setup, in a form a program
# can parse: one record per line, fields separated by "|", first field the
# record type. Sent over SSH and run in a login shell:
#   ssh user@host 'bash -ls' < hpc/tools/probe.sh
# Submits nothing: start times come from `sbatch --test-only`.

echo "@@probe"
echo "host|$(hostname)|$(uname -sr)|$USER|$HOME"
command -v sinfo >/dev/null 2>&1 || { echo "error|slurm not found on PATH in a login shell"; exit 0; }
echo "slurm|$(sinfo --version 2>&1)"

# partition|name|avail|timelimit|nodes|cpus/node|mem MB/node|gres|idle nodes
sinfo -h -o "%R|%a|%l|%D|%c|%m|%G" | sort -u | while IFS='|' read -r p a t n c m g; do
  idle=$(sinfo -h -p "$p" -t idle,mix -o "%D" | awk '{s+=$1} END{print s+0}')
  echo "partition|$p|$a|$t|$n|$c|$m|$g|$idle"
done
scontrol show partition 2>/dev/null | awk '
  /^PartitionName=/ {split($1,a,"="); name=a[2]}
  /PreemptMode=/ {for(i=1;i<=NF;i++) if($i ~ /^PreemptMode=/){split($i,b,"="); print "preempt|" name "|" b[2]}}'

# assoc|account|partition|qos   (which account may use which partition)
sacctmgr -n -P show assoc user="$USER" format=account,partition,qos 2>/dev/null | sed 's/^/assoc|/'

# Apptainer / Singularity
ap=""
for cmd in apptainer singularity; do command -v $cmd >/dev/null 2>&1 && ap="$cmd|$($cmd --version 2>&1)|path" && break; done
if [ -z "$ap" ] && command -v module >/dev/null 2>&1; then
  for mod in apptainer singularity; do
    if module load $mod >/dev/null 2>&1 && command -v $mod >/dev/null 2>&1; then ap="$mod|$($mod --version 2>&1)|module load $mod"; break; fi
  done
fi
echo "container|${ap:-none}"

# storage|path|size|free|writable   (candidates for the stack's data directory)
for d in "$HOME" /scratch/$USER /scratch /group /project /projects /work /data $(id -Gn | tr ' ' '\n' | sed 's|^|/group/|'); do
  [ -d "$d" ] || continue
  set -- $(df -Ph "$d" 2>/dev/null | tail -1)
  echo "storage|$d|$2|$4|$([ -w "$d" ] && echo yes || echo no)"
done | sort -u
[ -n "$GEMI_PROBE_ROOT" ] && [ -d "$GEMI_PROBE_ROOT" ] && \
  echo "existing|$GEMI_PROBE_ROOT|$(ls "$GEMI_PROBE_ROOT/images" 2>/dev/null | tr '\n' ' ')|$(ls "$GEMI_PROBE_ROOT/data" 2>/dev/null | tr '\n' ' ')"

for u in https://ghcr.io https://huggingface.co; do
  echo "internet|$u|$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$u" 2>/dev/null || echo unreachable)"
done

# estimate|kind|partition|account|gres|minutes until a job could start (or the reason it cannot)
now=$(date +%s)
est() {  # est <kind> <partition> <account> <gres or -> <cpus> <mem> <time>
  out=$(sbatch --test-only -p "$2" -A "$3" $([ "$4" != - ] && echo "--gres=$4") -c "$5" --mem="$6" -t "$7" --wrap hostname 2>&1)
  start=$(echo "$out" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}' | head -1)
  if [ -n "$start" ]; then echo "estimate|$1|$2|$3|$4|$(( ($(date -d "$start" +%s) - now) / 60 ))"
  else echo "estimate|$1|$2|$3|$4|no: $(echo "$out" | head -1 | sed 's/^[^:]*: *//' | cut -c1-70)"; fi
}
sacctmgr -n -P show assoc user="$USER" format=account,partition 2>/dev/null | sort -u | while IFS='|' read -r acct part; do
  [ -n "$part" ] || continue
  est core "$part" "$acct" - 4 16G 1-00:00:00
  est worker "$part" "$acct" - 16 56G 1-00:00:00
  sinfo -h -p "$part" -o "%G" | grep -q gpu && est gpu "$part" "$acct" gpu:1 8 48G 12:00:00
done
echo "@@end"
