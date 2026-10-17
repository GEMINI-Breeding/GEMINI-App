"""The Genotyping tab for an agent: marker data sets ("studies"), bringing a
genotype file in, and genome-wide association (GWAS) of a measured trait.

Things are named in words: a study by its name, an experiment, a trait
("flowering" finds "FT_DAP"), a season, a site. Ids are looked up here.

A genotype file is a table of markers by samples (HapMap .hmp, VCF, CSV or
xlsx). Its samples are the lines of an experiment: the import says how many
of the file's sample names are lines the app already knows, because a GWAS
only uses lines that have both markers and a measured trait.
"""
from __future__ import annotations

import csv
import json
import os
import random
import time
import urllib.request
from pathlib import Path
from typing import Any, Optional

from .client import AGENT_DIR
from .tools import _int, _str, _tool, client

FIXED = 11          # HapMap: columns before the first sample


def _studies() -> list[dict]:
    return client().get_json("/api/genotyping_studies/all?limit=500") or []


def _study(words: str) -> dict:
    rows = _studies()
    low = str(words or "").strip().lower()
    hit = [s for s in rows if str(s.get("study_name")).lower() == low] or \
          [s for s in rows if low and low in str(s.get("study_name")).lower()]
    if len(hit) != 1:
        raise ValueError(f"`study` must name one genotype study; {words!r} matches {len(hit)}. Studies: " +
                         (", ".join(str(s.get("study_name")) for s in rows[:20]) or "none yet (genotype_import makes one)"))
    return hit[0]


def _experiment(words: str) -> dict:
    rows = client().entities("experiments")
    low = str(words or "").strip().lower()
    hit = [e for e in rows if str(e.get("experiment_name")).lower() == low] or \
          [e for e in rows if low and low in str(e.get("experiment_name")).lower()]
    if len(hit) != 1:
        raise ValueError(f"`experiment` must name one experiment; {words!r} matches {len(hit)}: " +
                         ", ".join(str(e.get("experiment_name")) for e in (hit or rows)[:15]))
    return hit[0]


def _one(rows: list[dict], key: str, words: Optional[str], what: str, required: bool = False) -> Optional[dict]:
    if not words:
        if required:
            raise ValueError(f"say which {what}: " + ", ".join(str(r.get(key)) for r in rows[:20]))
        return None
    low = str(words).strip().lower().replace("_", " ")
    hit = [r for r in rows if str(r.get(key)).lower() == str(words).strip().lower()] or \
          [r for r in rows if low in str(r.get(key)).lower().replace("_", " ")] or \
          [r for r in rows if all(w in str(r.get(key)).lower().replace("_", " ") for w in low.split())]
    if len(hit) != 1:
        raise ValueError(f"{what} {words!r} matches {len(hit)} here. There are: " +
                         ", ".join(str(r.get(key)) for r in (hit or rows)[:20]))
    return hit[0]


def _lines(experiment: str) -> set[str]:
    """Names of the lines (accessions) that have trait data in an experiment."""
    cat = [c for c in client().get_json("/api/multivariate_analysis/catalog") or [] if c["experiment_name"] == experiment]
    if not cat:
        return set()
    m = client().post_json("/api/multivariate_analysis/matrix",
                           {"trait_names": cat[0]["trait_names"][:1], "experiment_names": [experiment]})
    return {str(r["accession_name"]) for r in m.get("rows") or [] if r.get("accession_name")}


