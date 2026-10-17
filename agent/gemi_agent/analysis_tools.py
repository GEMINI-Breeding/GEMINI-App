"""The Analyze tab for an agent: what trait data there is, and the analyses the
app runs on it (summary, correlation, ANOVA, heritability, PCA, GGE, field
pattern), each answered with the few numbers a person would read off the
chart and a sentence that says what they mean.

Everything is named in words: an experiment, a season, a site, a trait
("yield" finds "Yield (kg/ha)"). Nothing here takes an id.
"""
from __future__ import annotations

import statistics
from typing import Any, Optional

from .tools import _str, _tool, client

API = "/api/multivariate_analysis"
KINDS = {
    "summary": "mean, spread and number of plots for each trait",
    "correlation": "how traits move together (two or more traits)",
    "anova": "whether genotypes differ in a trait, per environment",
    "heritability": "how much of a trait's variation is genetic, and the best and worst genotypes",
    "pca": "the main directions of variation across several traits (two or more traits)",
    "gge": "which genotypes did best in which environment (one trait, two or more environments)",
    "field": "the pattern of one trait across the field's rows and columns (one trait)",
}
_ALIASES = {"corr": "correlation", "correlations": "correlation", "h2": "heritability", "blup": "heritability",
            "blups": "heritability", "spatial": "field", "map": "field", "heatmap": "field", "biplot": "gge",
            "stats": "summary", "describe": "summary", "distribution": "summary", "variance": "anova"}


def _catalog() -> list[dict]:
    return client().get_json(f"{API}/catalog") or []


def _pick(words: Optional[str], names: list[str], what: str) -> Optional[list[str]]:
    """Names matching what was said ("davis", "2022 and 2023", "all"); None = no filter."""
    if not words or str(words).strip().lower() in ("all", "any", "every", "*"):
        return None
    said = [w.strip().lower() for w in str(words).replace(" and ", ",").replace(";", ",").split(",") if w.strip()]
    out = []
    for s in said:
        hit = [n for n in names if n.lower() == s] or [n for n in names if s in n.lower() or n.lower() in s]
        if not hit:
            raise ValueError(f"no {what} matches {s!r}. There are: {', '.join(sorted(set(names))[:15])}")
        out += hit
    return sorted(set(out))


# Everyday words for a trait, and the fragments column names use for it.
TRAIT_WORDS = {"flowering": ("ft", "flower", "anthesis", "dtf", "heading"), "flower": ("ft", "flower", "anthesis", "dtf"),
               "maturity": ("mat", "dtm", "maturity"), "height": ("height", "ht", "pht"), "yield": ("yield", "yld"),
               "stand": ("stand", "emergence", "count"), "biomass": ("biomass", "dry weight", "dw"),
               "canopy": ("canopy", "cover", "ndvi")}


def match_trait(words: str, available: list[str]) -> list[str]:
    """Trait names that a person's words for a trait could mean."""
    item = str(words).strip()
    low = item.lower().replace("_", " ")

    def norm(t: str) -> str:
        return t.lower().replace("_", " ")

    hit = [t for t in available if t.lower() == item.lower()] or \
          [t for t in available if low in norm(t)] or \
          [t for t in available if all(w in norm(t) for w in low.split())]
    if not hit:
        for word, fragments in TRAIT_WORDS.items():
            if word in low:
                hit = [t for t in available if any(f in norm(t).split() or norm(t).startswith(f + " ") or f in norm(t).replace(" ", "")
                                                   and len(f) > 3 for f in fragments)]
                if hit:
                    break
    return hit


def _traits(said: Any, available: list[str]) -> list[str]:
    if not said or (isinstance(said, str) and said.strip().lower() in ("all", "every", "*")):
        return available
    items = said if isinstance(said, list) else [w for w in str(said).replace(" and ", ",").split(",")]
    out = []
    for item in (str(i).strip() for i in items if str(i).strip()):
        hit = match_trait(item, available)
        if not hit:
            raise ValueError(f"no trait matches {item!r} in this data. Traits: {', '.join(available)}")
        out += hit
    return list(dict.fromkeys(out))


