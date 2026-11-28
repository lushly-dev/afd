# Health history

Written by `.github/workflows/health-history.yml` (`scripts/health-history.mjs` on `main`),
once a day: `reports/<YYYY-MM-DD>.json` is the Health report (schema 1.3) of `main` as it stood
when CI's daily run on `main` finished, filed under the UTC day that run started, with the
measures of every producer and that run's coverage. Each commit names the commit measured, the
run and the commit the run tested. A second run for the same day replaces its file.

Retention: reports dated 366 days or more before the newest are removed from the tree;
the branch's history keeps them. Nothing else writes this branch, and it is never merged.

Load several in the Health dashboard to compare them.
