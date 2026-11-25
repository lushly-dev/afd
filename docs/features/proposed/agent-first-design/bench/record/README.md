# Phase 0 record

Committed after the owner's step 0.6 decision on 2026-11-24 (**go with changes**; see
[`STATUS.md`](../../STATUS.md) and [`bench.md`](../../bench.md)).

## Decision (step 0.6, 2026-11-24)

The owner confirmed **go with changes**:

- Accept the blind pairwise report comparison as step 0.4's measure, alongside the $1.79 full-set
  comparison batch and the fault-reader direct-consequence rule.
- Treat phase 0's panel proof as complete (step 0.3 met at 12 of 12 faults; on step 0.4's blind
  report comparison, the 15-walk confirmation rerun was **met** at 4 of 4 fault-meeting and 1 of
  1 no-fault, while the 60 original walks scored **not met** at 12 of 13 fault-meeting and 6 of 7
  no-fault because the single clean walk on `p4 t2` stopped earlier than both seeded walks).
- Keep steps 0.2 and 0.5 deferred, commit the phase 0 record, and proceed to phase A.

## Contents

### Held material ([`../held/`](../held/README.md))

Kept outside the repository until phase 0 closed so no build or walk session could read it.

- **Stage 1** (`MANIFEST-1.sha256`, SHA-256
  `6e2a2d7d7daeb8326ef32f7dbae8f405ec40f59bf6cd2604732b822c396cdb31`): `README.md`, `checks/`
  (308 checks across 50 states) and `held-back-jobs/` (two held-back jobs for phase C). Every
  file matches `MANIFEST-1.sha256` byte for byte (`shasum -a 256 -c MANIFEST-1.sha256`).
- **Stage 2** (`MANIFEST-2.sha256`, SHA-256
  `e293ce7f690b09ecb8af1cd76a957ef25b16ebccc4744cc035a4f9996c3853c4`): `faults.md`, `walks.md`,
  `personas/` (five persona cards and modality rules) and `fault-proofs.mjs`, plus
  `stage-2-notes.md` (notes added after the freeze). Eight of the nine frozen files match
  `MANIFEST-2.sha256` byte for byte; `fault-proofs.mjs` (original SHA-256
  `5a9e3092491eacd94906a2942052cda7031efecfc660fe7d1299ea6d1008d703`) has one line changed for
  the public repository — line 22's machine-local config path replaced with
  `process.env.BENCH_CONFIG ?? 'bench.config.json'` (noted in `stage-2-notes.md`).

### Reports and ledger (this folder)

JSON reports are formatted as the repository's lint requires. Ledger timestamps are UTC (runs
late on 2026-11-24 Pacific time carry 2026-11-25 UTC timestamps).

| File | What it records |
| --- | --- |
| [`report-0.1.md`](report-0.1.md), [`report-0.1.json`](report-0.1.json) | Step 0.1's first 15 builds (arms 0, 1 and bare across T1–T3) and 5 bare readers |
| [`report-0.3.md`](report-0.3.md), [`report-0.3.json`](report-0.3.json) | Step 0.3's 40 seeded walks and 40 fault readers (12 of 12 faults found; met) |
| [`check-astra.md`](check-astra.md) | Independent check of step 0.3's 20 sampled matches (20/20 right) and 30 other findings (23/30 real) on GPT-6.2 Astra (machine name redacted; the delegated thread's full table is not committed) |
| [`report-0.4.md`](report-0.4.md), [`report-0.4.json`](report-0.4.json) | Step 0.4 on the 60 original walks: journal-path rule (3 of 13; not met) and blind pairwise report comparison (12 of 13 fault-meeting, 6 of 7 no-fault; not met due to single-clean-walk variance on `p4 t2`) |
| [`report-0.3-0.4-tune.md`](report-0.3-0.4-tune.md), [`report-0.3-0.4-tune.json`](report-0.3-0.4-tune.json) | Fault-reader report for the 15-walk confirmation rerun (5 pairs only; checks aimed faults found rather than the full 12-fault rule) |
| [`report-0.4-0.4-tune.md`](report-0.4-0.4-tune.md), [`report-0.4-0.4-tune.json`](report-0.4-0.4-tune.json) | Step 0.4 report for the 15-walk confirmation rerun (4 of 4 fault-meeting, 1 of 1 no-fault on blind report comparison; met) |
| [`ledger.jsonl`](ledger.jsonl) | Per-session cost ledger at list prices across the pilots, step 0.1, steps 0.3/0.4 and the walk-tuning rerun ($54.35 in the final allowance week; UTC timestamps) |

## Kept outside the repository

The throwaway runner scripts, the reference build and its seeded copy, and the raw session
transcripts, run folders and screenshots remain outside the repository on the second machine's
external drive, as the proposal and Component Briefs' prototype record specify.