def _scope(args: dict) -> tuple[dict, list[dict]]:
    """The request filters and the catalog rows they select."""
    cat = _catalog()
    if not cat:
        raise ValueError("there is no trait data in the app yet (traits come from trait extraction, canopy_cover, "
                         "inference per plot, or an imported table)")
    exps = _pick(args.get("experiment"), [str(c["experiment_name"]) for c in cat], "experiment")
    rows = [c for c in cat if exps is None or c["experiment_name"] in exps]
    seasons = _pick(args.get("season"), [str(c["season_name"]) for c in rows], "season")
    rows = [c for c in rows if seasons is None or str(c["season_name"]) in seasons]
    sites = _pick(args.get("site"), [str(c["site_name"]) for c in rows], "site")
    rows = [c for c in rows if sites is None or str(c["site_name"]) in sites]
    if exps is None and len({c["experiment_name"] for c in rows}) > 1:
        raise ValueError("say which experiment. Experiments with trait data: " +
                         ", ".join(sorted({str(c["experiment_name"]) for c in rows})[:20]))
    body: dict[str, Any] = {}
    if exps:
        body["experiment_names"] = exps
    if seasons:
        body["season_names"] = seasons
    if sites:
        body["site_names"] = sites
    return body, rows


def traits_available(args: dict) -> dict:
    """What trait data the app holds: per experiment, season and site."""
    cat = _catalog()
    exps = _pick(args.get("experiment"), [str(c["experiment_name"]) for c in cat], "experiment") if cat else None
    rows = [c for c in cat if exps is None or c["experiment_name"] in exps]
    if exps is None and len(rows) > 12:
        # Many: one line per experiment first.
        by: dict[str, dict] = {}
        for c in rows:
            e = by.setdefault(str(c["experiment_name"]), {"experiment": c["experiment_name"], "environments": 0, "traits": set(),
                                                         "plots": 0})
            e["environments"] += 1
            e["traits"] |= set(c["trait_names"])
            e["plots"] += int(c["plot_count"] or 0)
        out = [{**e, "traits": sorted(e["traits"])[:12]} for e in by.values()]
        return {"result": {"experiments": out, "next": "traits_available with `experiment` for its seasons and sites; "
                                                       "analyze with `experiment` and `kind` for an analysis"}}
    return {"result": {"trait_data": [{"experiment": c["experiment_name"], "season": c["season_name"], "site": c["site_name"],
                                       "traits": c["trait_names"], "plots": c["plot_count"]} for c in rows],
                       "analyses": KINDS,
                       "next": "analyze with `experiment`, `kind`, and `traits` (words are enough: \"yield\")"}}


def _r(x: Any, n: int = 3) -> Any:
    return round(float(x), n) if isinstance(x, (int, float)) else x


