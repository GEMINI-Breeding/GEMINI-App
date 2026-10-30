"""Field facts and design files shared through the stack, not only on one computer."""
import json

import pytest

import gemi_agent.tools  # noqa: F401  (the tools module loads the guide in its order)
from gemi_agent import guide, shared
from gemi_agent.client import ApiError


class FakeStore:
    """The stack's storage: object name -> bytes."""

    def __init__(self):
        self.objects = {}

    def upload_chunk(self, blob, index, total, ident, object_name, *a):
        self.objects[object_name] = blob

    def download(self, name):
        if name not in self.objects:
            raise ApiError(404, "not found", name)
        return self.objects[name]

    def list_dir(self, prefix):
        return [{"object_name": k} for k in self.objects if k.startswith(prefix)]


@pytest.fixture
def two_computers(tmp_path, monkeypatch):
    store = FakeStore()
    monkeypatch.setattr(shared, "_client", lambda: store)
    shared._cache.clear()

    def computer(name):
        home = tmp_path / name
        monkeypatch.setattr(guide, "FACTS_FILE", home / "run_facts.json")
        monkeypatch.setattr(guide, "LAYOUTS", home / "field_layouts")
        shared._cache.clear()
        return home

    return store, computer


def test_facts_and_their_design_reach_another_computer(two_computers):
    store, computer = two_computers
    mine = computer("mine")
    design = mine / "field_layouts" / "Cowpea_2026.csv"
    design.parent.mkdir(parents=True)
    design.write_text("plot,row,col\n1,1,1\n")
    guide.save_facts("run1", {"design_path": str(design), "first_tier_at": "north end"})
    shared_facts = json.loads(store.objects["Shared/GEMI/run_facts/run1.json"])
    assert shared_facts == {"design_path": "Cowpea_2026.csv", "first_tier_at": "north"}
    assert store.objects["Shared/GEMI/field_designs/Cowpea_2026.csv"] == design.read_bytes()

    theirs = computer("theirs")                     # a colleague, same stack, nothing of their own
    facts = guide.facts_of("run1")
    assert facts["first_tier_at"] == "north"
    assert facts["design_path"] == str(theirs / "field_layouts" / "Cowpea_2026.csv")
    assert (theirs / "field_layouts" / "Cowpea_2026.csv").read_text() == design.read_text()


def test_without_the_stack_the_computer_own_record_stands(tmp_path, monkeypatch):
    def unreachable():
        raise RuntimeError("not connected")

    monkeypatch.setattr(shared, "_client", unreachable)
    monkeypatch.setattr(guide, "FACTS_FILE", tmp_path / "run_facts.json")
    shared._cache.clear()
    guide.save_facts("run2", {"beds": [2, 3]})
    assert guide.facts_of("run2") == {"beds": [2, 3]}
