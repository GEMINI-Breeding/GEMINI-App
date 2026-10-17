"""Mark every plot of a rover track from the plants themselves, in one call.

A bed is a row of plots: stretches with plants, separated by alleys of bare
soil. That rhythm is in the picture whether or not there are stakes, and it
is the same down the whole field, so it can be measured instead of read off
plot by plot:

1. the canopy profile along each pass (how much green at each ground position);
2. the plot pitch, from the profile's own repetition (autocorrelation), which
   works for seedlings covering a few percent of the row as for closed canopy;
3. the alleys: one boundary per pitch, each settling in the emptiest stretch
   near where the rhythm expects it (so uneven driving speed is followed and a
   missing plot does not shift the numbering);
4. the planted block: the run of plots that actually carry plants. With the
   expected number of plots per bed (from the field design or the person) the
   best-fitting block of exactly that many is taken.

For each plot it also measures the planted length against what one camera
frame shows. Where the plants of a plot fit in a single frame, stitching adds
nothing (and stitches bare soil badly): the frame in which the plot is
centred is the plot image. Where they do not, the plot needs stitching. The
tool reports which case a track is, plot by plot.

Passes where the rhythm is weak or the count is off are flagged for a look;
they are not guessed.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import numpy as np

from .ground import Markings
from .panorama import Panorama
from .tools import _bool, _int, _ints, _str, _tool, _track

ONE_FRAME = 0.92       # a plot whose plants span at most this share of the frame width fits one frame


def canopy_profile(pano: Panorama, bands: list[tuple[float, float]]) -> np.ndarray:
    """Share of green pixels at each ground x (smoothed), over the crop rows."""
    from PIL import Image

    a = np.asarray(Image.open(pano.raw_path), dtype=np.float32) / 255.0
    exg = (2 * a[..., 1] - a[..., 0] - a[..., 2]) / (a.sum(axis=2) + 1e-6)
    green = (exg > 0.06) & (a[..., 1] > 0.15)
    h = pano.height
    prof = np.zeros(pano.total, dtype=np.float32)
    for b0, b1 in bands:
        prof = np.maximum(prof, green[int(h * b0): int(h * b1)].mean(axis=0)[: pano.total])
    return np.convolve(np.pad(prof, 20, mode="edge"), np.ones(41) / 41, mode="valid")


def bands_for(pano: Panorama, crop_rows: Optional[list]) -> list[tuple[float, float]]:
    """Where the crop is in the frame: as given, else the greener half."""
    if crop_rows:
        return [(float(a), float(b)) for a, b in crop_rows]
    return [(0.0, 0.5)] if pano.bed_half() == 0 else [(0.5, 1.0)]


def rhythm(sm: np.ndarray, view: int) -> tuple[Optional[float], float]:
    """The plot pitch (px) from the profile's repetition, and how strong the
    repetition is (0-1). Looks between half a frame and eight frames."""
    x = sm - sm.mean()
    if float(x.std()) < 1e-4:
        return None, 0.0
    n = 1 << int(np.ceil(np.log2(len(x) * 2)))
    f = np.fft.rfft(x, n)
    ac = np.fft.irfft(f * np.conj(f))[: len(x)]
    ac = ac / (ac[0] + 1e-9)
    lo, hi = int(0.5 * view), int(min(8 * view, len(x) // 3))
    if hi <= lo + 5:
        return None, 0.0
    seg = ac[lo:hi]
    peaks = [i for i in range(2, len(seg) - 2) if seg[i] >= seg[i - 1] and seg[i] >= seg[i + 1]
             and seg[i] >= seg[i - 2] and seg[i] >= seg[i + 2]]
    if not peaks:
        return None, 0.0
    best = max(seg[i] for i in peaks)
    # The shortest repeat among the strong ones: its multiples repeat just as well.
    first = next(i for i in peaks if seg[i] >= 0.8 * best)
    return float(lo + first), float(max(0.0, best))


def alleys(sm: np.ndarray, pitch: float) -> list[tuple[int, bool]]:
    """One boundary per pitch across the whole pass: (x, seen). `seen` is False
    where no emptier stretch stood out and the rhythm alone placed it."""
    k = max(21, int(0.22 * pitch) | 1)
    empty = np.convolve(np.pad(sm, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    # Phase of the alley comb: the offset at which a tooth every pitch sees the least canopy.
    offsets = np.arange(0, int(pitch))
    teeth = [empty[np.clip((o + np.arange(0, len(sm) / pitch) * pitch).astype(int), 0, len(sm) - 1)].mean() for o in offsets]
    phase = float(offsets[int(np.argmin(teeth))])
    contrast = float(np.percentile(sm, 85)) - float(np.percentile(empty, 10))
    out: dict[int, tuple[int, bool]] = {}
    mid = round((len(sm) / 2 - phase) / pitch)
    for step in (1, -1):                               # outwards from the middle, following the drift
        x = phase + mid * pitch
        j = mid
        while -pitch * 0.5 <= x <= len(sm) - 1 + pitch * 0.5:
            lo, hi = int(max(0, x - 0.2 * pitch)), int(min(len(sm) - 1, x + 0.2 * pitch))
            if hi > lo:
                i = lo + int(np.argmin(empty[lo:hi + 1]))
                around = float(np.mean(sm[max(0, i - int(pitch * 0.5)): i + int(pitch * 0.5) + 1]))
                seen = contrast > 0 and empty[i] < around - 0.25 * contrast
                pos = i if seen else int(np.clip(x, 0, len(sm) - 1))
                out[j] = (pos, bool(seen))
                x = float(pos)
            x += step * pitch
            j += step
    return [out[j] for j in sorted(out)]


# Image scale of the rover's top camera in a 480 px wide view: pixels of ground travelled per metre.
# Measured on two fields a year apart (215-222 on every pass); it follows from the camera's height,
# so it holds without GPS. Used only when a pass has no usable distance of its own.
PX_PER_M_480 = 217.0


def px_per_metre(pano: Panorama, metres: Optional[float]) -> tuple[float, str]:
    """Pixels of this pass's panorama per metre driven, and where the number comes from."""
    if metres and metres > 5 and pano.gps_ok:
        return (pano.total - pano.width) / float(metres), "this pass's GPS distance"
    return PX_PER_M_480 * pano.width / 480.0, "the camera's usual image scale (no usable distance on this pass)"