def analyze(args: dict) -> dict:
    kind = str(args.get("kind") or "summary").strip().lower()
    kind = _ALIASES.get(kind, kind)
    if kind not in KINDS:
        raise ValueError(f"kind must be one of: {', '.join(KINDS)}")
    body, rows = _scope(args)
    available = sorted({t for c in rows for t in c["trait_names"]})
    traits = _traits(args.get("traits") or args.get("trait"), available)
    envs = sorted({f"{c['season_name']} · {c['site_name']}" for c in rows})
    scope_words = f"{rows[0]['experiment_name']}, " + (envs[0] if len(envs) == 1 else f"{len(envs)} environments")
    c = client()
    if kind in ("gge", "field") and len(traits) != 1:
        if args.get("traits") or args.get("trait"):
            raise ValueError(f"{kind} takes exactly one trait; choose one of: {', '.join(traits)}")
        raise ValueError(f"{kind} takes exactly one trait; say which: {', '.join(available)}")
    if kind in ("correlation", "pca") and len(traits) < 2:
        raise ValueError(f"{kind} needs two or more traits; this data has: {', '.join(available)}")
    body["trait_names"] = traits
    out: dict[str, Any] = {"analysis": kind, "data": scope_words, "traits": traits}

    if kind == "summary":
        res = c.post_json(f"{API}/matrix", body)
        table = []
        for t in traits:
            vals = [float(r["values"][t]) for r in res.get("rows") or [] if isinstance(r["values"].get(t), (int, float))]
            if vals:
                table.append({"trait": t, "plots": len(vals), "mean": _r(statistics.mean(vals)),
                              "sd": _r(statistics.pstdev(vals)), "min": _r(min(vals)), "max": _r(max(vals))})
        out["table"] = table
        out["tell_the_person"] = "; ".join(f"{r['trait']}: mean {r['mean']} (from {r['min']} to {r['max']}, {r['plots']} plots)"
                                           for r in table) or "no values for these traits here"
    elif kind == "correlation":
        res = c.post_json(f"{API}/correlation", body)
        names, m, n = res["pearson"]["trait_names"], res["pearson"]["matrix"], res["pearson"].get("n")
        pairs = sorted(({"traits": [names[i], names[j]], "r": _r(m[i][j]), "plots": (n[i][j] if n else None)}
                        for i in range(len(names)) for j in range(i + 1, len(names)) if m[i][j] is not None),
                       key=lambda p: -abs(p["r"]))
        out["pairs_strongest_first"] = pairs[:15]

        def word(r: float) -> str:
            a = abs(r)
            return ("strong" if a >= 0.6 else "moderate" if a >= 0.3 else "weak") + (" positive" if r > 0 else " negative")

        out["tell_the_person"] = "; ".join(f"{p['traits'][0]} and {p['traits'][1]}: r = {p['r']} ({word(p['r'])})"
                                           for p in pairs[:4]) or "not enough plots with both traits"
        out["how_to_read"] = "r runs from -1 to 1; near 0 means no straight-line relation. Pearson, plot level."
    elif kind == "anova":
        res = c.post_json(f"{API}/anova", body)
        table = []
        for p in res.get("panels") or []:
            g = next((t for t in p.get("terms") or [] if "accession" in str(t.get("term"))), None)
            table.append({"trait": p["trait_name"], "environment": p["env_label"], "genotypes": p.get("n_groups"),
                          "plots": p.get("n_obs"), "F": _r(g.get("F"), 2) if g else None,
                          "p": float(f"{g['p']:.2g}") if g and g.get("p") is not None else None,
                          "share_of_variation_between_genotypes": _r(g.get("eta_sq"), 2) if g else None,
                          "note": p.get("message") or (None if p.get("replication_status") == "replicated"
                                                       else p.get("replication_status"))})
        out["table"] = table[:24]
        sig = [r for r in table if r["p"] is not None and r["p"] < 0.05]
        out["tell_the_person"] = (f"Genotypes differ significantly (p < 0.05) in {len(sig)} of {len(table)} "
                                  "trait-by-environment tests. " + "; ".join(
                                      f"{r['trait']} in {r['environment']}: F = {r['F']}, p = {r['p']}" for r in table[:4]))
    elif kind == "heritability":
        res = c.post_json(f"{API}/heritability", body)
        table = []
        for p in res.get("panels") or []:
            bl = sorted(p.get("blups") or [], key=lambda b: -(b.get("blup") or 0))
            table.append({"trait": p["trait_name"], "environment": p["env_label"], "heritability": _r(p.get("h2"), 2),
                          "genotypes": p.get("n_groups"), "mean_replicates": _r(p.get("mean_reps"), 1),
                          "highest": [(b["accession_name"], _r(b["blup"], 1)) for b in bl[:3]],
                          "lowest": [(b["accession_name"], _r(b["blup"], 1)) for b in bl[-3:]],
                          "note": None if p.get("convergence_status") == "ok" else p.get("convergence_status")})
        out["table"] = table[:24]
        out["tell_the_person"] = "; ".join(f"{r['trait']} in {r['environment']}: heritability {r['heritability']}"
                                           for r in table[:6]) or "heritability could not be estimated here"
        out["how_to_read"] = ("broad-sense heritability on a genotype-mean basis, 0 to 1: the share of the differences "
                              "between genotype means that is genetic. `highest` / `lowest` are genotype values (BLUPs).")
    elif kind == "pca":
        res = c.post_json(f"{API}/pca", body)
        ev = [_r(v, 2) for v in res.get("explained_variance_ratio") or []]
        out["share_of_variation_per_component"] = ev
        load = res.get("loadings")
        if load:
            out["loadings"] = load if not isinstance(load, list) else load[:12]
        scores = res.get("scores") or []
        ends = sorted(scores, key=lambda s: s["components"][0])
        out["genotypes_at_the_ends_of_component_1"] = {"low": [s.get("label") for s in ends[:3]],
                                                      "high": [s.get("label") for s in ends[-3:]]}
        out["tell_the_person"] = (f"The first two components carry {round(100 * sum(ev[:2]))} % of the variation "
                                  f"({round(100 * ev[0])} % and {round(100 * ev[1])} %) across {len(scores)} entries."
                                  if len(ev) >= 2 else "too few traits or plots for a PCA")
    elif kind == "gge":
        res = c.post_json(f"{API}/gge", body)
        ev = [_r(v, 2) for v in res.get("explained_variance_ratio") or []]
        out.update({"environments": [e["name"] for e in res.get("env_scores") or []], "genotypes": res.get("n_accessions"),
                    "share_of_variation_pc1_pc2": ev[:2],
                    "genotypes_on_the_polygon (the extremes: best or worst somewhere)": res.get("polygon")})
        # "Which did best where" in plain terms, from the plot values themselves.
        m = c.post_json(f"{API}/matrix", body)
        cells: dict[str, dict[str, list[float]]] = {}
        for r in m.get("rows") or []:
            v = r["values"].get(traits[0])
            if r.get("accession_name") and isinstance(v, (int, float)):
                env = f"{r.get('season_name')} · {r.get('site_name')}"
                cells.setdefault(env, {}).setdefault(str(r["accession_name"]), []).append(float(v))
        best_in, overall = {}, {}
        for env, acc in cells.items():
            means = {a: sum(v) / len(v) for a, v in acc.items()}
            top = sorted(means.items(), key=lambda kv: -kv[1])[:3]
            best_in[env] = [(a, _r(v, 1)) for a, v in top]
            for a, v in means.items():
                overall.setdefault(a, []).append(v)
        everywhere = sorted(((a, sum(v) / len(v)) for a, v in overall.items() if len(v) == len(cells)), key=lambda kv: -kv[1])[:5]
        out["highest_in_each_environment"] = best_in
        out["highest_on_average_across_all_environments"] = [(a, _r(v, 1)) for a, v in everywhere]
        out["tell_the_person"] = (res.get("message") or
                                  (f"Highest {traits[0]} on average across all {len(cells)} environments: "
                                   + ", ".join(f"{a} ({_r(v, 1)})" for a, v in everywhere[:3]) + ". "
                                   + "Best in each: " + "; ".join(f"{e}: {t[0][0]}" for e, t in best_in.items()) + ". "
                                   if everywhere else "") +
                                  f"GGE biplot of {traits[0]} over {res.get('n_envs')} environments and {res.get('n_accessions')} "
                                  f"genotypes; the first two axes carry {round(100 * sum(ev[:2]))} % of the variation. "
                                  f"Genotypes at the corners: {', '.join((res.get('polygon') or [])[:6])}.")
    else:                                               # field
        res = c.post_json(f"{API}/spatial", body)
        sites = []
        for s in res.get("sites") or []:
            laid_out = s.get("max_row", 0) > s.get("min_row", 0) or s.get("max_col", 0) > s.get("min_col", 0)
            sites.append({"site": s["site_name"], "plots": s.get("n_cells"), "lowest": _r(s.get("value_min"), 1),
                          "highest": _r(s.get("value_max"), 1),
                          "rows": [s.get("min_row"), s.get("max_row")], "columns": [s.get("min_col"), s.get("max_col")],
                          "note": None if laid_out else "these plots have no row and column numbers, so there is no "
                                                        "field pattern to show (the field design did not give them)"})
        out["sites"] = sites
        out["tell_the_person"] = "; ".join(f"{s['site']}: {traits[0]} from {s['lowest']} to {s['highest']} over {s['plots']} plots"
                                           + (f" ({s['note']})" if s["note"] else "") for s in sites) or "no plots with this trait"
    if res.get("status") not in (None, "ok"):
        out["status"] = res.get("status")
        out["tell_the_person"] = res.get("message") or f"the analysis could not run: {res.get('status')}"
    out["see_it_in_the_app"] = "Analyze tab" + (" > Multivariate" if kind not in ("summary", "field") else "")
    return {"result": out}


_tool(traits_available, "What trait data the app holds (the Analyze tab's contents): per experiment, season and site, "
      "which traits and how many plots. Start here for any question about measured traits.",
      {"experiment": {**_str, "description": "words naming one experiment; omit to list them all"}}, [],
      track=False, group="analysis")
_tool(analyze, "Run one of the Analyze tab's analyses on trait data and get the numbers and a sentence that says what "
      "they mean. kind: " + "; ".join(f"{k} = {v}" for k, v in KINDS.items()) + ".",
      {"kind": {**_str, "description": "summary | correlation | anova | heritability | pca | gge | field"},
       "experiment": {**_str, "description": "words naming the experiment"},
       "traits": {**_str, "description": "trait names or words for them, comma separated (\"yield, height\"); omit for all"},
       "season": {**_str, "description": "a season if only one is wanted (default: all)"},
       "site": {**_str, "description": "a site if only one is wanted (default: all)"}},
      ["kind", "experiment"], track=False, group="analysis")
