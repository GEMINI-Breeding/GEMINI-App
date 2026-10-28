"""First-run cluster setup from the welcome page: the SSH command and key file it is given."""
import pytest

import gemi_agent.tools  # noqa: F401  (the tools module loads hpc_tools in its order)
from gemi_agent import hpc_tools
from gemi_agent.hpc_tools import cluster_name, ssh_command


def test_the_ssh_command_takes_the_key_file_beside_it(tmp_path):
    key = tmp_path / "id_cluster"
    key.write_text("k")
    assert ssh_command("jdoe@login.hive.edu") == "ssh jdoe@login.hive.edu"
    assert ssh_command("ssh -p 2222 jdoe@hive.edu", str(key)) == f"ssh -i {key} -p 2222 jdoe@hive.edu"
    with pytest.raises(ValueError, match="no key file"):
        ssh_command("ssh jdoe@hive.edu", str(tmp_path / "missing"))
    with pytest.raises(ValueError, match="once"):
        ssh_command(f"ssh -i {key} jdoe@hive.edu", str(key))
    with pytest.raises(ValueError):
        ssh_command("hive.edu")                     # no user@


def test_a_short_name_from_the_login_host():
    assert cluster_name("jdoe@login.hive.hpc.edu") == "hive"
    assert cluster_name("jdoe@hive.cs.example.edu") == "hive"
    assert cluster_name("jdoe@login2.hpc.example.org") == "example"
    assert cluster_name("jdoe@cluster") == "cluster"


def test_check_suggests_a_folder_and_where_things_run(monkeypatch):
    survey = {"login": "jdoe@hive.edu", "ssh_key": "(default key)", "user": "jdoe", "slurm": "23.02",
              "containers": "apptainer|1.3", "internet_from_login_node": {},
              "already_installed": None,
              "recommendation": {"core": {"partition": "high", "account": "lab", "minutes": 0},
                                 "workers_try": ["high:lab"], "llm_try": [],
                                 "data_root_candidates": ["/group/lab (2T free)"]}}
    monkeypatch.setattr(hpc_tools, "hpc_probe", lambda a: {"result": survey})
    out = hpc_tools.cluster_check("jdoe@hive.edu")
    assert out["core"] == "high:lab" and out["data_root"] == "/group/lab/gemini_app"
    assert out["name"] == "hive" and out["containers_ok"]
    survey["already_installed"] = {"root": "/group/lab/gemi", "images": [], "data_folders": []}
    assert hpc_tools.cluster_check("jdoe@hive.edu", data_root="/group/lab/gemi")["data_root"] == "/group/lab/gemi"


def test_use_needs_a_full_folder_and_a_placement(monkeypatch):
    seen = {}
    monkeypatch.setattr(hpc_tools, "hpc_configure", lambda a: seen.update(a) or {"result": {"cluster": a["name"]}})
    with pytest.raises(ValueError, match="full path"):
        hpc_tools.cluster_use({"ssh": "jdoe@hive.edu", "data_root": "gemi", "core": "a:b", "workers_try": ["a:b"]})
    with pytest.raises(ValueError, match="partition"):
        hpc_tools.cluster_use({"ssh": "jdoe@hive.edu", "data_root": "/g/x", "core": None, "workers_try": []})
    assert hpc_tools.cluster_use({"ssh": "jdoe@hive.edu", "data_root": "/g/x", "core": "a:b",
                                  "workers_try": ["a:b"]}) == {"cluster": "hive"}
    assert seen["ssh"] == "ssh jdoe@hive.edu" and seen["core"] == "a:b"
