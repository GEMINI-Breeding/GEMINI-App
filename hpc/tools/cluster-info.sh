#!/usr/bin/env bash
# Collects what the GEMI HPC setup needs to know about this cluster.
# Read-only, except one optional 2-minute test job (only if a partition is given).
#
# On the cluster login node:
#   bash hpc-cluster-info.sh                 > cluster-info.txt 2>&1
#   bash hpc-cluster-info.sh <partition> [account] > cluster-info.txt 2>&1   # also runs the test job
# then send back cluster-info.txt.

TEST_PARTITION="$1"
TEST_ACCOUNT="$2"   # optional Slurm account for the test job
section() { printf '\n===== %s =====\n' "$1"; }

section "host / slurm"
hostname; uname -sr; sinfo --version

section "partitions: name avail timelimit nodes cpus/node mem/node(MB) gres"
sinfo -o "%P %a %l %D %c %m %G"

section "partition details (preemption, priority, limits)"
scontrol show partition | grep -E "PartitionName|PreemptMode|PriorityTier|MaxTime|DefaultTime|GraceTime|AllowAccounts|AllowQos|QoS="

section "cluster preemption / requeue config"
scontrol show config | grep -iE "^(PreemptType|PreemptMode|PreemptExemptTime|JobRequeue|MaxJobCount|SchedulerParameters)"

section "my accounts / allowed partitions / QOS"
sacctmgr -n -P show assoc user="$USER" format=account,partition,qos 2>/dev/null
sacctmgr -n -P show qos format=name,priority,preempt,preemptmode,maxwall 2>/dev/null

section "apptainer"
module load apptainer 2>&1 | tail -2
apptainer --version
apptainer buildcfg 2>/dev/null | grep -iE "fakeroot|userns|suid" || true
grep -E "^\s*(allow setuid|max loop devices|allow net)" /etc/apptainer/apptainer.conf 2>/dev/null || true

section "storage (home / scratch / project)"
echo "HOME=$HOME"
for d in "$HOME" /scratch /scratch/$USER /project /projects /work /group; do
  [ -d "$d" ] && df -h "$d" | tail -1 | sed "s|^|$d: |"
done
command -v quota >/dev/null && quota -s 2>/dev/null | tail -5

section "internet from the login node"
for u in https://ghcr.io https://huggingface.co https://pypi.org; do
  printf '%s -> ' "$u"; curl -s -o /dev/null -m 10 -w '%{http_code}\n' "$u" || echo "unreachable"
done

if [ -n "$TEST_PARTITION" ]; then
  section "compute node test on partition $TEST_PARTITION (2 min, 1 CPU)"
  srun -p "$TEST_PARTITION" ${TEST_ACCOUNT:+-A "$TEST_ACCOUNT"} -t 2 -c 1 --mem=1G bash -c '
    echo "node: $(hostname)  ip: $(hostname -I 2>/dev/null | cut -d" " -f1)"
    echo "sbatch available on compute node: $(command -v sbatch || echo no)"
    echo "can submit from compute node: $(sbatch --test-only -p '"$TEST_PARTITION"' '"${TEST_ACCOUNT:+-A $TEST_ACCOUNT}"' -t 1 --wrap true 2>&1 | head -1)"
    for u in https://ghcr.io https://huggingface.co; do
      printf "%s -> " "$u"; curl -s -o /dev/null -m 10 -w "%{http_code}\n" "$u" || echo unreachable
    done
    echo "node-local tmp: ${TMPDIR:-/tmp} ($(df -h ${TMPDIR:-/tmp} | tail -1 | awk "{print \$4}") free)"
  '
fi
