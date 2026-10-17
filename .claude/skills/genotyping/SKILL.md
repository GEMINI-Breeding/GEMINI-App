---
name: genotyping
description: Work with marker (genotype) data in the Genotyping tab — list the studies, bring a HapMap/VCF/CSV marker file in for an experiment, run a genome-wide association (GWAS) of a measured trait against the markers, and read what it found. Use for "import the markers", "genotype file", "run a GWAS", "which markers are associated with", "QTL".
---

# Genotyping and GWAS

## Quick path

For "which markers are associated with a trait", "run a GWAS", "QTL for":

1. `gwas` with `study`, `experiment` and `trait`, in the person's words. Add `season` and `site` only if they named them. Send nothing else. (Not sure of the study's name: `genotype_studies` lists them.)
2. Its result has a `next` list: make those calls in order (`wait_jobs`, then `gwas_result`).
3. Tell the person what `tell_the_person` says, then the two or three strongest markers with chromosome, position and p-value. Say which study, trait, season and site it was.

"What did the last GWAS find": `gwas_result`, nothing else.

## Bringing a new marker file in

Only when the person gives you a marker file that is not in the app yet (a study that `genotype_studies` lists is already in).

1. `genotype_import` with `path`, `experiment` and `"dry_run": true`. Tell the person how many of the file's samples are lines of that experiment, and stop.
2. On their yes: `genotype_import` again without `dry_run` (add `study` to name it).

## What matters

- **A GWAS only uses lines that have both markers and the trait.** `genotype_import` reports how many of the file's samples are lines the experiment has trait data for. If that is none or few, stop and tell the person: the names in the file do not match the experiment's lines, or it is the wrong experiment.
- **One environment at a time is the clean test.** Without `season` and `site`, a line's trait values are averaged over every season and site, which mixes environments. If the experiment has several, ask which, or say that you averaged.
- **Inbred lines.** The tool leaves the Hardy-Weinberg filter off, which is right for inbred lines (RILs, MAGIC, selfing crops such as cowpea, sorghum, wheat). For an outbred population pass `"inbred_lines": false`.
- **Reading the result.** A marker "passes" when its p-value is below the Bonferroni threshold the result gives. No marker passing is a result: say so; do not present the strongest marker as a finding. `genomic_inflation_lambda` far above 1 means the p-values are too small overall. Under about 100 lines only very large effects can be found.
- **Made-up markers.** `mock_genotypes` makes a marker file for an experiment's lines for trying the tab. A study from it must be named as a mock, imported with `"mock": true`, and anything found in it is not a result. Never use it unless the person asks for made-up or test data.

The Manhattan and QQ plots are in the app: Genotyping tab, the study, GWAS. Do not describe them unseen.

## When it fails

- `the GWAS did not finish: every marker was removed by the quality filters`: see "Inbred lines"; otherwise the file has too many missing calls.
- `trait ... matches 0`: the trait was not measured in that experiment; `traits_available` shows what was.
- The job stays PENDING: the GWAS worker is not running (`processes`).
