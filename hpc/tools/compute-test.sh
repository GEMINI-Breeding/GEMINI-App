#!/usr/bin/env bash
# Runs ON a compute node (via srun). Checks what the GEMI launcher relies on.
D="${GEMI_HPC_ROOT:?set GEMI_HPC_ROOT to the persistent data root}"
echo "node: $(hostname)  ip: $(hostname -I 2>/dev/null | cut -d' ' -f1)  cpus: $(nproc)"
echo "sbatch on node: $(command -v sbatch || echo no)"
echo "submit from node: $(sbatch --test-only -p "${GEMI_TEST_PARTITION:-low}" ${GEMI_TEST_ACCOUNT:+-A "$GEMI_TEST_ACCOUNT"} -t 1 --wrap true 2>&1 | head -1)"
for u in https://ghcr.io https://huggingface.co; do printf '%s -> ' "$u"; curl -s -o /dev/null -m 10 -w '%{http_code}\n' "$u" || echo unreachable; done
echo "group storage writable: $(touch $D/setup/.w 2>/dev/null && rm $D/setup/.w && echo yes || echo no)"
echo "tmp: TMPDIR=${TMPDIR:-unset} /tmp free=$(df -h /tmp | tail -1 | awk '{print $4}') /scratch: $(ls -d /scratch 2>/dev/null && df -h /scratch | tail -1 | awk '{print $4}')"
module load apptainer 2>/dev/null
echo "apptainer: $(apptainer --version 2>&1)"
export APPTAINER_CACHEDIR=$D/apptainer_cache; mkdir -p $APPTAINER_CACHEDIR
t0=$(date +%s)
apptainer exec docker://alpine:3.20 sh -c 'echo "container ok: $(cat /etc/alpine-release) uid=$(id -u)"' 2>&1 | tail -2
echo "pull+run seconds: $(( $(date +%s) - t0 ))"
echo "user namespaces: $(cat /proc/sys/user/max_user_namespaces 2>/dev/null)"
echo "listen test: $(python3 -c 'import socket;s=socket.socket();s.bind(("0.0.0.0",0));print("can bind port",s.getsockname()[1])' 2>&1)"
