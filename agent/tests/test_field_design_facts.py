"""Which field design a run gets: its own, or the same field's in the same year."""
import gemi_agent.tools  # noqa: F401  (the tools module loads the guide in its order)
from gemi_agent import guide


def scope(date, **kw):
    return {"experiment": "Interspecific Kearney", "location": "Kearney", "population": "Interspecific",
            "date": date, **kw}


def test_a_design_is_per_field_and_year():
    assert guide.same_field_and_year(scope("2023-07-06"), scope("2023-09-29"))
    assert not guide.same_field_and_year(scope("2023-07-06"), scope("2022-07-05"))
    assert not guide.same_field_and_year(scope("2023-07-06"), scope("2023-07-13", population="Cowpea"))
    assert guide.same_field_and_year(scope("2023-07-06", year="2023"), scope("x", year="2023"))
    assert not guide.same_field_and_year(scope(""), scope(""))


def test_the_design_named_in_saved_boundaries(tmp_path, monkeypatch):
    monkeypatch.setattr(guide, "LAYOUTS", tmp_path)
    (tmp_path / "Cowpea_2026.csv").write_text("plot\n1\n")
    snap = lambda source: {"field_design": {"by": "agent", "source": source}}      # noqa: E731
    assert guide.design_in_boundaries({}, snap("Cowpea_2026.csv")) == str(tmp_path / "Cowpea_2026.csv")
    assert guide.design_in_boundaries({}, snap("missing.csv")) is None              # not on this computer
    assert guide.design_in_boundaries({}, snap("mock")) is None                      # a stand-in
    assert guide.design_in_boundaries({}, {}) is None


def test_a_run_records_its_boundaries_design(tmp_path, monkeypatch):
    monkeypatch.setattr(guide, "FACTS_FILE", tmp_path / "facts.json")
    monkeypatch.setattr(guide, "design_in_boundaries", lambda sc, snapshot=None: "/d/Cowpea_2026.csv")
    run = {"id": "r1", "uploadScope": {"year": "2026", "experiment": "E", "location": "L", "population": "P",
                                       "date": "2026-08-17", "platform": "Drone", "sensor": "RGB"}}
    assert guide.design_of(run) == "/d/Cowpea_2026.csv"
    assert guide.facts_of("r1")["design_path"] == "/d/Cowpea_2026.csv"
