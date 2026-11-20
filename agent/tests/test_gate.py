"""The cluster gate (hpc/remote/gemi-gate), run for real in a throwaway GEMI folder.

Slurm is replaced by small fake commands on PATH (squeue, sbatch, scancel, sacctmgr,
scontrol): sbatch records what it was asked and answers like Slurm; squeue reports
whatever jobs a test puts in a file. Nothing reaches a real cluster. Linux or macOS
with bash 4+, GNU tar and coreutils (the gate needs `stat -c`); skipped elsewhere.
"""
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

FAKE = {
    "squeue": r"""#!/bin/bash
# Jobs from $FAKE_SQUEUE: lines of name|cpus|mem|gres|nodes|state|id
f=${FAKE_SQUEUE:-/dev/null}
fmt=""; name=""; state=""
while [ $# -gt 0 ]; do
  case "$1" in -o) fmt=$2; shift 2 ;; -n) name=$2; shift 2 ;; -t) state=$2; shift 2 ;; -h|-u|-p|-A|-j) [ "$1" = -h ] && shift || shift 2 ;; *) shift ;; esac
done
while IFS='|' read -r n c m g d st id; do
  [ -z "$n" ] && continue
  [ -n "$name" ] && [[ ",$name," != *",$n,"* ]] && continue
  [ -n "$state" ] && [ "$state" != "$st" ] && continue
  case "$fmt" in
    *'%C'*) echo "$n|$c|$m|$g|$d" ;;
    '%i') echo "$id" ;;
    '%j') echo "$n" ;;
    '%i %j') echo "$id $n" ;;
    *) echo "$id|$n|$st" ;;
  esac
done < "$f"
""",
    "sbatch": r"""#!/bin/bash
echo "$*" >> "$FAKE_LOG"
for a in "$@"; do
  if [ "$a" = --test-only ]; then echo "sbatch: Job 1 to start at $(date -d '+1 min' +%Y-%m-%dT%H:%M:%S) using 4 processors" >&2; exit 0; fi
done
echo "Submitted batch job 4242"
""",
    "scancel": '#!/bin/bash\necho "scancel $*" >> "$FAKE_LOG"\n',
    "sacctmgr": "#!/bin/bash\necho 'lab|part|normal'\n",
    "scontrol": "#!/bin/bash\necho 'AccountingStorageEnforce = associations,limits'\n",
    "scrontab": "#!/bin/bash\nexit 0\n",
}

LAUNCH = """GEMI_IMAGE_REGISTRY=ghcr.io/example
GEMI_IMAGE_VERSION=sha-test
CORE_PARTITION=p1
CORE_ACCOUNT=lab
CORE_CPUS=4
CORE_MEM=16G
CORE_TIME=2-00:00:00
WORKER_TRY="p1:lab p2:lab"
WORKER_TIME=1-00:00:00
WORKER_RES_odm="cpus=16 mem=56G gpus=0"
WORKER_RES_geo="cpus=4 mem=16G gpus=0"
GEMI_DATA_ROOTS="{data}"
"""


def usable() -> bool:
    if sys.platform.startswith("win") or not shutil.which("bash"):
        return False
    r = subprocess.run(["bash", "-c", "stat -c %U / && tar --version | grep -q GNU && date -d '+1 min' +%s"],
                       capture_output=True)
    return r.returncode == 0


