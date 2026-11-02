# Eval baseline

`baseline.json` holds the metrics of the first passing run of `knowledge-eval` on the seeded
fixture (`umbel_plugin_knowledge::eval::fixture`, seed 20261101). `tests/eval_gate.rs` holds every
later run to it: no metric may fall more than 0.02 below its baseline value, on top of the fixed
floors in `src/eval/gate.rs` (zero leaks, every unanswerable query empty, recall@10 at least 0.85,
nDCG@10 at least 0.70, multi-hop recall no worse with expansion).

A change that moves ranking updates this file **in its own pull request**, with the report diff:

```sh
cd endpoints/umbel
UMBEL_EVAL_REPORT=/tmp/report.json cargo test --locked -p umbel-plugin-knowledge --test eval_gate
jq '{version: 1, fixture: {seed: 20261101, digest: "<the fixture digest>"}, k, metrics, unanswerable: {emptyRate: .unanswerable.emptyRate}}' /tmp/report.json > plugins/knowledge/eval/baseline.json
pnpm biome format --write endpoints/umbel/plugins/knowledge/eval/baseline.json   # from the repository root
```

Changing the generator changes the fixture digest (`PINNED_DIGEST` in `tests/eval_fixture.rs`) and
so the baseline, in the same pull request. The CI `knowledge` job uploads the report of every run as
an artifact.
