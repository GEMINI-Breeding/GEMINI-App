"""Several orthomosaics in one date's folder (e.g. one flight per treatment:
well-watered and drought blocks flown separately). One set of plot
boundaries covers them all; each plot is cut and measured from the
orthomosaic whose centre it is nearest — where flights overlap, a mosaic's
middle is better than another's edge. The app shows the same choice.

Each ODM orthomosaic is named odm_orthophoto-{job id}.tif; the job records
which upload it came from (so where it was flown) and its elevation model.
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional

ORTHO = re.compile(r"odm_orthophoto-([0-9a-f-]{36})\.tif$")


def _scope_raw(folder: str) -> str:
    """Processed/{season}/…/{sensor}/ → Raw/{season}/…/{sensor}/"""
    return "Raw/" + folder[len("Processed/"):]


def orthos_in(c: Any, folder: str) -> list[dict]:
    """The folder's ODM orthomosaics: path, dsm, centre (lon, lat), upload ids."""
    folder = folder.rstrip("/") + "/"
    names: list[str] = []
    offset = 0
    while True:  # every file: plot images sort first and can fill a page
        page = c.list_page(folder, 500, offset)
        names += [f.get("object_name") or "" for f in page.get("files") or []]
        offset += 500
        if offset >= int(page.get("total_count") or 0):
            break
    out = []
    for name in names:
        m = ORTHO.search(name)
        if not m or "/" in name[len(folder):]:
            continue
        job_id = m.group(1)
        info: dict = {"path": name, "job_id": job_id, "dsm": None, "centre": None, "uploads": []}
        try:
            job = c.job(job_id)
            info["finished"] = job.get("completed_at") or job.get("created_at") or ""
            info["uploads"] = list((job.get("parameters") or {}).get("dataset_short_ids") or [])
            dsm = (job.get("result") or {}).get("dsm_path")
            if dsm and dsm in names:
                info["dsm"] = dsm
        except Exception:
            pass
        if not info["dsm"]:
            guess = name.replace("odm_orthophoto-", "odm_dsm-")
            info["dsm"] = guess if guess in names else None
        pts = []
        for up in info["uploads"]:
            try:
                res = c.get_json(f"/api/files/image-gps/gemini/{_scope_raw(folder)}{up}/Images/")
                pts += [(p["lon"], p["lat"]) for p in res.get("images") or [] if p.get("lat") and p.get("lon")]
            except Exception:
                continue
        if pts:
            info["centre"] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        out.append(info)
    # A flight re-run leaves its older orthomosaic beside the new one: keep
    # the newest per upload.
    newest: dict = {}
    for o in out:
        key = tuple(sorted(o["uploads"])) or (o["path"],)
        if key not in newest or (o.get("finished") or "") > (newest[key].get("finished") or ""):
            newest[key] = o
    return list(newest.values())


def _centroid(feature: dict) -> Optional[tuple[float, float]]:
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []
    ring = coords[0] if geom.get("type") == "Polygon" and coords else None
    if not ring:
        return None
    pts = ring[:-1] if len(ring) > 1 else ring
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def assign(features: list[dict], orthos: list[dict], covers=None) -> dict[str, list[dict]]:
    """{ortho path: the plot features nearest its centre}. With one ortho (or
    centres unknown) every plot goes to the first.

    `covers(ortho, feature)` -> share of the plot with image on that ortho.
    Where flights end, the nearest ortho can have no image over a plot that
    the other covers: a plot goes to the nearest ortho that covers it (90 %),
    else to the one that covers the most."""
    placed = [o for o in orthos if o.get("centre")]
    if len(placed) < 2:
        return {orthos[0]["path"]: features} if orthos else {}
    out: dict[str, list[dict]] = {o["path"]: [] for o in placed}
    for f in features:
        c = _centroid(f)
        if c is None:
            continue
        kx = math.cos(math.radians(c[1]))
        near = sorted(placed, key=lambda o: ((o["centre"][0] - c[0]) * kx) ** 2 + (o["centre"][1] - c[1]) ** 2)
        best = near[0]
        if covers is not None:
            share = [(covers(o, f), i) for i, o in enumerate(near)]
            full = [i for sh, i in share if sh >= 0.9]
            best = near[full[0]] if full else near[max(share)[1]]
        out[best["path"]].append(f)
    return out
