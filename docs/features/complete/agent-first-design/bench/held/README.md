# The bench's held material

What a building session of the Agent-First Design bench must never read: the checks its build is
scored on, the faults planted in the seeded build, the persona cards and walk scripts, and the
two jobs held back for phase C. Written on 2026-11-15, after the domain was decided and before
any session ran, from the merged tasks, results and application at `7c64d460`, and reviewed once
by an independent reader before the first freeze.

## Frozen in two stages

| Stage | Files | Frozen | Because |
| --- | --- | --- | --- |
| 1 | [`checks/`](checks/README.md), [`held-back-jobs/`](held-back-jobs/README.md), this file | 2026-11-15, before any build | Step 0.1's builds are scored by the checks, and the rule for step 0.2 needs them fixed before any build exists |
| 2 | [`faults.md`](faults.md), [`personas/`](personas/README.md), [`walks.md`](walks.md) | Before the first walk, pilots included | A fault names elements of the reference build, which does not exist yet; its final form and its proof are settled against that build. Nothing a building session does depends on them |

- **Each stage has a manifest:** `MANIFEST-1.sha256` and later `MANIFEST-2.sha256`, holding the
  SHA-256 of each of its files. The hash of each manifest is recorded in the feature's public
  `STATUS.md` when it is made, so the record committed later can be shown to be what the runs
  used.
- **After a stage is frozen** its files do not change. A mistake found later is recorded in
  a file of its own beside them, with what it changed in the results, and the frozen file is
  left as it was.

## Where it lives

- **On the machine that runs the sessions,** in a folder of its own on the external drive,
  outside every checkout and every session's worktree and arm directory. The runner reads it;
  no session is given its path.
- **That is not a wall.** A session can read any path on the machine, so each session's tool
  calls are searched for this folder's path and for its files' names, and a run that read one
  is thrown out and run again (`bench.md`, "Runs").
- **After the last run of phase 0** it is committed to the repository as the record, as
  Component Briefs did with its tasks and checks. Until then nothing here is pushed anywhere.

## Contents

| File | What it holds |
| --- | --- |
| [`checks/`](checks/README.md) | The checks on a build, one file a screen: 308 checks over 50 states, and how each is matched |
| [`held-back-jobs/`](held-back-jobs/README.md) | The two jobs held back for the panel loop, as scenario files |
| [`faults.md`](faults.md) | The twelve faults: where each goes, what the reference build must have for them, the change, and the proof that it is present |
| [`personas/`](personas/README.md) | The five persona cards, the tools that enforce each modality, and the preamble every persona is given |
| [`walks.md`](walks.md) | The job walked on each screen, its script and starting state, and how a path is read from the journal |

## Not written yet

- **The faults' diffs,** made in a copy of the reference build after the owner has looked at
  the clean one, each recorded in `faults.md` with its proof's result on both builds.
- **The readers' briefs** for step 0.3, which match a walk's findings to the faults, and for
  step 0.1's bare arm, which match a build's stories to the states. They are part of the runner.
- **The code that runs the checks.** It is part of the runner, and follows `checks/README.md`.

## Open for the owner

- **How a path is read** for step 0.4 (`walks.md`, "Reading a path"): reads are free, a batch
  is one command, an undo and its redo are repeats. These are proposed in `bench.md` beside the
  rules for "go", and confirmed with them.
