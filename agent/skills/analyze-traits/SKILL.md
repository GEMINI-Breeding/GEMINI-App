---
name: analyze-traits
description: Answer questions about measured traits with the Analyze tab's analyses — what data there is, summaries, correlation between traits, ANOVA across genotypes, heritability and best genotypes, PCA, GGE biplot across environments, and the pattern across the field. Use for "which traits do we have", "is yield related to height", "do genotypes differ", "heritability", "best lines", "compare sites".
---

# Analyzing traits

## Quick path

1. `traits_available` (with `experiment` if the person named one): which experiments, seasons, sites and traits there are.
2. `analyze` with `kind`, `experiment`, and `traits` in the person's own words. Send nothing else unless they named a season or a site.
3. Tell the person what `tell_the_person` says, then the two or three numbers from the table that answer their question. Say which data it was (experiment, season, site).

Which `kind` for which question:

| The person asks | kind | traits |
|---|---|---|
| what is the average / range / how many plots | `summary` | any |
| are two traits related, does X go with Y | `correlation` | two or more |
| do the genotypes (lines, varieties) differ | `anova` | any |
| how heritable, which lines are best or worst | `heritability` | any |
| overall pattern across many traits | `pca` | two or more |
| which line did best where, compare sites or years | `gge` | exactly one |
| pattern across the field, is one side lower | `field` | exactly one |

## Reading the results

- **Correlation**: r from -1 to 1. Under 0.3 in size is weak; say so rather than calling it a relation. A correlation across plots of different genotypes mixes genetic and field effects.
- **ANOVA**: p below 0.05 means the genotypes differ by more than plot-to-plot noise. `share_of_variation_between_genotypes` says how much. A note about replication means the test is weak or was not possible: pass the note on.
- **Heritability**: near 1, differences between lines are mostly genetic and selecting on the trait works; near 0, mostly noise. It is specific to that field and season. `highest` and `lowest` are the lines' estimated values, not raw plot values.
- **GGE**: needs two or more environments (season by site). With one, say that it needs more and offer `heritability` instead.
- **Field**: if the result says the plots have no row and column numbers, there is no pattern to show; say so.

Do not compute statistics yourself from numbers in a reply, and do not describe a chart you have not been shown: the numbers the tool returns are the answer. For the charts, point the person to the Analyze tab.

## When there is no trait data

`traits_available` says so. Traits come from the pipeline (trait extraction, `canopy_cover`, per-plot inference) or from a table of hand measurements (skill `reference-data`).
