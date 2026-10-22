"""The agent-facing operations, one function per tool. The CLI and the MCP
server are both thin wrappers over this table, so they cannot drift apart.

Every function takes a dict of arguments and returns a dict with a short
JSON-able `result` and, optionally, `images` (paths of pictures to look at).
"""
from __future__ import annotations

import contextvars
import json
import os
from typing import Any, Callable, Optional

from .client import Client
from .ground import Markings, Track, submit_stitch
from .panorama import (Panorama, along_track_m, boundaries_from_positions, boundary_positions_m,
                       boundary_sheet, boundary_tile, detect_stakes, gap_boundaries, grid_boundaries, planted_side, plots_from_boundaries,
                       texture_edge)

# The API client tools act through. The CLI and MCP server use one client
# logged in from the environment; the agent service sets one per run (the
# signed-in user's) with use_client().
_client_var: contextvars.ContextVar[Optional[Client]] = contextvars.ContextVar("gemi_client", default=None)
# When the person's current message arrived (set by the chat loop). "The person confirmed what they
# were shown" can only be true of something shown BEFORE that moment - in this conversation or an
# earlier one. None outside a chat (command line, MCP): then only "it was shown" is checked.
TURN_STARTED: contextvars.ContextVar[Optional[float]] = contextvars.ContextVar("gemi_turn_started", default=None)


def shown_file():
    from .client import AGENT_DIR

    return AGENT_DIR / "work" / "shown.json"


def mark_shown(key: str) -> None:
    """Remember that something was put in front of the person, and when."""
    import json as _json
    import time as _time

    p = shown_file()
    data = _json.loads(p.read_text()) if p.exists() else {}
    data.setdefault(key, _time.time())               # the first showing counts: re-showing does not reset it
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_json.dumps(data))


def confirmable(key: str) -> bool:
    """Was this shown to the person before their current message? Only then can they have confirmed it."""
    import json as _json

    p = shown_file()
    when = (_json.loads(p.read_text()) if p.exists() else {}).get(key)
    if when is None:
        return False
    started = TURN_STARTED.get()
    return started is None or when < started


def forget_shown(key: str) -> None:
    import json as _json

    p = shown_file()
    if p.exists():
        data = _json.loads(p.read_text())
        if data.pop(key, None) is not None:
            p.write_text(_json.dumps(data))
_default_client: Optional[Client] = None
_tracks: dict[tuple[int, str], Track] = {}


def client() -> Client:
    global _default_client
    c = _client_var.get()
    if c is not None:
        return c
    if _default_client is None:
        _default_client = Client()
    return _default_client


def use_client(c: Client) -> None:
    _client_var.set(c)


def _track(args: dict) -> Track:
    prefix = args.get("track") or os.environ.get("GEMI_TRACK")
    if not prefix:
        raise ValueError("`track` is required: the dataset folder, e.g. "
                         "Raw/2026/EXP/SITE/POP/2026-09-17/Amiga/RGB/c0fca235/")
    c = client()
    prefix = str(prefix).strip()
    if not prefix.startswith("Raw/"):
        prefix = _track_of_run(prefix)
    elif not prefix.endswith("/"):
        prefix += "/"
    key = (id(c), prefix)
    if key not in _tracks:
        _tracks[key] = Track(c, prefix)
    return _tracks[key]


def _track_of_run(words: str) -> str:
    """A rover run named in words (or by the name the Process tab shows) instead
    of by its folder: the folder of that run's track."""
    from . import guide
    from .process_runs import ProcessRuns

    pr = ProcessRuns(client())
    runs, pipelines = guide._state(pr)
    from .process_runs import pipeline_type

    ground = [r for r in runs if guide._track(r) and pipeline_type(r.get("uploadScope") or {}) == "ground"]
    found = guide._match(ground, words)
    if len(found) != 1:
        raise ValueError(f"`track` {words!r} is not a dataset folder (Raw/…/) and does not name one rover run. "
                         "Rover runs: " + (", ".join(f"{guide._label(pr.describe(r, pipelines))} = {guide._track(r)}"
                                                     for r in ground[:8]) or "none yet"))
    return str(guide._track(found[0]))


def _pass(track: Track, n: int) -> dict:
    passes = track.passes()
    if not 1 <= n <= len(passes):
        raise ValueError(f"pass {n} does not exist (1..{len(passes)})")
    return passes[n - 1]


def _boundaries(track: Track) -> dict:
    path = track.cache / "boundaries.json"
    return json.loads(path.read_text()) if path.exists() else {}


def _save_boundaries(track: Track, data: dict) -> None:
    (track.cache / "boundaries.json").write_text(json.dumps(data, indent=1))