def _samples_of(path: Path) -> list[str]:
    """Sample names in a genotype file's header (HapMap, VCF, or a table with markers in rows)."""
    opener = open
    with opener(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("##"):
                continue
            cells = line.rstrip("\r\n").split("\t") if "\t" in line else next(csv.reader([line]))
            if line.startswith("#CHROM"):
                return cells[9:]                                     # VCF
            if cells and cells[0].lower().startswith("rs"):
                return cells[FIXED:]                                 # HapMap
            return cells[1:]                                         # markers in rows, samples in columns
    return []


def genotype_studies(args: dict) -> dict:
    """The genotype (marker) data sets in the app."""
    out = []
    for s in _studies():
        info = s.get("study_info") or {}
        out.append({"study": s.get("study_name"),
                    **{k: info[k] for k in ("n_samples", "n_variants", "source_file", "mock") if k in info}})
    return {"result": {"studies": out,
                       "next": ("these studies are already in the app. To find markers associated with a trait: gwas "
                                "with study (one of these names), experiment and trait. Import (genotype_import) is "
                                "only for a new file the person gives you." if out else
                                "no marker data yet: genotype_import brings a file in")}}


def _post_file(path: str, file: Path, fields: dict) -> dict:
    c = client()
    c.get_json("/api/genotyping_studies/all?limit=1")          # makes sure the session is open
    boundary = "----gemiagent" + os.urandom(8).hex()
    crlf = "\r\n"
    head = "".join(f'--{boundary}{crlf}Content-Disposition: form-data; name="{k}"{crlf}{crlf}{v}{crlf}'
                   for k, v in fields.items() if v is not None)
    head += (f'--{boundary}{crlf}Content-Disposition: form-data; name="file"; filename="{file.name}"{crlf}'
             f"Content-Type: application/octet-stream{crlf}{crlf}")
    body = head.encode() + file.read_bytes() + f"{crlf}--{boundary}--{crlf}".encode()
    req = urllib.request.Request(c.base + path, data=body, method="POST", headers={
        "Authorization": f"Bearer {c._token}", "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=3600) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"the app refused the file: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:400]}") from None


def genotype_import(args: dict) -> dict:
    """Bring a genotype file in as a study (made if it does not exist yet)."""
    if not args.get("path"):
        raise ValueError("genotype_import brings a NEW marker file in and needs its `path`. For a study that is already "
                         "in the app, do not import: call gwas with study, experiment and trait.")
    path = Path(str(args["path"]))
    if not path.is_file():
        raise ValueError(f"not a file on this computer: {path}. If the markers are already in the app as a study, "
                         "call gwas instead.")
    exp = _experiment(args["experiment"])["experiment_name"]
    samples = _samples_of(path)
    if len(samples) < 2:
        raise ValueError("could not read sample names from the file's header (expected HapMap .hmp, VCF, or a table "
                         "with one marker per row and one sample per column)")
    known = _lines(exp)
    norm = {k.lower().replace(" ", "").replace("_", "").replace("-", ""): k for k in known}
    mapping, new = {}, []
    for s in samples:
        k = norm.get(s.lower().replace(" ", "").replace("_", "").replace("-", ""))
        mapping[s] = k or s
        if not k:
            new.append(s)
    matched = len(samples) - len(new)
    summary = {"file": path.name, "samples_in_file": len(samples), "samples_that_are_lines_of_this_experiment": matched,
               "samples_not_known_as_lines": len(new), "examples_not_known": new[:5],
               "lines_with_trait_data_in_experiment": len(known)}
    if args.get("dry_run"):
        return {"result": {**summary, "next": "nothing imported: this was the count. Call genotype_import again "
                                              "without dry_run to import."}}
    if known and matched == 0 and not args.get("allow_unmatched"):
        raise ValueError("none of the file's sample names is a line of this experiment, so no trait could ever be "
                         f"tested against it. File samples look like {samples[:3]}; the experiment's lines look like "
                         f"{sorted(known)[:3]}. Check that this is the right experiment (allow_unmatched=true imports "
                         "it anyway).")
    name = str(args.get("study") or path.stem)
    existing = [s for s in _studies() if str(s.get("study_name")).lower() == name.lower()]
    study = existing[0] if existing else client().post_json(
        "/api/genotyping_studies", {"study_name": name, "experiment_name": exp,
                                    "study_info": {"source_file": path.name, "by": "agent",
                                                   **({"mock": True} if args.get("mock") else {})}})
    res = _post_file(f"/api/genotyping_studies/id/{study['id']}/ingest-pgen", path, {
        "sample_canonical_map_json": json.dumps(mapping), "skipped_headers_json": "[]",
        "created_accessions_json": json.dumps(new), "experiment_name": exp,
        "population_name": args.get("population")})
    out = {"study": study.get("study_name"), **summary, "markers_imported": res.get("variants_inserted"),
           "samples_imported": res.get("samples_inserted"), "problems": res.get("errors") or None}
    out["tell_the_person"] = (f"Imported {res.get('variants_inserted')} markers for {len(samples)} samples as study "
                              f"\"{study.get('study_name')}\". {matched} of the samples are lines with trait data in {exp}"
                              + (f"; {len(new)} are not (they were added as new lines)." if new else "."))
    out["next"] = "gwas with study, experiment and trait"
    return {"result": out}


def gwas(args: dict) -> dict:
    """Test one trait against a study's markers (one RUN_GWAS job)."""
    c = client()
    study = _study(args["study"])
    exp = _experiment(args["experiment"])
    eid = exp["id"]
    all_traits = c.get_json(f"/api/experiments/id/{eid}/traits") or []
    from .analysis_tools import match_trait

    named = match_trait(str(args.get("trait") or ""), [str(t["trait_name"]) for t in all_traits]) if args.get("trait") else []
    if len(named) != 1:
        raise ValueError(f"trait {args.get('trait')!r} matches {len(named)} here ({', '.join(named) or 'none'}). Traits "
                         "of this experiment: " + ", ".join(str(t["trait_name"]) for t in all_traits[:20]))
    trait = next(t for t in all_traits if t["trait_name"] == named[0])
    datasets = [d for d in c.get_json(f"/api/experiments/id/{eid}/datasets") or []]
    kinds = {str(t.get("id")): str(t.get("dataset_type_name") or t.get("name") or "") for t in c.entities("dataset_types")} \
        if hasattr(c, "entities") else {}
    traits_ds = [d for d in datasets if "trait" in (kinds.get(str(d.get("dataset_type_id")), "") + " " +
                                                    str(d.get("dataset_name"))).lower()]
    ds = _one(traits_ds or datasets, "dataset_name", args.get("dataset"), "trait dataset") if args.get("dataset") else None
    if ds is None:
        if len(traits_ds) != 1:
            raise ValueError("say which `dataset` holds the trait: " + ", ".join(str(d.get("dataset_name")) for d in (traits_ds or datasets)[:12]))
        ds = traits_ds[0]
    season = _one(c.get_json(f"/api/experiments/id/{eid}/seasons") or [], "season_name", args.get("season"), "season")
    site = _one(c.get_json(f"/api/experiments/id/{eid}/sites") or [], "site_name", args.get("site"), "site")
    model = str(args.get("model") or "lmm").lower()
    body = {"study_id": study["id"], "experiment_id": eid, "dataset_id": ds["id"], "trait_id": trait["id"],
            "season_id": season["id"] if season else None, "site_id": site["id"] if site else None,
            "model": model, "lmm_test": "wald", "n_pcs": int(args.get("n_pcs") if args.get("n_pcs") is not None else 3),
            "phenotype_agg": "mean"}
    # Inbred lines (RILs, MAGIC, selfing crops) are homozygous at nearly every marker, which the usual
    # Hardy-Weinberg filter reads as an error and removes: every marker goes. Off unless told the lines are outbred.
    inbred = args.get("inbred_lines", True) not in (False, "false", "no")
    if inbred:
        body["qc"] = {"hwe": 0}
    jobs = c.post_json("/api/gwas/submit", body)
    job = jobs[0] if isinstance(jobs, list) else jobs
    return {"result": {"job_id": job.get("id"), "status": job.get("status"), "study": study.get("study_name"),
                       "trait": trait.get("trait_name"), "experiment": exp.get("experiment_name"),
                       "season": season.get("season_name") if season else "all", "site": site.get("site_name") if site else "all",
                       "model": model,
                       "marker_filters": "minor allele frequency 0.05, missing 0.1" + (
                           "; no Hardy-Weinberg filter (inbred lines)" if inbred else "; Hardy-Weinberg p 1e-6"),
                       "next": [{"tool": "wait_jobs", "args": {"job_ids": [job.get("id")]}},
                                {"tool": "gwas_result", "args": {"job_id": job.get("id")}}]}}


def gwas_result(args: dict) -> dict:
    """What a finished GWAS found."""
    c = client()
    if args.get("job_id"):
        job = c.job(str(args["job_id"]))
    else:
        rows = c.jobs(None, "RUN_GWAS", 200)
        rows.sort(key=lambda j: j.get("created_at") or "", reverse=True)
        if not rows:
            raise ValueError("no GWAS has been run yet: call gwas first")
        job = c.job(str(rows[0]["id"]))
    if job.get("status") in ("PENDING", "RUNNING"):
        return {"result": {"job_id": job["id"], "status": job["status"], "progress": job.get("progress"),
                           "next": "not finished: wait_jobs with this job id, then gwas_result again"}}
    if job.get("status") != "COMPLETED":
        err = str(job.get("error_message") or "")
        why = ("every marker was removed by the quality filters. For inbred lines the Hardy-Weinberg filter does this: "
               "run gwas again (it leaves that filter off unless inbred_lines is false). Otherwise the markers have "
               "too many missing calls or too rare alleles." if "No variants remaining" in err else
               "no line has both markers and this trait in the season and site chosen." if "No samples" in err or "no samples" in err
               else err)
        return {"result": {"job_id": job["id"], "status": job["status"], "error": err,
                           "tell_the_person": f"The GWAS did not finish: {why}"}}
    r = job.get("result") or {}
    hits = sorted(r.get("top_hits") or [], key=lambda h: h.get("p", 1))[:10]
    out: dict[str, Any] = {
        "job_id": job["id"], "study": r.get("study_name"), "model": r.get("model"),
        "samples_with_markers_and_trait": r.get("n_samples_with_phenotype"),
        "markers_tested": r.get("n_variants_passed_qc"), "markers_in_study": r.get("n_variants_input"),
        "significant_after_bonferroni": r.get("n_bonferroni_sig"), "bonferroni_p_threshold": r.get("bonferroni_threshold"),
        "suggestive": r.get("n_suggestive"), "genomic_inflation_lambda": r.get("genomic_inflation_lambda"),
        "top_markers": [{"marker": h.get("rs"), "chromosome": h.get("chr"), "position": h.get("pos"),
                         "p": float(f"{h['p']:.2g}") if h.get("p") is not None else None,
                         "effect": round(float(h["beta"]), 3) if h.get("beta") is not None else None} for h in hits]}
    n_sig = int(r.get("n_bonferroni_sig") or 0)
    lam = r.get("genomic_inflation_lambda")
    best = out["top_markers"][0] if out["top_markers"] else None
    tell = (f"{out['markers_tested']} markers tested on {out['samples_with_markers_and_trait']} lines. "
            + (f"{n_sig} marker(s) pass the Bonferroni threshold; the strongest is {best['marker']} on chromosome "
               f"{best['chromosome']} at {best['position']} (p = {best['p']})." if n_sig and best else
               "No marker passes the Bonferroni threshold" + (f"; the strongest is {best['marker']} (p = {best['p']})." if best else ".")))
    if isinstance(lam, (int, float)) and (lam > 1.2 or lam < 0.8):
        tell += (f" Genomic inflation is {round(lam, 2)}: the p-values are " + ("too small overall (population structure "
                 "not fully accounted for), so treat hits with caution." if lam > 1.2 else "larger than expected overall."))
    small = out["samples_with_markers_and_trait"]
    if isinstance(small, int) and small < 100:
        tell += f" Only {small} lines: a GWAS this small finds only very large effects."
    params = job.get("parameters") or {}
    if not params.get("season_id") and not params.get("site_id"):
        tell += " Trait values were averaged over every season and site of the experiment, not taken from one environment."
        out["environment"] = "all seasons and sites, averaged per line"
    try:
        study = next((x for x in _studies() if str(x.get("id")) == str(params.get("study_id") or r.get("study_id"))), None)
        if study and (study.get("study_info") or {}).get("mock"):
            out["made_up_markers"] = True
            tell = ("THE MARKERS OF THIS STUDY ARE MADE UP (test data): what follows shows that the steps work, it is "
                    "not a finding. ") + tell
    except Exception:
        pass
    out["tell_the_person"] = tell
    out["see_it_in_the_app"] = "Genotyping tab > the study > GWAS (Manhattan and QQ plots)"
    return {"result": out}


def mock_genotypes(args: dict) -> dict:
    """A made-up marker file for the lines of an experiment, for trying the
    Genotyping tab before real markers exist. With `trait`, one marker is
    built to follow that trait, so a GWAS on it has something to find."""
    exp = _experiment(args["experiment"])["experiment_name"]
    lines = sorted(_lines(exp))
    if len(lines) < 10:
        raise ValueError(f"{exp} has trait data for only {len(lines)} lines; a marker file needs lines to be made for")
    n = max(50, min(int(args.get("markers") or 400), 5000))
    chroms = max(1, min(int(args.get("chromosomes") or 10), 40))
    rng = random.Random(int(args.get("seed") or 7))
    value: dict[str, float] = {}
    planted = None
    if args.get("trait"):
        cat = [c for c in client().get_json("/api/multivariate_analysis/catalog") or [] if c["experiment_name"] == exp]
        names = sorted({t for c in cat for t in c["trait_names"]})
        low = str(args["trait"]).lower().replace("_", " ")
        hit = [t for t in names if low in t.lower().replace("_", " ")]
        if len(hit) != 1:
            raise ValueError(f"trait {args['trait']!r} matches {len(hit)}; traits: {', '.join(names)}")
        m = client().post_json("/api/multivariate_analysis/matrix", {"trait_names": hit, "experiment_names": [exp]})
        acc: dict[str, list[float]] = {}
        for r in m.get("rows") or []:
            v = r["values"].get(hit[0])
            if r.get("accession_name") and isinstance(v, (int, float)):
                acc.setdefault(str(r["accession_name"]), []).append(float(v))
        value = {k: sum(v) / len(v) for k, v in acc.items()}
        planted = hit[0]
    out_dir = AGENT_DIR / "work" / "mock"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"mock_markers_{exp.replace(' ', '_')}_{time.strftime('%H%M%S')}.hmp.txt"
    med = sorted(value.values())[len(value) // 2] if value else 0.0
    causal = (rng.randint(1, chroms), rng.randrange(n // chroms)) if planted else None
    causal_name = None
    with open(path, "w", newline="") as f:
        f.write("\t".join(["rs#", "alleles", "chrom", "pos", "strand", "assembly#", "center", "protLSID", "assayLSID",
                           "panelLSID", "QCcode"] + lines) + "\n")
        for ch in range(1, chroms + 1):
            for i in range(n // chroms):
                a, b = rng.sample("ACGT", 2)
                name = f"S{ch}_{(i + 1) * 250000}"
                freq = rng.uniform(0.2, 0.8)
                calls = []
                for ln in lines:
                    if causal == (ch, i) and ln in value:
                        hi = value[ln] > med
                        if rng.random() < 0.12:                 # not a perfect marker
                            hi = not hi
                        calls.append(b + b if hi else a + a)
                    else:
                        calls.append(b + b if rng.random() < freq else a + a)
                if causal == (ch, i):
                    causal_name = name
                f.write("\t".join([name, f"{a}/{b}", str(ch), str((i + 1) * 250000), "+", "NA", "NA", "NA", "NA", "NA", "NA"]
                                  + calls) + "\n")
    return {"result": {"file": str(path), "experiment": exp, "lines": len(lines), "markers": (n // chroms) * chroms,
                       "made_up": True,
                       "marker_built_to_follow_the_trait": {"trait": planted, "marker": causal_name} if planted else None,
                       "tell_the_person": "This marker file is made up (random markers for the experiment's lines"
                                          + (f", with one marker, {causal_name}, built to follow {planted}" if planted else "")
                                          + "). It is for trying the Genotyping tab, not for results.",
                       "next": "genotype_import with path, experiment, study (a name that says it is a mock) and mock=true"}}


_bool = {"type": "boolean"}
_tool(genotype_studies, "The genotype (marker) data sets in the app: the Genotyping tab's studies.", {}, [],
      track=False, group="genotyping")
_tool(genotype_import, "Bring a genotype file (HapMap .hmp, VCF, CSV or xlsx: markers by samples) into the app as a "
      "study for an experiment. Says how many of the file's samples are lines the experiment has trait data for. "
      "dry_run=true only counts.",
      {"path": {**_str, "description": "the genotype file on this computer"},
       "experiment": {**_str, "description": "words naming the experiment whose lines these are"},
       "study": {**_str, "description": "name for the study (default: the file's name)"},
       "population": _str, "dry_run": _bool, "mock": {**_bool, "description": "true for made-up data"},
       "allow_unmatched": _bool}, ["experiment"], track=False, group="genotyping")
_tool(gwas, "Genome-wide association: test one measured trait against the markers of a study. Starts a job; its "
      "result is read with gwas_result.",
      {"study": {**_str, "description": "words naming the genotype study"},
       "experiment": {**_str, "description": "words naming the experiment the trait was measured in"},
       "trait": {**_str, "description": "the trait, in words (\"flowering\", \"yield\")"},
       "season": {**_str, "description": "one season, if not all"}, "site": {**_str, "description": "one site, if not all"},
       "model": {**_str, "description": "lmm (default) | bslmm"}, "n_pcs": _int, "dataset": _str,
       "inbred_lines": {"type": "boolean", "description": "default true (inbred lines: RILs, MAGIC, selfing crops). "
                                                         "false for outbred populations: adds the Hardy-Weinberg filter"}},
      ["study", "experiment", "trait"], track=False, group="genotyping")
_tool(gwas_result, "What a GWAS found: lines and markers used, markers that pass the threshold, the strongest "
      "markers, and whether the p-values look inflated. Without job_id: the newest GWAS.",
      {"job_id": _str}, [], track=False, group="genotyping")
_tool(mock_genotypes, "Make a made-up marker file for the lines of an experiment, to try the Genotyping tab before "
      "real markers exist. With `trait`, one marker is built to follow that trait.",
      {"experiment": {**_str, "description": "words naming the experiment"},
       "trait": {**_str, "description": "optional: a trait for one marker to follow"},
       "markers": _int, "chromosomes": _int, "seed": _int}, ["experiment"], track=False, group="genotyping")