@unittest.skipUnless(usable(), "needs bash, GNU coreutils and GNU tar")
class GateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gemi-gate-test-"))
        self.root = self.tmp / "a" / "gemi"
        shutil.copytree(REPO / "hpc" / "remote", self.root / "hpc" / "remote")
        (self.root / "hpc" / "clusters" / "current").mkdir(parents=True)
        self.data = self.tmp / "fielddata"
        (self.data / "flight1").mkdir(parents=True)
        (self.data / "flight1" / "IMG_1.JPG").write_bytes(b"x")
        self.conf = self.root / "hpc" / "clusters" / "current" / "launch.conf"
        self.conf.write_text(LAUNCH.format(data=self.data))
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        for name, body in FAKE.items():
            p = self.bin / name
            p.write_text(body)
            p.chmod(0o755)
        self.jobs = self.tmp / "jobs"
        self.jobs.write_text("")
        self.log = self.tmp / "sbatch.log"
        self.log.write_text("")
        self.user = os.environ.get("USER") or subprocess.run(["id", "-un"], capture_output=True, text=True).stdout.strip()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def gate(self, *words, user=None, stdin=None):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", FAKE_SQUEUE=str(self.jobs),
                   FAKE_LOG=str(self.log), USER=user or self.user, HOME=str(self.tmp / "home"))
        env.pop("SSH_ORIGINAL_COMMAND", None)
        r = subprocess.run(["bash", str(self.root / "hpc" / "remote" / "gemi-gate"), *words], env=env,
                           input=stdin, capture_output=True, timeout=60)
        out = r.stdout.decode(errors="replace")
        return r.returncode, out.split("@@gemi@@\n", 1)[-1], r.stderr.decode(errors="replace")

    def refused(self, *words, **kw):
        rc, out, err = self.gate(*words, **kw)
        self.assertEqual(rc, 77, f"{words} was not refused: {out} {err}")
        return err

    # ── the menu ─────────────────────────────────────────────────────────────
    def test_refuses_what_is_not_on_the_menu(self):
        for words in (["ls", "/"], ["logs", "core;id"], ["rm", "-rf", "x"], ["logs", "../../etc/passwd"],
                      ["logs", "core", "$(id)"], ["selftest", "`id`"], ["frobnicate"]):
            self.refused(*words)
        self.assertEqual(self.gate("selftest")[0], 0)
        rc, out, _ = self.gate("survey")
        self.assertEqual(rc, 0)
        self.assertIn("runtime=", out)

    def test_placements_must_be_in_launch_conf(self):
        self.refused("worker", "odm", "where=elsewhere:lab")
        self.refused("worker", "nosuch")

    def test_worker_submitted_on_a_named_placement(self):
        rc, out, err = self.gate("worker", "odm")
        self.assertEqual(rc, 0, out + err)
        submits = [line for line in self.log.read_text().splitlines() if "--test-only" not in line]
        self.assertTrue(submits and "--partition=p1" in submits[-1] and "--cpus-per-task=16" in submits[-1], submits)

    # ── limits ───────────────────────────────────────────────────────────────
    def test_launch_conf_can_only_lower_the_limits(self):
        self.conf.write_text(self.conf.read_text() + "GEMI_MAX_CPUS=999\nGEMI_ALLOW_UNSAFE=1\nGEMI_MAX_MEM_GB=64\n")
        out = self.gate("limits")[1]
        self.assertIn("max_cpus=32 ", out)
        self.assertIn("max_mem_gb=64 ", out)
        self.assertIn("allow_unsafe=0", out)

    def test_limits_conf_on_the_cluster_raises_them(self):
        (self.root / "limits.conf").write_text("GEMI_MAX_CPUS=64\nGEMI_MAX_TOTAL_GPUS=8\nnot a setting\n")
        out = self.gate("limits")[1]
        self.assertIn("max_cpus=64 ", out)
        self.assertIn("total_gpus=8", out)

    def test_total_cap_over_all_gemi_jobs(self):
        self.jobs.write_text("gemi-worker-stitch|120|400G|N/A|1|RUNNING|11\nother-job|500|1T|N/A|1|RUNNING|12\n")
        err = self.refused("worker", "odm")    # 120 + 16 > 128; only gemi-* jobs count
        self.assertIn("in all", err)
        self.jobs.write_text("gemi-worker-stitch|96|300G|N/A|1|RUNNING|11\n")
        self.assertEqual(self.gate("worker", "odm")[0], 0)

    def test_core_over_the_limits_is_refused(self):
        self.conf.write_text(self.conf.read_text().replace("CORE_CPUS=4", "CORE_CPUS=64"))
        self.refused("core-submit")

    # ── data folders ─────────────────────────────────────────────────────────
    def test_folders_only_under_the_data_roots(self):
        rc, out, _ = self.gate("folder-peek", str(self.data / "flight1"))
        self.assertEqual(rc, 0)
        self.assertIn("IMG_1.JPG", out)
        self.refused("folder-peek", "/etc")
        self.refused("folder-peek", str(self.tmp))
        self.refused("folder-peek", "relative/path")

    # ── a shared session's members ───────────────────────────────────────────
    def test_members_only_while_shared_and_never_the_owner_commands(self):
        self.gate("selftest")                                   # creates run/ as the owner
        self.refused("ps", user="someone-else")                 # not shared
        (self.root / "run" / "share.conf").write_text("SHARE=1\n")
        self.assertEqual(self.gate("ps", user="someone-else")[0], 0)
        for words in (["login"], ["down"], ["share", "on"], ["recv", "hpc"], ["keeper", "on"], ["cloud-remotes"]):
            self.refused(*words, user="someone-else")

    # ── sync ─────────────────────────────────────────────────────────────────
    def test_recv_stays_in_its_staging_folder(self):
        outside = self.tmp / "outside"
        outside.mkdir()
        tgz = self.tmp / "evil.tgz"
        with tarfile.open(tgz, "w:gz") as t:
            link = tarfile.TarInfo("remote")
            link.type, link.linkname = tarfile.SYMTYPE, str(outside)
            t.addfile(link)
            data = b"pwned"
            f = tarfile.TarInfo("remote/evil.sh")
            f.size = len(data)
            import io
            t.addfile(f, io.BytesIO(data))
            g = tarfile.TarInfo("../../escaped.txt")
            g.size = len(data)
            t.addfile(g, io.BytesIO(data))
        rc, out, err = self.gate("recv", "hpc", stdin=tgz.read_bytes())
        self.assertFalse((outside / "evil.sh").exists(), "a symlink in the archive wrote outside the staging folder")
        self.assertFalse((self.root.parent / "escaped.txt").exists() or (self.tmp / "a" / "escaped.txt").exists())


if __name__ == "__main__":
    unittest.main()