def _spacing_range(data: dict) -> Optional[tuple[int, int]]:
    """Plot spacing (ground px) seen in the reviewed passes, +-8 %."""
    gaps = []
    for b in data.values():
        if b.get("reviewed") and len(b["xs"]) > 3:
            xs = sorted(b["xs"])
            gaps.append((xs[-1] - xs[0]) / (len(xs) - 1))
    if not gaps:
        return None
    mid = sorted(gaps)[len(gaps) // 2]
    return int(mid * 0.92), int(mid * 1.08)


_along_cache: dict[str, Any] = {}


def _along(track: Track):
    if track.prefix not in _along_cache:
        _along_cache[track.prefix] = along_track_m(track)
    return _along_cache[track.prefix]


def _reference_positions(track: Track, data: dict, heading: str, near: int = 0) -> tuple[list[float], float]:
    """From the reviewed passes with this heading and the usual boundary
    count: the median along-track position of each boundary, and which way
    the soil texture steps there (+1 / -1; 0 if it does not step clearly).
    Per heading, because the GPS antenna is not over the camera (its lead
    flips sign with direction) and so does the texture step."""
    t = _along(track)
    rows, steps = [], []
    passes = track.passes()
    if near:
        # GPS error drifts slowly across the field: the few reviewed passes
        # nearest in time are a better guide than all of them.
        ok = [p for p in passes if (data.get(str(p["pass"])) or {}).get("reviewed")
              and p["heading"] == heading and p["pass"] != near]
        passes = sorted(ok, key=lambda p: abs(p["pass"] - near))[:3]
    for p in passes:
        b = data.get(str(p["pass"]))
        if not b or not b.get("reviewed") or p["heading"] != heading or len(b["xs"]) < 3:
            continue
        pano = Panorama(track, p["first"], p["last"])
        if not pano.gps_ok:
            continue
        xs = sorted(b["xs"])
        rows.append(sorted(boundary_positions_m(pano, xs, t)))
        edge = texture_edge(pano, tuple(b.get("band") or (0.0, 0.5)))
        # Strongest step of either sign within reach of each boundary.
        for x in xs:
            w = edge[max(0, x - 60) : x + 61]
            steps.append(float(w[int(abs(w).argmax())]))
    if not rows:
        return [], 0.0
    usual = max(set(len(r) for r in rows), key=[len(r) for r in rows].count)
    rows = [r for r in rows if len(r) == usual]
    mid = sorted(steps)[len(steps) // 2]
    return [sorted(col)[len(col) // 2] for col in zip(*rows)], (0.0 if abs(mid) < 0.7 else (1.0 if mid > 0 else -1.0))


def _band(args: dict, track: Optional[Track] = None, pass_key: str = "") -> tuple[float, float]:
    """The slice of the frame height holding the crop bed: as given, else the
    one remembered for this pass, else the upper half."""
    b = args.get("band")
    if not b and track is not None:
        b = (_boundaries(track).get(pass_key) or {}).get("band")
    b = b or [0.0, 0.5]
    return float(b[0]), float(b[1])


# ── tools ────────────────────────────────────────────────────────────────────

def passes(args: dict) -> dict:
    track = _track(args)
    done = _boundaries(track)
    rows = track.passes()
    for r in rows:
        b = done.get(str(r["pass"]))
        r["boundaries"] = len(b["xs"]) if b else None
        r["reviewed"] = bool(b and b.get("reviewed"))
    return {"result": {"frames": len(track.frames), "passes": rows}}


def panorama(args: dict) -> dict:
    """Panorama of one pass with the plot boundaries drawn on it."""
    track = _track(args)
    p = _pass(track, int(args["pass"]))
    pano = Panorama(track, p["first"], p["last"])
    data = _boundaries(track)
    key = str(p["pass"])
    if args.get("gaps"):
        # Plots are canopy blocks separated by alleys (no stakes): boundaries in the alleys.
        rows = args.get("crop_rows") or [[0.0, 1.0]]
        stakes = gap_boundaries(pano, [(float(a), float(b)) for a, b in rows])
        data[key] = {"xs": [s["x"] for s in stakes], "inferred": [s["x"] for s in stakes if s["inferred"]],
                     "reviewed": False, "band": [0.0, 1.0], "source": "alleys between canopy blocks"}
        _save_boundaries(track, data)
    elif key not in data or args.get("redetect"):
        if args.get("band"):
            band = _band(args)
            stakes = detect_stakes(pano, band)
        else:
            # The bed is above or below the wheel track depending on which
            # side of the rover it was on: take the half where stakes show
            # up, or failing that the half with the browner (moister) soil.
            halves = [(0.0, 0.5), (0.5, 1.0)]
            found = [detect_stakes(pano, h) for h in halves]
            seen = [sum(not s["inferred"] for s in f) for f in found]
            pick = int(seen[1] > seen[0]) if max(seen) >= 6 else pano.bed_half()
            band, stakes = halves[pick], found[pick]
        source = "stakes seen"
        if not stakes or args.get("from_reviewed"):
            # Stakes too faint to pick out: plots line up across beds, so
            # carry the boundaries over by GPS from the beds already reviewed
            # that were driven in the same direction, and snap them locally.
            ref, edge_sign = _reference_positions(track, data, p["heading"], near=p["pass"])
            if ref and pano.gps_ok:
                # (The texture step is measured but not used for snapping: on
                # test beds it moved boundaries off their stakes as often as
                # onto them. Close-ups by eye do the fine placement.)
                stakes = boundaries_from_positions(pano, ref, _along(track), band)
                source = "carried over by GPS from reviewed passes"
            else:
                source = "none (no stakes detected; no reviewed pass with this heading, or GPS unusable)"
        data[key] = {"xs": [s["x"] for s in stakes], "inferred": [s["x"] for s in stakes if s["inferred"]],
                     "reviewed": False, "band": list(band), "source": source}
        _save_boundaries(track, data)
    elif args.get("band"):
        data[key]["band"] = list(_band(args))
        _save_boundaries(track, data)
    b = data[key]
    band = _band(args, track, key)
    marks = [(x, f"{i}{'?' if x in b.get('inferred', []) else ''}") for i, x in enumerate(b["xs"])]
    if args.get("markings"):
        # QA view: the saved/working plots instead of the stake proposals —
        # each plot's ground extent, from its start frame's exit edge to its
        # end frame's entry edge.
        marks = []
        for pl in Markings(track).plots:
            if pl["start"] is None or pl["end"] is None or not (p["first"] <= pl["start"] <= p["last"]):
                continue
            a = float(pano.centre[pl["start"] - p["first"]]) - pano.width / 2
            z = float(pano.centre[min(pl["end"], p["last"]) - p["first"]]) + pano.width / 2
            marks += [(int(a), f"[{pl['plot_id']}"), (int(z), f"{pl['plot_id']}]")]
    x0, x1 = int(args.get("x0") or 0), int(args.get("x1") or 0)
    image = pano.render(band, float(args.get("zoom") or 1.5), x0=x0, x1=x1,
                        marks=None if args.get("plain") else marks)
    return {
        "result": {
            "pass": p["pass"], "frames": [p["first"], p["last"]], "ground_px": pano.total,
            "frame_width_px": pano.width, "camera_direction": pano.camera_direction,
            "gps_ok": pano.gps_ok, "band": list(band), "proposal": b.get("source", ""),
            "boundaries": [{"i": i, "x": x, "inferred": x in b.get("inferred", [])} for i, x in enumerate(b["xs"])],
            "reviewed": b.get("reviewed", False),
        },
        "images": [str(image)],
    }


def boundary_closeups(args: dict) -> dict:
    """Close-up of the ground around every boundary of a pass."""
    track = _track(args)
    p = _pass(track, int(args["pass"]))
    key = str(p["pass"])
    b = _boundaries(track).get(key)
    if not b or not b["xs"]:
        raise ValueError("no boundaries for this pass yet — run panorama first")
    pano = Panorama(track, p["first"], p["last"])
    xs = sorted(b["xs"])
    image = boundary_sheet(pano, xs, _band(args, track, key), int(args.get("reach") or 150))
    return {"result": {"pass": p["pass"], "boundaries": [{"i": i, "x": x} for i, x in enumerate(xs)]},
            "images": [str(image)]}


def boundary_closeup(args: dict) -> dict:
    """One boundary of a pass, large, for reading its exact position."""
    track = _track(args)
    p = _pass(track, int(args["pass"]))
    key = str(p["pass"])
    b = _boundaries(track).get(key)
    if not b or not b["xs"]:
        raise ValueError("no boundaries for this pass yet - run panorama first")
    xs = sorted(b["xs"])
    i = int(args["index"])
    if not 0 <= i < len(xs):
        raise ValueError(f"index must be 0..{len(xs) - 1}")
    pano = Panorama(track, p["first"], p["last"])
    image = boundary_tile(pano, xs[i], i, _band(args, track, key))
    return {"result": {"pass": p["pass"], "index": i, "x": xs[i], "boundaries": len(xs),
                       "how_to_read": "ruler = offset in px from the current position (0); answer with the offset "
                                      "where the stake enters the ground, or say it is not visible"},
            "images": [str(image)]}


def set_boundaries(args: dict) -> dict:
    """Correct a pass's boundaries: replace the list, or add / remove / move."""
    track = _track(args)
    p = _pass(track, int(args["pass"]))
    data = _boundaries(track)
    key = str(p["pass"])
    b = data.get(key) or {"xs": [], "inferred": [], "reviewed": False}
    xs = list(b["xs"])
    inferred = list(b.get("inferred", []))
    if args.get("grid"):
        g = args["grid"]
        pano = Panorama(track, p["first"], p["last"])
        grid = grid_boundaries(pano, int(g[0]), int(g[1]), int(g[2]), int(args.get("before") or 0),
                               int(args.get("after") or 0), band=_band(args, track, key))
        xs = [s["x"] for s in grid]
        inferred = [s["x"] for s in grid if s["inferred"]]
    if args.get("xs") is not None:
        xs = [int(x) for x in args["xs"]]
    for x in args.get("add") or []:
        xs.append(int(x))
    for i in sorted((int(i) for i in args.get("remove") or []), reverse=True):
        xs.pop(i)
    for i, x in (args.get("move") or {}).items():
        xs[int(i)] = int(x)
    for i, dx in (args.get("shift") or {}).items():
        xs[int(i)] += int(dx)
        inferred = [v for v in inferred if v != xs[int(i)] - int(dx)]   # placed by eye now
    if args.get("keep"):
        # "Boundaries i..j are the real stakes": drop the rest, trust these.
        i, j = (int(v) for v in args["keep"])
        xs = sorted(xs)[i : j + 1]
        inferred = []
    xs = sorted(set(xs))
    if args.get("ends"):
        # Keep the stretch between the first and last *seen* stake, then add a
        # fixed number of plot-lengths before and after it (what the field
        # layout says lies outside the staked plots), clipped to the recording.
        before, after = (int(v) for v in args["ends"])
        seen = [x for x in xs if x not in inferred]
        if len(seen) < 2:
            raise ValueError("`ends` needs at least two seen stakes")
        total = Panorama(track, p["first"], p["last"]).total
        core = [x for x in xs if seen[0] <= x <= seen[-1]]
        spacing = (seen[-1] - seen[0]) / (len(core) - 1)
        head = [round(seen[0] - k * spacing) for k in range(before, 0, -1)]
        tail = [round(seen[-1] + k * spacing) for k in range(1, after + 1)]
        clip = lambda x: min(max(x, 0), total - 1)
        # A stretch cut short by the recording stays if 60 % of it is there.
        head = [clip(x) for x in head if x >= -0.4 * spacing]
        tail = [clip(x) for x in tail if x <= total - 1 + 0.4 * spacing]
        inferred = [x for x in inferred if x in core] + head + tail
        xs = sorted(set(head + core + tail))
    data[key] = {"xs": xs, "inferred": [x for x in inferred if x in xs],
                 "reviewed": bool(args.get("reviewed", True)), "band": list(_band(args, track, key))}
    _save_boundaries(track, data)
    return {"result": {"pass": p["pass"], "boundaries": xs, "plots": max(0, len(xs) - 1),
                       "reviewed": data[key]["reviewed"]}}


def apply_boundaries(args: dict) -> dict:
    """Turn every reviewed pass's boundaries into numbered plot markings."""
    track = _track(args)
    data = _boundaries(track)
    m = Markings(track)
    m.plots = []
    plot_id = int(args.get("first_plot_id") or 1)
    summary = []
    fraction = float(args.get("planted_fraction") or 1.0)
    sides: dict[str, str] = {}
    if fraction < 1.0 and (args.get("planted_at") or "auto") == "auto":
        # Which end the plants are at depends on the direction of travel, not
        # on the bed: decide once per heading by majority, since weeds make
        # single passes vote wrong.
        votes: dict[str, list[str]] = {}
        for p in track.passes():
            b = data.get(str(p["pass"]))
            if b and b.get("reviewed") and len(b["xs"]) > 2:
                pano = Panorama(track, p["first"], p["last"])
                votes.setdefault(p["heading"], []).append(
                    planted_side(pano, b["xs"], tuple(b.get("band") or (0.0, 0.5))))
        sides = {h: max(set(v), key=v.count) for h, v in votes.items()}
    for p in track.passes():
        b = data.get(str(p["pass"]))
        if not b or (not b.get("reviewed") and not args.get("include_unreviewed")):
            continue
        pano = Panorama(track, p["first"], p["last"])
        side = args.get("planted_at") or "auto"
        if side == "auto":
            side = sides.get(p["heading"], "start")
        plots = plots_from_boundaries(pano, b["xs"], tight=bool(args.get("tight")),
                                      min_frames=int(args.get("min_frames") or 4),
                                      planted_fraction=fraction, planted_at=side)
        direction = args.get("direction") or pano.camera_direction
        for pl in plots:
            m.plots.append({"plot_id": plot_id, "start": pl["start"], "end": pl["end"],
                            "direction": direction, "note": f"pass {p['pass']} x {pl['x0']}-{pl['x1']} ({pl['basis']})"})
            plot_id += 1
        summary.append({"pass": p["pass"], "plots": len(plots), **({"planted_at": side} if fraction < 1.0 else {})})
    m._write()
    return {"result": {"plots": len(m.plots), "passes": summary, "problems": m.problems()}}


def sheet(args: dict) -> dict:
    track = _track(args)
    path = track.sheet(int(args["first"]), int(args["last"]), int(args.get("step") or 1),
                       int(args.get("size") or 256), int(args.get("columns") or 0))
    return {"result": {"frames": [int(args["first"]), int(args["last"])], "step": int(args.get("step") or 1)},
            "images": [str(path)]}


def frame(args: dict) -> dict:
    track = _track(args)
    i = int(args["index"])
    f = track.frames[i]
    return {"result": {"index": i, "name": f.name, "lat": f.lat, "lon": f.lon, "heading": f.direction},
            "images": [str(track.frame_image(i, int(args.get("size") or 800)))]}


def plot_view(args: dict) -> dict:
    """A plot's first two and last two frames, and the frames just outside."""
    track = _track(args)
    m = Markings(track)
    p = next((p for p in m.plots if p["plot_id"] == int(args["plot_id"])), None)
    if p is None or p["start"] is None or p["end"] is None:
        raise ValueError("that plot is not marked")
    idx = [p["start"] - 1, p["start"], p["start"] + 1, p["end"] - 1, p["end"], p["end"] + 1]
    idx = [i for i in idx if 0 <= i < len(track.frames)]
    from PIL import Image

    tiles = [track.thumb(i, 480) for i in idx]
    from .ground import _label

    labels = {p["start"]: "START", p["end"]: "END"}
    tiles = [_label(t, f"{i} {labels.get(i, '')}".strip()) for i, t in zip(idx, tiles)]
    w, h = tiles[0].size
    out = Image.new("RGB", (3 * w, 2 * h))
    for n, t in enumerate(tiles):
        out.paste(t, ((n % 3) * w, (n // 3) * h))
    path = track.cache / "views" / f"plot_{p['plot_id']:05d}.png"
    out.save(path)
    return {"result": p, "images": [str(path)]}


def profile(args: dict) -> dict:
    track = _track(args)
    return {"result": track.profile(int(args["first"]), int(args["last"]), int(args.get("step") or 5))}


def mark(args: dict) -> dict:
    m = Markings(_track(args))
    if args.get("plots_per_frame") is not None or args.get("split"):
        layout = m.set_layout(args.get("plots_per_frame"), args.get("split"))
        if args.get("plot_id") is None:
            return {"result": {"layout": layout}}
    if args.get("plot_id") is None:
        raise ValueError("give plot_id (or plots_per_frame / split to set the track's layout)")
    if args.get("delete"):
        m.delete(int(args["plot_id"]))
        return {"result": {"deleted": int(args["plot_id"])}}
    g = lambda k: int(args[k]) if args.get(k) is not None else None
    return {"result": m.mark(int(args["plot_id"]), g("start"), g("end"), args.get("direction"), args.get("note"))}


def markings(args: dict) -> dict:
    track = _track(args)
    m = Markings(track)
    plots = m.plots
    if args.get("first_plot_id") or args.get("last_plot_id"):
        lo, hi = int(args.get("first_plot_id") or 0), int(args.get("last_plot_id") or 10**9)
        plots = [p for p in plots if lo <= p["plot_id"] <= hi]
    frames = [p["end"] - p["start"] + 1 for p in m.plots if p["start"] is not None and p["end"] is not None]
    return {"result": {
        "count": len(m.plots), "problems": m.problems(), "directory": m.directory,
        "layout": m.layout,
        "plots_to_stitch": len(m.lane_plots()),
        "frames_per_plot": {"min": min(frames), "max": max(frames), "mean": round(sum(frames) / len(frames), 1)} if frames else None,
        "saved_versions": track.client.versions(m.directory),
        "plots": plots if (args.get("list") or len(plots) <= 40) else f"{len(plots)} plots (pass list=true or a plot id range)",
    }}


def process_tab(fn) -> Any:
    """Run a Process-tab update; never let it fail the tool that did the work."""
    from .process_runs import ProcessRuns

    try:
        return fn(ProcessRuns(client()))
    except Exception as e:
        return {"not_updated": f"{type(e).__name__}: {e}"}


def _track_scope(track: Track) -> dict:
    from .process_runs import scope_from_path

    scope = scope_from_path(track.prefix)
    if scope is None:
        raise ValueError(f"{track.prefix} is not a Raw/… dataset folder")
    return scope


def save_markings(args: dict) -> dict:
    track = _track(args)
    m = Markings(track)
    res = m.save(args.get("name"), int(args["overwrite_version"]) if args.get("overwrite_version") else None)

    def update(pr):
        run = pr.ensure_run(_track_scope(track), "ground")
        pr.set_step(run, "data_sync", "completed")
        pr.set_step(run, "plot_marking", "completed",
                    outputs={"directory": m.directory, "version": res.get("version"), "plots": len(m.plots)})
        return pr.describe(run)

    out = {"saved_version": res.get("version"), "plots": len(m.plots), "directory": m.directory,
           "process_tab": process_tab(update)}
    auto = track.cache / "auto_marks.json"
    if auto.exists():
        # Saving is usually the last call before the reply: hand over what the person must hear.
        told = json.loads(auto.read_text()).get("tell_the_person")
        if told:
            out["tell_the_person"] = told + " The markings are saved."
    return {"result": out}


def pull_markings(args: dict) -> dict:
    m = Markings(_track(args))
    v = m.pull(int(args["version"]) if args.get("version") else None)
    return {"result": {"version": v, "plots": len(m.plots)}}


def stitch(args: dict) -> dict:
    m = Markings(_track(args))
    ids = [int(i) for i in args["plot_ids"]] if args.get("plot_ids") else None
    track = m.track
    experiment_id = args.get("experiment_id")
    holder: dict = {}

    def find_run(pr):
        holder["run"] = pr.ensure_run(_track_scope(track), "ground")

    process_tab(find_run)
    if not experiment_id and holder.get("run"):
        experiment_id = (holder["run"].get("uploadScope") or {}).get("experimentId")
    out = submit_stitch(m, ids, dict(args.get("settings") or {}), args.get("custom_options"),
                        args.get("device"), experiment_id, args.get("output_prefix"))

    def update(pr):
        run = holder.get("run") or pr.ensure_run(_track_scope(track), "ground")
        if (run["steps"].get("data_sync") or {}).get("status") != "completed":
            pr.set_step(run, "data_sync", "completed")
        marking = run["steps"].get("plot_marking") or {}
        if marking.get("status") != "completed" or not (marking.get("outputs") or {}).get("version"):
            # Stitched straight from the agent's marks: save them as a version
            # and record it, so the person can open the marking on the run.
            saved = m.save("before stitching", None)
            pr.set_step(run, "plot_marking", "completed",
                        outputs={"directory": m.directory, "version": saved.get("version"), "plots": len(m.plots)})
        pr.set_step(run, "stitching", "running", job_id=str(out["job_id"]))
        return pr.describe(run)

    out["process_tab"] = process_tab(update)
    return {"result": out}


def job(args: dict) -> dict:
    process_tab(lambda pr: pr.settle())
    j = client().job(args["job_id"])
    keep = ("id", "job_type", "status", "progress", "progress_detail", "result", "error_message",
            "started_at", "completed_at")
    return {"result": {k: j.get(k) for k in keep}}


def stitch_result(args: dict) -> dict:
    """Manifest of a stitch version and a preview of chosen plot mosaics."""
    track = _track(args)
    prefix = args["output_prefix"].rstrip("/") + "/"
    manifest = json.loads(track.client.download(prefix + "stitch_manifest.json"))
    images = []
    for pid in args.get("plot_ids") or []:
        name = f"{prefix}full_res_mosaic_temp_plot_{pid}.png"
        out = track.cache / "views" / f"stitch_{prefix.strip('/').split('/')[-1]}_plot_{pid}.webp"
        out.write_bytes(track.client.thumbnail(name, 800))
        images.append(str(out))
    return {"result": manifest, "images": images}


TOOLS: dict[str, dict[str, Any]] = {}


# Side notes a tool's inner calls leave for its result (e.g. "the worker for
# this job was started"), so the caller reads them without asking.
_notes: contextvars.ContextVar[Optional[list]] = contextvars.ContextVar("gemi_notes", default=None)


def add_note(note: dict) -> None:
    notes = _notes.get()
    if notes is not None and note not in notes:
        notes.append(note)


def _tool(fn: Callable[[dict], dict], description: str, props: dict, required: list[str],
          track: bool = True, destructive: bool = False, group: str = "ground") -> None:
    """Register a tool. `track`: it works on one rover track (adds that
    argument). `destructive`: deletes or overwrites data — runners ask the
    person before calling it. `group`: which skill area it belongs to."""
    tr = {"track": {"type": "string", "description": "Dataset folder of the rover track, e.g. "
                    "Raw/2026/EXP/SITE/POP/2026-09-17/Amiga/RGB/c0fca235/"}} if track else {}

    def call(args: dict) -> dict:
        token = _notes.set([])
        try:
            out = fn(args)
            notes = _notes.get()
            if notes and isinstance(out.get("result"), dict):
                out["result"]["workers"] = notes
            return out
        finally:
            _notes.reset(token)

    call.__name__ = fn.__name__
    TOOLS[fn.__name__] = {"fn": call, "description": description, "destructive": destructive, "group": group,
                          "schema": {"type": "object", "properties": {**tr, **props},
                                     "required": [*(["track"] if track else []), *required]}}


ALIASES: dict[str, dict[str, str]] = {
    "*": {"path": "paths", "job": "job_id", "id": "job_id", "task": "task_id", "run_id": "run", "skill": "name"},
    "upload": {"location": "site", "trial": "population", "crop": "population", "folder": "paths", "files": "paths",
               "type": "data_type", "collection_date": "date"},
    "run_inference": {"prefix": "images_prefix", "images": "images_prefix", "output": "output_predictions_path",
                      "label": "count_label", "threshold": "confidence_threshold"},
    "wait_jobs": {"job_id": "job_ids", "jobs": "job_ids", "ids": "job_ids", "timeout": "timeout_s"},
    "read_skill": {"skill_name": "name"},
    "inference_stats": {"predictions": "predictions_path", "output_predictions_path": "predictions_path",
                        "paths": "predictions_path"},
    "start_process": {"worker": "name", "process": "name"},
    "stop_process": {"worker": "name", "process": "name"},
    "run_facts": {"facts": "set"},
}


def check_args(name: str, args: dict) -> tuple[dict, Optional[str]]:
    """Arguments as the tool expects them, or a message that says exactly
    what to fix. Models often send "3" for 3, a string for a one-item list,
    or a made-up argument name; the first two are repaired, the last is
    reported with the valid names."""
    schema = TOOLS[name]["schema"]
    props, out = schema["properties"], {}
    # Optional arguments sent empty (null, "", [], {}): the model listed every argument it saw. Not sent at all.
    required = set(schema.get("required") or [])
    args = {k: v for k, v in args.items() if k in required or v not in (None, "", [], {})}
    # "run*": the mark the tool list puts on required arguments, copied into the call.
    args = {(k.rstrip("*").strip() if isinstance(k, str) and k.rstrip("*").strip() in props else k): v for k, v in args.items()}
    # Names models reach for instead of the real one ("path" for "paths", "location" for "site").
    for wrong, right in {**ALIASES.get("*", {}), **ALIASES.get(name, {})}.items():
        if wrong in args and wrong not in props and right in props and right not in args:
            args = {**{k: v for k, v in args.items() if k != wrong}, right: args[wrong]}
    unknown = [k for k in args if k not in props]
    if unknown:
        return args, (f"{name} has no argument {', '.join(repr(k) for k in unknown)}. "
                      f"Its arguments are: {', '.join(props) or '(none)'}.")
    for k, v in args.items():
        kind = props[k].get("type")
        try:
            if v is None:
                continue
            if kind == "integer" and not isinstance(v, bool) and not isinstance(v, int):
                v = int(float(v))
            elif kind == "number" and not isinstance(v, (int, float)):
                v = float(v)
            elif kind == "boolean" and isinstance(v, str):
                v = v.strip().lower() in ("true", "yes", "1")
            elif kind == "array" and not isinstance(v, list):
                v = [x.strip() for x in v.split(",")] if isinstance(v, str) and "," in v else [v]
            elif kind == "string" and isinstance(v, (int, float)) and not isinstance(v, bool):
                v = str(v)
            elif kind == "object" and isinstance(v, str):
                v = json.loads(v)
        except (ValueError, TypeError):
            return args, f"{name}: argument {k!r} must be {kind}, got {v!r}."
        out[k] = v
    # A placeholder copied from next_step ("<field design file>") is not a value.
    def blank(v: Any) -> bool:
        return isinstance(v, str) and v.strip().startswith("<") and v.strip().endswith(">") and 3 < len(v.strip()) < 90

    blanks = [k for k, v in out.items() if blank(v) or (isinstance(v, list) and any(blank(x) for x in v))]
    if blanks:
        return out, (f"{name}: {', '.join(blanks)} is still a placeholder, not a real value. "
                     "Ask the person for it; do not call the tool until they have answered.")
    missing = [k for k in schema.get("required", []) if out.get(k) in (None, "")]
    if missing:
        return out, (f"{name} needs {', '.join(missing)}. " +
                     " ".join(f"{k}: {props[k]['description']}." for k in missing if props[k].get("description")))
    return out, None


_int, _num, _str, _bool = {"type": "integer"}, {"type": "number"}, {"type": "string"}, {"type": "boolean"}
_ints = {"type": "array", "items": _int}

_tool(passes, "List the track's passes (continuous recordings): frame range, length, heading, and whether "
      "their plot boundaries have been reviewed.", {}, [])
_tool(panorama, "Picture of one whole pass (slit-scan panorama, wrapped into rows, ground-x ruler on top) with "
      "the proposed plot boundaries (stakes) drawn as numbered magenta lines; '?' marks ones inferred from the "
      "regular spacing rather than seen. Travel reads left to right.",
      {"pass": _int, "band": {"type": "array", "items": _num, "description": "slice of the frame height holding the bed, e.g. [0.5, 1]; chosen automatically and remembered per pass if omitted"},
       "zoom": _num, "x0": _int, "x1": _int, "plain": _bool, "redetect": _bool,
       "gaps": {**_bool, "description": "propose boundaries in the bare alleys between canopy blocks (fields without stakes)"},
       "crop_rows": {"type": "array", "description": "with gaps: slices of the frame height holding crop rows, e.g. [[0,0.45],[0.55,1]] when two rows are in view"},
       "from_reviewed": {**_bool, "description": "with redetect: propose from the reviewed passes by GPS even if stakes were detected"},
       "markings": {**_bool, "description": "draw the working plot markings ([id … id]) instead, for QA"}}, ["pass"])
_tool(boundary_closeups, "Close-ups around every boundary of a pass (one tile each, ruler = offset from the "
      "current position) for placing boundaries exactly on their stakes; correct with set_boundaries shift.",
      {"pass": _int, "reach": _int}, ["pass"])
_tool(boundary_closeup, "ONE boundary of a pass as a large picture with an offset ruler. Most accurate way to "
      "place a boundary: look, read the offset of the stake, then set_boundaries shift {index: offset}.",
      {"pass": _int, "index": _int}, ["pass", "index"])
_tool(set_boundaries, "Correct a pass's plot boundaries (ground x values) and mark it reviewed.",
      {"pass": _int, "xs": _ints, "add": _ints, "remove": {**_ints, "description": "boundary numbers to drop"},
       "move": {"type": "object", "description": "{boundary number: new x}"}, "reviewed": _bool,
       "shift": {"type": "object", "description": "{boundary number: offset in px}, as read off boundary_closeups"},
       "grid": {**_ints, "description": "[x of one stake, x of a later stake, plots between them]: evenly spaced "
                "boundaries snapped onto stakes; use when the proposal is wrong"},
       "before": _int, "after": _int,
       "keep": {**_ints, "description": "[i, j]: boundary numbers i..j are the real stakes; drop the others"},
       "ends": {**_ints, "description": "[before, after]: keep first..last seen stake and add this many "
                "plot-lengths outside them (clipped to the recording), replacing guessed end boundaries"}}, ["pass"])
_tool(apply_boundaries, "Rebuild the plot markings from all reviewed passes' boundaries: one plot between each "
      "pair of boundaries, numbered in capture order.",
      {"tight": _bool, "min_frames": _int, "direction": _str, "first_plot_id": _int, "include_unreviewed": _bool,
       "planted_fraction": {**_num, "description": "share of each stake-to-stake stretch that is planted (e.g. 0.62); "
                            "the plot is then only that part, leaving the bare alley out"},
       "planted_at": {**_str, "description": "start | end | auto (default): which end of the stretch the plants are at, in travel order"}}, [])
_tool(sheet, "Contact sheet of frames first..last (every step-th), each labelled with its frame index.",
      {"first": _int, "last": _int, "step": _int, "size": _int, "columns": _int}, ["first", "last"])
_tool(frame, "One frame, large.", {"index": _int, "size": _int}, ["index"])
_tool(plot_view, "A marked plot's start and end frames with their neighbours, to check the edges.",
      {"plot_id": _int}, ["plot_id"])
_tool(profile, "Green cover per frame (dips are gaps between plots).",
      {"first": _int, "last": _int, "step": _int}, ["first", "last"])
_tool(mark, "Set or change one plot by hand: start/end frame index and stitching direction "
      "(up/down/left/right = camera movement relative to the image). plots_per_frame / split set the "
      "track's layout when one frame shows several plots (e.g. 2, top_bottom: one plot in the top half, "
      "one in the bottom); each marked stretch is then stitched as that many plots.",
      {"plot_id": _int, "start": _int, "end": _int, "direction": _str, "note": _str, "delete": _bool,
       "plots_per_frame": _int, "split": {"type": "string", "enum": ["top_bottom", "left_right"]}}, [])
_tool(markings, "The working plot markings, problems found, and the versions saved in the app.",
      {"list": _bool, "first_plot_id": _int, "last_plot_id": _int}, [])
_tool(save_markings, "Save the working markings as a Plot Marking version in the app (new version unless "
      "overwrite_version is given).", {"name": _str, "overwrite_version": _int}, [])
_tool(pull_markings, "Replace the working markings with a version saved in the app.", {"version": _int}, [])
_tool(stitch, "Submit a RUN_STITCH job for the marked plots (all, or plot_ids). settings override the defaults "
      "forward_limit 4, max_reprojection_error 1.0, batch_size 10, min_inliers 20.",
      {"plot_ids": _ints, "settings": {"type": "object"}, "custom_options": _str, "device": _str,
       "experiment_id": _str, "output_prefix": _str}, [])
_tool(stitch_result, "A stitch version's manifest (per-plot outcome) and previews of chosen plot mosaics.",
      {"output_prefix": _str, "plot_ids": _ints}, ["output_prefix"])

from . import app_tools  # noqa: E402,F401  (registers the app-wide tools)
from . import hpc_tools  # noqa: E402,F401  (cluster setup and session tools)
from . import stats_tools  # noqa: E402,F401  (numbers and charts for results)
from . import field_tools  # noqa: E402,F401  (field design, plot boundaries, plot images)
from . import traversal  # noqa: E402,F401  (rover plots from the driving pattern)
from . import compute  # noqa: E402,F401  (what runs where: workers, start/stop)
from . import guide  # noqa: E402,F401  (next_step: the one thing to do next)
from . import automark  # noqa: E402,F401  (rover plots from the canopy's own rhythm)
from . import analysis_tools  # noqa: E402,F401  (the Analyze tab: trait data and its analyses)
from . import genotype_tools  # noqa: E402,F401  (the Genotyping tab: marker studies and GWAS)
from . import plot_images  # noqa: E402,F401  (photos with no GPS, paired with the field design)