def mark_pass(pano: Panorama, bands: list[tuple[float, float]], expected: Optional[int] = None,
              pitch_hint: Optional[float] = None, pitch_known: bool = False) -> dict:
    """The plots of one pass, with how sure the rhythm was. `pitch_known`: the
    hint is the plot length the person or the field design gave, in pixels;
    it is used as it is, and the crop only decides where the first boundary falls."""
    sm = canopy_profile(pano, bands)
    pitch, strength = rhythm(sm, pano.width)
    disagrees = None
    if pitch_hint and pitch_known:
        if pitch and strength >= 0.35 and not 0.85 <= pitch / pitch_hint <= 1.18:
            disagrees = round(float(pitch))                  # the crop's own clear rhythm says otherwise: flag it
        pitch, from_hint = float(pitch_hint), True
    elif pitch_hint and (pitch is None or strength < 0.25 or not 0.8 <= pitch / pitch_hint <= 1.25):
        pitch, from_hint = float(pitch_hint), True        # this bed is thin: use the field's own rhythm
    else:
        from_hint = False
    if pitch is None:
        return {"plots": [], "pitch": None, "strength": 0.0, "problem": "no repeating plots found in this pass"}
    bounds = alleys(sm, pitch)
    xs = [b[0] for b in bounds]
    level = float(min(0.12, max(0.006, 0.3 * np.percentile(sm, 92))))
    cells = []
    for (a, sa), (b, sb) in zip(bounds, bounds[1:]):
        if b - a < 0.5 * pitch:
            continue
        seg = sm[a:b]
        on = np.flatnonzero(seg > level)
        lo = hi = None
        if len(on):
            # Where the plants are: the stretch holding the middle 92 % of the green,
            # so a weed in the alley does not stretch the plot.
            mass = np.cumsum(np.where(seg > level, seg, 0.0))
            lo = int(a + np.searchsorted(mass, 0.04 * mass[-1]))
            hi = int(a + np.searchsorted(mass, 0.96 * mass[-1]))
        cells.append({"x0": int(a), "x1": int(b), "green": float(seg.mean()), "seen": bool(sa and sb), "lo": lo, "hi": hi})
    if not cells:
        return {"plots": [], "pitch": pitch, "strength": strength, "problem": "no plots between the alleys"}
    greens = np.array([c["green"] for c in cells])
    planted = greens > 0.3 * float(np.median(np.sort(greens)[len(greens) // 2:]))
    if expected and len(cells) >= expected:
        # Exactly the expected number: the block of that many with the most plants in it.
        sums = [greens[i:i + expected].sum() for i in range(len(cells) - expected + 1)]
        start = int(np.argmax(sums))
        block = cells[start:start + expected]
    else:
        # The longest run of plots that carry plants (a single bare plot inside it is kept).
        best, cur = (0, 0), None
        gap = 0
        for i, p in enumerate(list(planted) + [False, False]):
            if p:
                cur = (cur[0], i + 1) if cur else (i, i + 1)
                gap = 0
            elif cur:
                gap += 1
                if gap > 1:
                    if cur[1] - cur[0] > best[1] - best[0]:
                        best = cur
                    cur, gap = None, 0
        block = cells[best[0]:best[1]]
    problem = None
    if expected and len(block) != expected:
        problem = f"found {len(block)} plots, expected {expected}"
    elif disagrees:
        problem = (f"the crop's own spacing here ({disagrees} px) differs from the plot length given "
                   f"({round(pitch)} px): check the plot length, or this pass")
    elif strength < 0.15 and not from_hint:
        problem = "the plot rhythm is weak here (thin stand, weeds, or the wrong half of the frame)"
    return {"plots": block, "pitch": pitch, "strength": round(strength, 2), "pitch_from_field": from_hint,
            "unseen_boundaries": sum(1 for c in block if not c["seen"]), "problem": problem}


def frames_for(pano: Panorama, cell: dict, pad: int = 20) -> dict:
    """Which frames show a plot: one, if its plants fit a single frame; else the
    run from "first plants about to leave the view" to "last plants just in view"."""
    lo = cell["lo"] if cell["lo"] is not None else cell["x0"]
    hi = cell["hi"] if cell["hi"] is not None else cell["x1"]
    span = hi - lo                                   # the plants themselves decide; the margin is for stitching
    centre = pano.frame_at((lo + hi) / 2, "centre")
    # Where the plot lies in that frame, as shares of its width: out to the middle of
    # the alley on each side (never into the neighbour), or to the frame's edge.
    left = float(pano.centre[centre - pano.first]) - pano.width / 2
    # The whole plot, not just the plants seen: a thin stand still owns its ground.
    a = max(0.0, (cell["x0"] - left) / pano.width)
    b = min(1.0, (cell["x1"] - left) / pano.width)
    if pano.scene_moves_right:                       # the panorama shows these frames mirrored
        a, b = 1.0 - b, 1.0 - a
    whole = left <= lo and hi <= left + pano.width   # the frame really holds both ends of the plants
    lo, hi = max(cell["x0"], lo - pad), min(cell["x1"], hi + pad)
    start, end = pano.frame_at(lo, "exit"), pano.frame_at(hi, "entry")
    start, end = max(pano.first, min(start, end)), min(pano.last, max(start, end))
    if end <= start:                                 # a plot far shorter than a frame: keep a real span
        start, end = max(pano.first, centre - 1), min(pano.last, centre + 1)
    return {"one_frame": bool(span <= ONE_FRAME * pano.width and whole), "frame": centre, "crop": [round(a, 3), round(b, 3)],
            "start": start, "end": end, "views": round(span / pano.width, 2)}


def single_frames(track) -> dict[int, dict]:
    """Marked plots whose plants fit one frame: plot_id -> {frame, crop}. Only
    while the marking is still the one made here; a plot corrected by hand
    since goes back to being stitched."""
    path = track.cache / "auto_marks.json"
    if not path.exists():
        return {}
    now = {p["plot_id"]: (p["start"], p["end"]) for p in Markings(track).plots}
    return {int(q["plot_id"]): {"frame": int(q["frame"]), "crop": q.get("crop") or [0.0, 1.0]}
            for q in json.loads(path.read_text()).get("plots", [])
            if q.get("one_frame") and now.get(q["plot_id"]) == (q["start"], q["end"])}


def mode_of(track) -> str | None:
    """What the automatic marking recommended for this track, if it was used."""
    path = track.cache / "auto_marks.json"
    return json.loads(path.read_text()).get("mode") if path.exists() else None


def mark_plots_auto(args: dict) -> dict:
    track = _track(args)
    passes = track.passes()
    want = {int(p) for p in args.get("passes") or []}
    per_bed = int(args["plots_per_bed"]) if args.get("plots_per_bed") else None
    border = int(args.get("border_plots") or 0)
    expected = per_bed + 2 * border if per_bed else None
    todo = [p for p in passes if not want or p["pass"] in want]
    panos = {p["pass"]: Panorama(track, p["first"], p["last"]) for p in todo}
    bands = {n: bands_for(pano, args.get("crop_rows")) for n, pano in panos.items()}
    # First look: the rhythm of each pass on its own. The field's pitch is the
    # usual one among the passes where it is clear; thin beds then borrow it.
    first = {n: rhythm(canopy_profile(pano, bands[n]), pano.width) for n, pano in panos.items()}
    clear = sorted(p for p, s in first.values() if p and s >= 0.25)
    field_pitch = float(clear[len(clear) // 2]) if clear else None
    spacing_m = float(args["plot_spacing_m"]) if args.get("plot_spacing_m") else None
    scale = {p["pass"]: px_per_metre(panos[p["pass"]], p.get("metres")) for p in todo}
    measured_m = sorted(first[p["pass"]][0] / scale[p["pass"]][0] for p in todo
                        if first[p["pass"]][0] and first[p["pass"]][1] >= 0.25)
    report, plots_out, images = [], [], []
    plot_id = int(args.get("first_plot_id") or 1)
    one, total = 0, 0
    for p in todo:
        pano = panos[p["pass"]]
        if spacing_m:
            got = mark_pass(pano, bands[p["pass"]], expected, spacing_m * scale[p["pass"]][0], pitch_known=True)
        else:
            got = mark_pass(pano, bands[p["pass"]], expected, field_pitch)
        cells = got["plots"][border: len(got["plots"]) - border] if border and len(got["plots"]) > 2 * border else got["plots"]
        row: dict[str, Any] = {"pass": p["pass"], "plots": len(cells),
                               "plot_length_in_views": round(got["pitch"] / pano.width, 2) if got["pitch"] else None,
                               "rhythm": got["strength"]}
        if got.get("pitch_from_field"):
            row["note"] = "thin bed: plot length taken from the rest of the field"
        if got.get("unseen_boundaries"):
            row["boundaries_placed_by_rhythm_only"] = got["unseen_boundaries"]
        if got.get("problem"):
            row["check"] = got["problem"]
        report.append(row)
        for c in cells:
            fr = frames_for(pano, c)
            total += 1
            one += fr["one_frame"]
            plots_out.append({"plot_id": plot_id, "start": fr["start"], "end": fr["end"], "direction": pano.camera_direction,
                              "note": f"pass {p['pass']} x {c['x0']}-{c['x1']} (plants {c['lo']}-{c['hi']})",
                              "one_frame": bool(fr["one_frame"]), "frame": int(fr["frame"]), "crop": fr["crop"],
                              "views": fr["views"],
                              "pass": p["pass"]})
            plot_id += 1
    flagged = [r["pass"] for r in report if r.get("check")]
    share = one / total if total else 0.0
    if share >= 0.9:
        advice = ("Skip stitching for this track: in %d of %d plots all the plants fit in one camera frame. Tell the "
                  "person. place_plot_images then uses, for each plot, the raw frame with the plot in its middle "
                  "(no stitch job); the few longer plots are stitched by stitch_units." % (one, total))
        mode = "single frames"
    elif share <= 0.1:
        advice = "Stitch this track: the plants of a plot span about %.1f camera frames." % (
            float(np.median([q["views"] for q in plots_out])) if plots_out else 0)
        mode = "stitch"
    else:
        advice = ("Mixed: %d of %d plots fit one frame and need no stitching; stitch_units stitches only the others, "
                  "and place_plot_images files both kinds." % (one, total))
        mode = "mixed"
    # What the person must hear, whatever else is reported: small models repeat a sentence
    # they are handed far more reliably than they compose one from a table.
    tell = f"{total} plots marked on {len(report)} passes. " + (
        "Please check pass " + ", ".join(str(n) for n in flagged) + ": " +
        "; ".join(sorted({r["check"] for r in report if r.get("check")})) + ". " if flagged else "No pass needed a second look. ") + (
        {"single frames": "Stitching is not needed for this dataset: each plot fits one camera frame.",
         "stitch": "The plots are longer than a camera frame, so they are stitched next.",
         "mixed": f"{one} plots fit one camera frame and are not stitched; the other {total - one} are."}[mode])
    if not args.get("dry_run") and plots_out:
        m = Markings(track)
        m.plots = [{k: q[k] for k in ("plot_id", "start", "end", "direction", "note")} for q in plots_out]
        m._write()
        (track.cache / "auto_marks.json").write_text(json.dumps({"mode": mode, "tell_the_person": tell, "plots": plots_out}, indent=1))
    saved = None
    if args.get("save") and not args.get("dry_run") and plots_out and not flagged:
        from .tools import TOOLS

        problems = Markings(track).problems()
        if not problems:
            saved = TOOLS["save_markings"]["fn"]({"track": track.prefix})["result"].get("saved_version")
    for n in (flagged[:2] or [todo[0]["pass"]] if todo else []):
        images.append(str(overlay(panos[n], [q for q in plots_out if q["pass"] == n], bands[n],
                                  track.cache / "views" / f"auto_pass_{n}.jpg")))
    return {"result": {"plots": total, "passes_marked": len(report), "passes_to_check": flagged or None,
                       "plots_fitting_one_frame": one, "recommendation": mode, "advice": advice,
                       "tell_the_person": tell,
                       "field_plot_length_px": round(field_pitch) if field_pitch else None,
                       "plot_spacing_m": ({"used": spacing_m, "from": "given by the person or the field design",
                                           "image_scale_from": sorted({v[1] for v in scale.values()})} if spacing_m else
                                          {"measured": round(float(np.median(measured_m)), 2) if measured_m else None,
                                           "passes_it_was_clear_on": len(measured_m),
                                           "what_it_is": "plot length plus alley, in metres, as the crop shows it. It "
                                                         "stays the same all season: record it for this field "
                                                         "(run_facts plot_spacing_m) and give it on other dates, "
                                                         "when the crop no longer shows the alleys"}),
                       "passes": report if len(report) <= 12 else report[:6] + [{"…": f"{len(report) - 12} more"}] + report[-6:],
                       "saved_as_working_markings": bool(plots_out) and not args.get("dry_run"),
                       "saved_version": saved,
                       "next": (("NOTHING IS SAVED: this was a dry run. Call mark_plots_auto again without dry_run. "
                                 if args.get("dry_run") else "")
                                + (f"Look at pass {', '.join(str(n) for n in flagged)} with panorama (only `track`, `pass` and "
                                   "`markings`: true); then save_markings. " if flagged else
                                   "The markings are saved; tell the person what `tell_the_person` says. " if saved else
                                   "No pass needs a look: call save_markings now, then tell the person what "
                                   "`tell_the_person` says. ")
                                + advice)},
            "images": images}


def overlay(pano: Panorama, plots: list[dict], bands: list[tuple[float, float]], path) -> Any:
    """The pass with each plot's planted stretch boxed, wrapped into rows."""
    from PIL import Image, ImageDraw

    src = Image.open(pano.raw_path).convert("RGB")
    d = ImageDraw.Draw(src)
    for q in plots:
        note = q["note"]
        x0, x1 = (int(v) for v in note.split(" x ")[1].split(" ")[0].split("-"))
        for b0, b1 in bands:
            d.rectangle([x0, int(pano.height * b0) + 2, x1, int(pano.height * b1) - 2],
                        outline=(255, 0, 255) if not q["one_frame"] else (0, 255, 255), width=3)
        d.text((x0 + 6, 6), f"{q['plot_id']}{' (1 frame)' if q['one_frame'] else ''}", fill=(255, 255, 0))
    row_w = 2400
    rows = [src.crop((x, 0, min(x + row_w, src.width), src.height)) for x in range(0, src.width, row_w)]
    sheet = Image.new("RGB", (row_w, len(rows) * (src.height + 6)), (20, 20, 20))
    for i, r in enumerate(rows):
        sheet.paste(r, (0, i * (src.height + 6)))
    if sheet.height > 2200:
        sheet = sheet.resize((int(row_w * 2200 / sheet.height), 2200))
    sheet.save(path, quality=88)
    return path


_tool(mark_plots_auto, "Mark every plot of a rover track in one call, from where plants are and where bare soil is "
      "(no stakes needed). Finds the plot length from the field's own rhythm, places a boundary in each alley, "
      "keeps the plots that carry plants, and says for each plot whether its plants fit ONE camera frame (then no "
      "stitching is needed) or need stitching. Give plots_per_bed if the person or the field design says it.",
      {"plots_per_bed": {**_int, "description": "measured plots in one bed, without border plots"},
       "border_plots": {**_int, "description": "border plots at each end of a bed (not kept)"},
       "plot_spacing_m": {"type": "number", "description": "plot length plus alley, in metres, if the person or the "
                          "field design gives it (a 10 ft plot is 3.05). Then boundaries no longer depend on how "
                          "the crop looks: use it for very young or closed canopies"},
       "crop_rows": {"type": "array", "description": "where the crop is in the frame height, e.g. [[0,0.45],[0.55,1]] "
                     "for two rows; default: the greener half"},
       "save": {**_bool, "description": "also save the markings when no pass needs a look (continue_run sets this)"},
       "passes": _ints, "first_plot_id": _int, "dry_run": _bool}, [], track=True, group="ground")
_ = _str
