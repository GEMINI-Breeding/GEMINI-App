"""The agent talks to the API of the place the app works on; Docker and the cluster tunnel never share a port."""
import gemi_agent.tools  # noqa: F401  (the tools module loads hpc_tools in its order)
from gemi_agent import client as C
from gemi_agent import hpc_tools as H


def test_the_api_follows_the_app_place(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMI_API", raising=False)
    monkeypatch.setattr(C, "PLACE_FILE", tmp_path / "place.json")
    assert C.place() == "computer"
    assert C.default_api() == "http://127.0.0.1:7777"
    C.set_place("cluster")
    assert C.default_api() == "http://127.0.0.1:7877"
    monkeypatch.setenv("GEMI_API", "http://127.0.0.1:55576/")
    assert C.default_api() == "http://127.0.0.1:55576"           # gemi-hpc app, a terminal: as given


def test_docker_and_the_cluster_tunnel_use_different_ports():
    assert H.API_PORT == C.CLUSTER_API_PORT != C.DOCKER_API_PORT
    assert H.TILES_PORT == C.CLUSTER_TILES_PORT != 8091
