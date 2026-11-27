# Owner review brief: Umbel decisions D158 to D188

| Field | Value |
| --- | --- |
| Serves | [D201](decisions.md) and [#1932](https://github.com/lushly-dev/afd/issues/1932) — the owner's review checkpoint before phase 5's steps 11 (the erasure sweep) and 12 (the exit) |
| Scope | The 28 entries between D158 and D188 marked as decided under the owner's direction and unread by him: D158 to D171, D173 to D180, and D183 to D188. D157 is included as background context only. D172, D181, and D182 are already the owner's own decisions |
| Date | 2026-11-23 |
| Outcome | **Completed 2026-11-23 ([D203](decisions.md), [#2270](https://github.com/lushly-dev/afd/pull/2270)):** 27 of the 28 unread entries confirmed as written; **D186 amended by D203** (`better-auth` ships provisional alongside `entra` until verified against Better Auth 1.8+, and `preset = "entra"` no longer silently widens host-wide `[auth] max_token_lifetime_s`); **D165** per-principal write quota follow-up filed under [#1546](https://github.com/lushly-dev/afd/issues/1546) as [#2342](https://github.com/lushly-dev/afd/issues/2342) (the `records.size` postings warning already shipped in step B6, [#2320](https://github.com/lushly-dev/afd/pull/2320)). Phase 5 steps 11 and 12 are released |
| Sources | [Decision log](decisions.md), [Umbel status](STATUS.md), [Records host specification](plugins/ideas/host-records.spec.md), [Ideas plugin specification](plugins/ideas/spec.md), [Review host specification](plugins/ideas/host-review.spec.md), [Auth profiles specification](phases/5-auth-hosted/auth-profiles.spec.md) |

## What this checkpoint does

Between 2026-11-11 and 2026-11-12, 28 Umbel decisions were written under your standing instruction to keep the Ideas plan and auth-profiles design moving on their recommendations. Phase 5's remaining steps (11 and 12) build on those rules and wait for your review ([D201](decisions.md)).

When you answer this brief:
- **Every** reviewed entry has its "not yet read" mark in [decisions.md](decisions.md) replaced with the date you read it—whether confirmed as written or amended.
- Any entry you want changed also gets a new amending decision in [decisions.md](decisions.md), and if it changes built behaviour, a follow-up issue is filed under [#1546](https://github.com/lushly-dev/afd/issues/1546).
- Phase 5's checkpoint line in [STATUS.md](STATUS.md#phase-5-auth-and-hosted) is marked complete, releasing steps 11 and 12.

## Where to look closest

Twenty-four decisions have outcomes you can judge directly; four are purely technical and grouped at the end. Most of the 24 are already built; the auth-profiles group (D183 to D188) has no code written yet, so changes there cost zero rework.

The six highest-consequence trust-model calls are:

| Decisions | Status on `main` | Core trade-off |
| --- | --- | --- |
| [D180](#d180--paged-browser-review-and-the-no-login-local-page) | Built, in daily use ([#2005](https://github.com/lushly-dev/afd/issues/2005)) | The local browser review page has no sign-in. Any local process, local user account, or private-network caller (when `public_origin` is set) can approve. Recorded as `local` and excluded from verified-only reads by default. |
| [D185](#d185--custom-sign-in-rules-recorded-as-declared-amends-d115-and-d181), [D187](#d187--recording-login-evidence-on-declared-decisions) | **Not built yet** | Custom hosted sign-in rules (such as Microsoft Entra ID) record a separate level, `declared`, excluded from verified-only reads until the deployer opts in, and barred in `gateway` mode. |
| [D165](#d165--matching-by-words-and-the-4000000-posting-ceiling) | Built (step B4) | Matching and ranked search stop for **every** reader once a record kind exceeds 4,000,000 word postings (unique word-per-record index entries). This closes a privacy leak, at the cost of letting any writer pad a kind to stop matching for everyone or observe the size and timing of others' writes. |
| [D161](#d161--standing-computed-at-read-single-person-per-space-and-own-source-guards), [D162](#d162--who-checks-word-for-word-and-what-a-person-can-mark-as-theirs) | Built (step B3) | One configured person per space decides standing; the compiled plugin (not the host core) performs the word-for-word check; readers who cannot open a cited file still learn one bit (that some unreadable own file backs the wording). |
| [D166](#d166--optional-meaning-matching-none-by-default-and-three-providers), [D168](#d168--allowing-embeddings-in-the-request-path) | Built (step B5, [#2231](https://github.com/lushly-dev/afd/pull/2231)) | Computing embeddings during a query is allowed under Principle 4; an opt-in HTTP provider sends record text off the machine to a server the deployer configures. |
| [D184](#d184--per-issuer-token-profiles-and-scope-qualifier-afd-and-umbel), [D186](#d186--login-scopes-discovery-metadata-checks-and-provider-presets) | **Not built yet** | Accepting plain `JWT` access tokens relies on claim guards plus provider setup Umbel cannot inspect; the `entra` preset ships provisional until 11 real-tenant checks pass. |

## Already decided by you (outside the unread set)

Three numbers inside D158 to D188 are already your own decisions and are not part of this checkpoint:

| ID | Summary | Why it is outside the checkpoint |
| --- | --- | --- |
| D172 | The doctor (`umbel workspace doctor`) runs a compiled plugin's own check on space pack overrides. | Decided by you on 2026-11-11 (closing Components A16). |
| D181 | A phishing-resistant multi-factor login counts as user verification, so passkeys work. | Decided by you on 2026-11-12 ("Sure, we can accept pass key", and accepting password plus touch-only security key as "fine"). Note: [decisions.md](decisions.md) marks the specification wording unread; D185 folds this exact rule into the default `standard` rule. |
| D182 | The deployer defines the sign-in layer; defaults stay strict; loosening is explicit; the doctor warns; confirmations record how the person was proven. | Decided by you in your own words on 2026-11-12. D183 to D188 specify the shapes under this principle. |

---

## Context (outside the checkpoint): D157 — Standing records

D157 (2026-11-11) is the foundation behind D158 to D180. Your wording review of D157 is outside this checkpoint, though it is summarized here because the entries below depend on it, three of its rules were refined by D161 and D162, and one detail was adjusted to match what the host holds.

- **What it adds:** A third kind of durable storage alongside the knowledge base (changes only through approved proposals) and memory (agent-writable, expires). A plugin can hold durable records that agents write directly, where every record carries a **standing** label:
  - **Unverified:** how every new record starts.
  - **Attested:** the wording matches whole sentences, word for word, from a source belonging to the space's person (such as a synced folder configured as theirs, or a source they explicitly marked) that did not arrive as a command input.
  - **Affirmed:** the space's configured person explicitly confirmed the wording through a person-gated decision.
- **How it protects the rest of Umbel:** Standing records never enter the knowledge base except through a normal proposal, never carry verified-knowledge tiers (`machine`, `human`, `owner`), and never affect knowledge-base search ranking. Changing wording with standing produces a new unverified version; the person's confirmed wording stays intact until they decide to displace it.
- **Refinements and adjustments made in D161 and D162:**
  1. D157 gave the word-for-word comparison to the host; **D162** gives source checks to the host core and sentence comparison to the compiled plugin.
  2. D157 spoke of a person's say-so for uploads; **D162** extends that mark to any synced file in a non-command-writable collection.
  3. D157 allowed verified-only filtering "by a deployment's setting or by a call"; **D161** lets the deployment define what "verified" admits and lets callers request verified-only per call, with no space-wide switch that would hide unverified records from review.
  4. D157 described an attested label as carrying the date the person wrote the source; because the host holds no writing date, **D161** carries the dates the host actually has (`storedAt` and the file's `generatedAt`).

---

## Part 1 — Standing records and the record lane (D159–D169, D171)

Source: [Records host specification](plugins/ideas/host-records.spec.md). Steps B1 to B6 are merged on `main` (step B6, [#2003](https://github.com/lushly-dev/afd/issues/2003), merged 2026-11-23 in [#2320](https://github.com/lushly-dev/afd/pull/2320), adding `LaneStatus.postings`, the `records.size` 4M-posting warning, exit tests, and macOS release scale timings).

### D159 — Declared record kinds (compiled plugins only, stale-on-change rebuilds)

- **Built status:** Merged (steps B1–B3).
- **What people and agents can and cannot do:** Compiled first-party plugins (code built into the host) can declare structured record kinds with up to four searchable text fields, sixteen filterable key fields, and one matching field, and must declare a journal mode on every command. Third-party WebAssembly components and mounted MCP servers cannot declare indexed or standing record kinds. If a plugin changes a kind's declaration, or a record is written while the kind is undeclared, that kind goes offline for lane reads until an operator runs `umbel store-records-reindex`. Changing a standing kind's text fields wipes all affirmations and evidence for that kind on rebuild (with the doctor, `umbel workspace doctor`, counting and warning first); turning `standing` off and back on without changing text fields preserves affirmations (step B3 amendment A25).
- **What risk is left:** An accidental change to a standing kind's text-field list in a plugin upgrade requires re-affirming every record of that kind after rebuild, though the doctor warns before the rebuild runs.
- **What it rules out later:** Untrusted components or mounted servers declaring standing/indexed record kinds without a future plugin-protocol/WebAssembly interface (`WIT` world) change (consistent with your D192–D193 decisions restricting component store grants).
- **Recommendation:** **Confirm as written.** Keeps standing guarantees tied to trusted host-compiled code and ensures index state never silently drifts from manifest definitions.

### D160 — Wording of a standing record never changes

- **Built status:** Merged (step B3).
- **What people and agents can and cannot do:** Once a standing record is created, neither an agent nor a plugin can edit its text fields in place; any attempt is refused (`RECORD_WORDING_FIXED`). Tags, metadata keys, and citations can still be updated. To revise wording, a new unverified record must be created. Even if a modified plugin temporarily drops the declaration, edits text directly, and re-declares the kind, the rebuild detects the changed wording hash and strips the old affirmation and evidence.
- **What risk is left:** Low. The host cannot force a plugin to point its own "current version" pointer at the affirmed record; a buggy compiled plugin could display a different record than the one affirmed.
- **What it rules out later:** In-place typo fixes on affirmed text without a new record and a fresh confirmation.
- **Recommendation:** **Confirm as written.** This is the simplest hard guarantee that a person's affirmation can never silently cover words they never saw.

### D161 — Standing computed at read, single `person` per space, and own-source guards

- **Built status:** Merged (step B3, including security-review amendments A36–A40).
- **What people and agents can and cannot do:**
  - Standing (`unverified`, `attested`, `affirmed`) is computed fresh on every read from host-written rows, never trusted from plugin fields. Unlabelled `record_get` and `record_list` are refused on standing kinds.
  - Each space configures one `person` whose decisions count. Changing `person` sets the former person's decisions and marks aside without deleting them; the new person affirms fresh (renaming a principal without an `equivalents` mapping has the same effect).
  - At a terminal, affirming requires the human-present mark (agent environment variables withhold proof).
  - Callers ask for verified content per call (`verified_only`), never past the space's `verified_admits` setting (default `affirmed` only; optionally `affirmed+attested`). There is no space-wide switch hiding unverified records, because then nothing could be listed for review.
  - Folders configured as `own` (and any folder in any space sharing or overlapping that directory) cannot receive knowledge proposals or command writes. Documents in an `own` folder attest only after the host has verified they match the file on disk (at sync, at mark, or via `umbel store-documents-hold` for pre-existing files). Editing or deleting a cited file lapses attestation once the collection is re-synced, until re-cited.
  - Readers who cannot open a cited file see only how it qualifies (`collection` or `marked`), with no file path, hash, or dates. Who affirmed a record is shown only to the operator and the space's person.
- **What risk is left:**
  - **One-bit visibility leak (accepted):** A reader who can read a record, but not the source file it cites, can tell whether some unreadable own file currently backs that wording (and observe that bit flip if the file changes or is unmarked).
  - **Terminal spoofing limit (D74/D86):** A local process that unsets agent environment variables and allocates a pseudo-terminal still passes as `terminal`. Deployments needing stronger assurance require `person = { cli = "verified" }` (hosted login).
  - **Directory checks at startup:** Overlap and symlink checks run when the host loads config; changing a symlink under a running host takes effect on restart.
  - **No writing date:** Attested labels carry `storedAt` and the file's `generatedAt`, not when the person actually authored the text.
- **What it rules out later:** Shared multi-person spaces where several people can each affirm records (explicitly deferred from D157; requires a future multi-person design). Also rules out putting an `own` source folder inside a directory that knowledge proposals write into.
- **Recommendation:** **Confirm as written.** Every restriction directly closes an attack reproduced during step B3's security review; the one-bit leak avoids having the same record report two different standings to two readers.

### D162 — Who checks "word for word" and what a person can mark as theirs

- **Built status:** Merged (step B3, including amendment A36).
- **What people and agents can and cannot do:** Refines D157 in two places:
  1. The host core verifies how a cited document arrived (it exists at the cited hash, its collection is marked `own` or the person marked it, it matches its file on disk, and no command writes to that folder). The **compiled plugin** runs the sentence-splitting and word-for-word comparison and stores what it compared (unit numbers, rule version, speaker) for replay.
  2. A person can mark (`doc_own_mark`) any synced file in a non-command-writable collection as their own (not just future uploads), provided it matches its file on disk. They cannot mark a page in a command-writable collection (such as one populated by applied knowledge proposals); they affirm its records instead.
- **What risk is left:**
  - **Disk access is the deployer's responsibility:** Matching a stored document to its file on disk proves where the words were found, not who typed them. Anyone with shell or filesystem write access to an `own` or marked folder can drop a file there, so the deployer must control who can write to those folders—especially if `verified_admits` includes attested records.
  - **Plugin comparison bugs:** Because the compiled plugin performs the text comparison, a bug in its sentence rule could mark a partial quote as attested until caught by replay, and no replay CLI command has been built yet (Ideas v1 does not use attested standing anyway per D174).
  - **Config-now limit:** The host checks whether a collection is command-writable under the *current* config; it keeps no history. A file written by a command earlier, then left on disk after write permission was removed from config, would pass as a disk file.
- **What it rules out later:** Putting a single host-owned sentence splitter into Umbel core (keeps Principle 1, empty host). Also rules out marking knowledge-proposal pages as "the person's own" in one bulk action.
- **Recommendation:** **Confirm as written.** Keeps domain text parsing out of the host core and prevents one bulk mark from turning agent-drafted proposals into "the person's own words".

### D163 — Dedicated SQLite term table for record lanes instead of FTS5

- **Built status:** Merged (step B2).
- **What people and agents can and cannot do:** Declared records are indexed in ordinary SQLite tables inside the space's database in the same transaction as the write, so a newly captured record is immediately searchable without touching the knowledge base's search index. In exchange, **exact phrase search and prefix search are not available** on declared record lanes; searches match whole normalized words and exact key values. Every lane row cascades cleanly on delete under `secure_delete` so a single delete supports future erasure.
- **What risk is left:** Minimal. Users expecting `"exact phrase"` or `pref*` queries in record search will only get stemmed word matching.
- **What it rules out later:** Adding phrase or prefix search to record lanes would require either storing term positions in the term table or adding a separate index.
- **Recommendation:** **Confirm as written.** Ordinary tables are what make per-reader privacy statistics (no hidden records influencing scores) and a single PostgreSQL design possible.

### D164 — Finding records (`record_find`, `record_read`) and bounded ranked search

- **Built status:** Merged (step B2).
- **What people and agents can and cannot do:** `record_find` filters a declared kind by exact keys and standing, optionally searches by plain text, orders by ID, recency, or relevance rank with opaque pagination cursors, and returns reader-filtered totals without showing raw scores (per D70). Under ID or recency order, text search checks every readable record exactly. Under **ranked** order, the host gathers up to 20,000 word postings starting from the query's rarest words and ranks only those candidates: in a large store, readable records that share only common words with the query can be left out, and `total` counts only the gathered candidates (`cut` turns `true` only when the rarest word alone exceeded the 20,000-posting gather cap).
- **What risk is left:** On large record kinds, ranked search can silently omit records that match only common words without setting `cut`, and its reported `total` is the candidate count (not every matching record). Callers needing exhaustive text matches must order by ID or recency.
- **What it rules out later:** Exhaustive relevance-ranked pagination across huge kinds without either raising the gather cap or adopting a separate search engine.
- **Recommendation:** **Confirm as written.** Keeps ranked search fast and bounded while preserving exact, exhaustive results under ID and recency order.

### D165 — Matching by words and the 4,000,000-posting ceiling

- **Built status:** Merged (step B4, amended after two independent reviews, A52 and A54).
- **What people and agents can and cannot do:** `record_match` takes up to 64 texts and returns exact normalized duplicates (up to 8) plus up to 20 nearest records scored 0 to 1 by word overlap. The host returns raw scores only; each plugin supplies its own similarity bands. All statistics count only records the caller can read. Once a record kind **as a whole** exceeds 4,000,000 word postings (unique word-per-record index entries, roughly 100,000 short records), every match and ranked find on that kind is refused (`RECORD_QUERY_TOO_BROAD`) for **every** reader; finds by ID or recency still work. (This replaced an earlier per-query work cap that step B4's review proved could leak whether hidden records contained chosen words.)
- **What risk is left:**
  - **Shared-kind denial of service and write-size side channel (accepted):** Because all records in a kind count toward the 4,000,000-posting cap, any principal with write permission to that kind can push it over the cap and disable matching/ranked-find for everyone, or pad it to just under the cap and observe the size and timing of other writers' writes (not which words they wrote). Declared kinds do not yet have per-principal write quotas (filed under [#1546](https://github.com/lushly-dev/afd/issues/1546) as [#2342](https://github.com/lushly-dev/afd/issues/2342)); the doctor's `records.size` posting-count warning shipped in step B6 ([#2320](https://github.com/lushly-dev/afd/pull/2320)).
  - **Residual timing signal (accepted, bounded):** Counting a query term still scans postings to filter by reader, leaving a coarse timing signal bounded by the 4M cap.
  - **Heavy worst-case calls:** Step B6 ([#2320](https://github.com/lushly-dev/afd/pull/2320)) measured 100,000-record macOS release timings (64-text match: 12.5 s words / 19.8 s fused; 1-text match: 409 ms words / 4.80 s fused).
- **What it rules out later:** Matching or ranked search on single record kinds past 4M postings without raising the cap or moving to a dedicated search architecture.
- **Recommendation:** **Confirm as written**, and keep the two follow-ups (per-principal write quotas on declared kinds and a posting-count warning in `records.size`) tracked for multi-writer deployments.

### D166 — Optional meaning matching, none by default, and three providers

- **Built status:** Merged (step B5, [#2231](https://github.com/lushly-dev/afd/pull/2231)).
- **What people and agents can and cannot do:** By default, record matching uses words only and ships no embedding model. Deployers who compile in an optional feature (`embed-static`, `embed-onnx`, or `embed-http`) can configure a local static lookup model, a local ONNX model, or an HTTP embedding endpoint (`https`, or `http` on literal loopback only). Model files live inside the workspace and are pinned by SHA-256; the host never downloads models. If embedding fails during a put, the capture still succeeds and matching falls back to words for that reader until `umbel store-records-reindex` fills missing vectors. Vectors are searched by exact scan with a stated bound of 100,000 records per kind per space. Answers open decision O4 for record lanes only (still open for knowledge search).
- **What risk is left:**
  - **Off-machine text transfer:** Enabling the `http` provider sends record text off the machine to the configured endpoint. Text is only sent after write/query checks pass, and the doctor warns on every run naming the destination host.
  - **Vector reuse on normalized-equal edits:** Vectors are keyed to the normalized match digest (Unicode NFKC normalization, case folding, and collapsed whitespace), so edits that leave normalized text identical—such as case or spacing changes—keep the prior vector (recorded as a step B5 follow-up).
  - **Scale ceiling:** Exact scan slows past 100,000 records per kind (step B6, [#2320](https://github.com/lushly-dev/afd/pull/2320), recorded macOS release timings at 10k and 100k).
- **What it rules out later:** Shipping a default built-in embedding model in stock Umbel binaries without revisiting binary size and model licensing.
- **Recommendation:** **Confirm as written.** Keeps stock Umbel small, offline, and deterministic, while giving deployers a clear opt-in path with loud warnings whenever text leaves the machine.

### D167 — Evidence gate for turning on a meaning lane

- **Built status:** Merged (step B5, [#2231](https://github.com/lushly-dev/afd/pull/2231)).
- **What people and agents can and cannot do:** Configuring a model does not automatically serve meaning scores in match results. An operator must first run `umbel store-records-eval` on a probe file containing **at least 50 labelled probes that have a known duplicate** (probes with no duplicate may be included, but are excluded from the count `n`). The host serves meaning scores only when its own recomputation of the report's counts shows zero permission leaks and that fused scoring found a duplicate within `k` for at least `max(3, ceil(2% of n))` more duplicate-bearing probes than words alone (for example, at least 3 more out of 50), with the report bound to the kind's declaration, normalization, model ID, weight, and `k`. The doctor warns when the kind grows past four times the size measured at eval.
- **What risk is left:**
  - **Data still sent before the gate passes:** The gate controls when meaning scores are **served**, not when embeddings are computed. While an HTTP provider is configured, puts and `store-records-eval` still send record text to that endpoint before the gate passes.
  - **Manual labelling cost and non-expiring reports:** Deployers must label at least 50 duplicate-bearing probes before meaning scores turn on, and a passing report never auto-expires (only warns at 4× record growth).
- **What it rules out later:** Turning on semantic matching by config toggle alone without local measurement.
- **Recommendation:** **Confirm as written.** Matches D65's pattern for knowledge search and prevents deployers from paying embedding complexity for noise.

### D168 — Allowing embeddings in the request path

- **Built status:** Merged (step B5, [#2231](https://github.com/lushly-dev/afd/pull/2231)).
- **What people and agents can and cannot do:** Interprets Principle 4 ("no model in the request path") to permit computing an embedding vector for incoming query text during a match call when a meaning lane is active, because an embedder produces numbers only—it writes no text and makes no judgment.
- **What risk is left:** Adds embedding latency inside match requests (and a network round trip if using the `http` provider), and slightly narrows Principle 4 from "no ML model of any kind in requests" to "no generative/judging model in requests".
- **What it rules out later:** Holding Principle 4 as an absolute bar against request-time vector encoders.
- **Recommendation:** **Confirm as written.** Without embedding the incoming text at query time, a meaning lane cannot score a new capture against stored records.

### D169 — Host-enforced access, scanning, and journaling for declared records

- **Built status:** Merged (steps B2–B3).
- **What people and agents can and cannot do:** The host (never the plugin) sets each new declared record's access set—private to the writer by default, or readable by the whole space when the write grant sets `default_access = "space"`—and later puts cannot widen it. All reads enforce the reader filter inside SQL and refuse derivation reads (internal index-building reads that bypass caller permissions). Text fields are scanned at write time for prompt-injection patterns and flagged on read (never blocked). The host's record services write no record text into journals, lane-writer events, or errors, and the host forces every plugin with declared kinds to specify a journal mode per command.
- **What risk is left:**
  - **Command journals can still hold text under `plain`:** The host enforces content-free logs only for its own record services and lane-writer events. A plugin command declared with `plain` journaling still writes its full input and result—including private record text—to the command journal; keeping text out of command logs depends on each plugin declaring `digest` (and its tests holding it to that).
  - **Prompt-injection scanning:** Flagging is a safety net, not a guarantee (D75).
- **What it rules out later:** Per-record custom sharing lists chosen dynamically by a plugin on a declared kind (sharing beyond writer-only or whole-space waits for a future host change).
- **Recommendation:** **Confirm as written.** Keeps "private by default" and content-free record-service logs enforced by the host, with explicit per-command journal modes visible in every plugin manifest.

### D171 — Un-gated step B6 exit and deferred host seams

- **Built status:** Merged (steps B1–B6; step B6, [#2003](https://github.com/lushly-dev/afd/issues/2003), merged 2026-11-23 in [#2320](https://github.com/lushly-dev/afd/pull/2320); external phase 0 corpus eval remains outside this repository).
- **What people and agents can and cannot do:** Splits the records host delivery into six steps (B1–B6) and explicitly leaves erasure, uploads, paged browser review (built separately in D180), manifest guidance, graph edges, PostgreSQL support, component plugins, knowledge meaning search, and an approximate vector index out of scope with named seams. Crucially, **step B6's exit records timings (at 10,000 and 100,000 records) and recomputed recall rates on phase 0's pairs without requiring a minimum pass/fail threshold**, because phase 0 switched matching from refusing to offering candidates and its labels awaited owner review.
- **What risk is left:** Step B6 can declare the records host phase finished even if scale timings or recall on the lane tokenizer come back slower or weaker than phase 0's estimates—any performance or quality follow-up then depends on reviewing the recorded numbers.
- **What it rules out later:** Blocking phase B's closeout on a hard latency or recall SLA unless you set one before [#2003](https://github.com/lushly-dev/afd/issues/2003) runs.
- **Recommendation:** **Confirm as written.** Measuring and publishing real numbers without an invented cutoff is cleaner than guessing thresholds before seeing real hardware timings, and B6's measurements remain visible in `STATUS.md`.

---

## Part 2 — Ideas plugin v1 and the browser review page (D173–D180)

Sources: [Ideas plugin specification](plugins/ideas/spec.md) and [Review host specification](plugins/ideas/host-review.spec.md). All eight decisions are **built, merged, and confirmed in daily use** on your own instance ([#2005](https://github.com/lushly-dev/afd/issues/2005), epic [#1548](https://github.com/lushly-dev/afd/issues/1548) archived).

### D173 — Ideas v1 scope: flat daily loop over stdio, words-only ask/find

- **Built status:** Merged and in daily use (steps C1–C5).
- **What people and agents can and cannot do:** Provides 14 commands (3 first-class) for a single flat set of ideas: capture, match, ask, find, open, bulk review, undo, review quality report, export, and import, covering 8 of the original 29 jobs. `ideas-ask` and `ideas-find` use word search only, even now that step B5's meaning lane exists for matching. Post-v1 phases (themes, links, digests, framings, erasure, uploads) were closed as not planned on 2026-11-22 ([#2012](https://github.com/lushly-dev/afd/issues/2012)–[#2015](https://github.com/lushly-dev/afd/issues/2015)).
- **What risk is left:** `ideas-ask` misses ideas phrased with completely different synonyms because ranked find has no meaning lane yet (tracked as a follow-up after step B6).
- **What it rules out later:** Nothing irreversible—the four record kinds (`wording`, `idea`, `review`, `proposal`) leave seams for links, erasure, or meaning-backed ask later.
- **Recommendation:** **Confirm as written.** Matches the v1 scope you already confirmed in daily use.

### D174 — No attested standing in Ideas v1

- **Built status:** Merged and in daily use.
- **What people and agents can and cannot do:** Every captured idea stays an unverified seed until it is affirmed through a review decision or archive import. Ideas v1 never cites `own` collections and never automatically attests quotes from files, even though the host's attested-standing code (D161–D162) stays built. (You chose this on 2026-11-12; you have not read the specification wording.)
- **What risk is left:** Ideas v1 never auto-attests a quote from synced files, so you review more items directly. What an affirmation proves still depends on how it was made (verified hosted login, terminal prompt, no-login local page under D180, or bulk page-level import under D179).
- **What it rules out later:** Nothing. Turning attested standing on for Ideas later is a plugin-only change; no host work is lost.
- **Recommendation:** **Confirm as written.** A sentence written in an old document is not proof you still hold that view today.

### D175 — Capture never refuses on a match; exact matches become sightings

- **Built status:** Merged and in daily use (steps C1, C5).
- **What people and agents can and cannot do:** Similarity alone never blocks a valid capture. When matching is available and the normalized text matches an existing held or declined wording verbatim, capture adds a sighting to that idea instead of creating a duplicate; otherwise it saves the new seed and returns the nearest candidates with raw scores and provisional bands (`likely-same`, `related`, `distant`) from the plugin pack so the agent can stage a `duplicate` proposal for review. If matching is unavailable, capture still saves the statement as a new seed with a `MATCH_UNAVAILABLE` warning and no candidates (so an existing statement can land as a new seed while matching is down). (Replaces the original plan's hard refusal on high match scores.)
- **What risk is left:** Band thresholds still come from phase 0's prototype (which used a different tokenizer) until step B6's rerun and your real review reports tune them, so borderline duplicates may land in the wrong band until tuned.
- **What it rules out later:** Stopping near-duplicate captures at write time without changing the plugin's capture command.
- **Recommendation:** **Confirm as written.** Keeps capture frictionless and puts duplicate folding behind your review instead of a brittle score cutoff.

### D176 — Bulk review by exception, with quality metrics from use

- **Built status:** Merged and in daily use (steps C3–C5, [#2005](https://github.com/lushly-dev/afd/issues/2005)).
- **What people and agents can and cannot do:** (You set the direction on 2026-11-12—bulk review in a browser with an agent's help, and quality labels from real use instead of offline Q5—and have not read the specification wording.) Agents stage up to 500 proposals per call (affirm, decline, reword, duplicate, undo) with reasons and confidence; staging changes nothing and seeds stay usable. You confirm a group—or `"*"`, the whole review up to 500—in one decision on the browser page, unchecking items you disagree with. Every decision is recorded so `ideas-review-report` measures pull-out rates, duplicate recall, and common rewords from real use. Three behavioral rules to note:
  1. Unchecking a proposal records disagreement and leaves the idea **as it was**—it does not decline an unverified seed, and unchecking a proposed decline or reword on an already-affirmed idea keeps it affirmed.
  2. Rewording happens in conversation with the agent; you cannot edit text directly on the browser review page.
  3. At a terminal (without the browser page), parts are refused past 6,000 characters (~25 decisions) because the CLI truncates longer previews (security fix C3-11).
- **What risk is left:** Confirming up to 500 proposals at once raises the chance of skimming past an unwanted proposal—mitigated by requiring every page to be viewed (D180) and making applied decisions undoable (D177). Also, a human at a terminal who is *not* the space's configured person can still trigger declines/folds before the first `record_decide` refuses `RECORD_DECISION_NOT_THE_PERSON` (logged as a follow-up in `plugins/ideas/spec.md` C3-4).
- **What it rules out later:** Direct inline editing or one-click "decline" buttons on the host review page without expanding the host page protocol.
- **Recommendation:** **Confirm as written.** Already proven across two real reviews on your instance; keeps the host page simple and safe from arbitrary user-text handling.

### D177 — Undo by decision or whole review, non-atomic apply

- **Built status:** Merged and in daily use (step C3, including review fixes C3-7, C3-10, C3-14).
- **What people and agents can and cannot do:** An agent can stage an `undo` proposal targeting any applied proposal or an entire applied review. Once you confirm it, each affected idea is restored from the recorded effect (withdrawing or re-making affirmations as needed); items that changed since are skipped (`unchanged`), and an undo can itself be undone. Imported archives have proposal `effect` fields cleared so a crafted archive cannot smuggle fake undo chains into affirmations (security fix C3-10).
- **What risk is left:** **Apply is not a single database transaction.** Proposals in a batch are applied and marked one by one, so a crash or host failure midway can leave a review partially applied. Completed proposals change the review digest, so the unapplied remainder needs fresh showing and confirmation, and there is a small window between changing an idea and saving the proposal's `effect` record; `undo` reverses only proposals whose effects were recorded.
- **What it rules out later:** All-or-nothing transactional rollback of a multi-proposal batch without building a plugin-side rollback journal or multi-record host transaction service.
- **Recommendation:** **Confirm as written.** Mid-batch crashes on local SQLite are rare, recorded effects remain undoable, and keeping the plugin free of a custom rollback journal keeps apply simple.

### D178 — First-class tools and pasted `mcp.instructions`

- **Built status:** Merged and in daily use (step C5).
- **What people and agents can and cannot do:** The plugin suggests `ideas-capture`, `ideas-ask`, and `ideas-guide` as first-class MCP tools; the **deployer** sets `mcp.first_class_tools` in `umbel.toml` to expose them alongside `memory-remember` so personal facts still go to memory. The plugin also ships a starter `mcp.instructions` paragraph beginning with AFD's hybrid intro and avoiding instructions to call `ideas-guide` on every turn. Because manifest-contributed instructions (P18, [#2011](https://github.com/lushly-dev/afd/issues/2011)) are not built yet, deployers paste this paragraph into `umbel.toml`.
- **What risk is left:** Low. Installing the plugin alone does not update `mcp.first_class_tools` or `mcp.instructions`; if a deployer omits them or removes AFD's opening sentences, agents lose discovery hints (`tests/instructions.rs` guards the repo's README copy).
- **What it rules out later:** Nothing—P18 ([#2011](https://github.com/lushly-dev/afd/issues/2011)) can replace manual pasting later.
- **Recommendation:** **Confirm as written.**

### D179 — Additive CLI export and import with re-affirmation

- **Built status:** Merged and in daily use (step C1, verified across machines in [#2005](https://github.com/lushly-dev/afd/issues/2005)).
- **What people and agents can and cannot do:** `ideas-export` (operator CLI) writes all four record kinds in pages (up to 1,000 items per page) with a manifest digest. `ideas-import` (person at a terminal) imports **one page of up to 1,000 items per confirmed call** additively—never overwriting existing records—and re-affirms wordings marked affirmed in that page as **new decisions by the importing person** (keeping the original dates alongside). Security fixes ensure import only affirms wordings it wrote itself (or matching `restored` wordings from an interrupted import, blocking an archive from flipping pre-existing unverified seeds to affirmed) and converts any imported `staged` proposal to `unstaged`.
- **What risk is left:** Each imported page's affirmations rest on one terminal confirmation for up to 1,000 items without re-reading every wording individually, so importing an untrusted archive affirms whatever newly added wordings that archive marks affirmed. Also, a refusal partway through (such as running without a human terminal) leaves records written before the refusal stored as unaffirmed until re-run as the space's person.
- **What it rules out later:** Preserving cryptographic third-party decision rows verbatim across workspaces (host rules require decisions to be made locally by the target space's person).
- **Recommendation:** **Confirm as written.** Gives you a tested exit path without creating a backdoor to forge host decision rows.

### D180 — Paged browser review and the no-login local page

- **Built status:** Merged and in daily use (steps H0–H3, [#1081](https://github.com/lushly-dev/afd/pull/1081)–[#1137](https://github.com/lushly-dev/afd/pull/1137), plus `person.local.public_origin` in [#1188](https://github.com/lushly-dev/afd/pull/1188)). The AFD approval-relay fallback for hosted clients without URL elicitation (MCP's prompt to open a browser link; P15 relay, [#2010](https://github.com/lushly-dev/afd/issues/2010)) was added on 2026-11-26 as `person.pending_list`, off by default (D219).
- **What people and agents can and cannot do:**
  - **Paged review and lifetime (hosted and local):** A preview can span up to 200 pages (up to 100 items per page). No page is ever truncated; any page over 6,000 characters refuses approval. Approve appears only after every page is viewed; if the total page count changes or any previously rendered page's hash changes, the review resets to page 1 (an ordinary sighting on an Ideas review leaves the review intact). Unchecked items are passed to the command as `excluded` without altering the bound input digest. Decision lifetime (`person.decision_ttl_s`, default 600 s, max 24 hours) slides forward on each page render up to 24 hours; `/d/` lists pending decisions.
  - **Local page (`[person.local]` in `auth.mode = "none"`):** `umbel person page-serve` serves the review page on a loopback address with **no sign-in** (plus an optional `public_origin` HTTPS address when sitting behind a TLS proxy on the same machine, such as a private tailnet). Over stdio, person-gated commands use a refuse-and-retry flow naming the page URL instead of URL elicitation, so every stdio harness works. Decisions record assurance level `local` (`local-page`), stored in provenance envelope v4.
  - **Verified-content filter:** `spaces.<id>.verified_levels` defaults to `["terminal", "verified"]`, so `verified_only` excludes `local` affirmations (and `local` document marks, added in H3's security review A41) unless a deployer explicitly opts into `local`. Memory confirmations refuse `local`.
- **What risk is left (significant — read carefully):**
  - **No person proof on the local page:** Origin, Host, `Sec-Fetch-Site`, and CSRF checks block other websites and DNS rebinding, **not local processes or other users on the machine**. Any agent with a shell can start `person-page-serve`, fetch the pages, and submit Approve; any other user account on the machine can read pending previews and approve. With `public_origin` configured, anyone able to reach that origin over the network can approve with no login. This deliberately relaxes step B3's stricter terminal guard for workspaces that turn `[person.local]` on.
  - **Hosted freshness relaxation:** On the hosted page, letting a login stay alive while reading a multi-page review extends freshness from `max_age_s` to `decision_ttl_s` (up to 24 hours) for that one decision (H2 amendment A17).
  - **Plugin honesty on `excluded`:** The host passes `excluded` IDs to the compiled plugin handler, which must honor them; the host cannot independently verify which records a compiled handler skips.
- **What it rules out later:** Treating `local` affirmations as equivalent to authenticated `verified` ones without an explicit opt-in (`verified_levels`). Adding a login to the local page later remains open (`[person.local]` can gain a `login` key once a local sign-in provider is desired).
- **Recommendation:** **Confirm as written**, keeping `verified_levels` at its default (`["terminal", "verified"]`, which you already kept in [#2005](https://github.com/lushly-dev/afd/issues/2005)). The risk is transparent (the doctor and every local page warn loudly), contained to workspaces that opt into `person.local`, and never leaks into hosted `oauth`/`gateway` modes or memory confirmations.

---

## Part 3 — Deployer-chosen sign-in rules and presets (D184–D187)

Source: [Auth profiles specification](phases/5-auth-hosted/auth-profiles.spec.md). **Nothing in Part 3 is implemented yet.** These four decisions translate your D182 principle ("the deployer defines the auth layer; defaults stay strict; doctor warns; confirmations record proof") into concrete rules. Any change you want here can be made directly in the spec before coding begins.

### D184 — Per-issuer token profiles and scope qualifier (AFD and Umbel)

- **Built status:** **Not built yet.**
- **What people and agents can and cannot do:** Lets a deployer connect hosted Umbel to sign-in providers whose access tokens do not follow strict RFC 9068 token formatting (such as Microsoft Entra ID). Each provider needs a separate API app registration (distinct from Umbel's person-login app on the **same issuer**), and the deployer must verify provider-side settings Umbel cannot inspect. Technically, each JWT issuer can customize accepted token types (plain `JWT` alongside `at+jwt`), an exact string audience (such as an app GUID), and the token fields carrying the token ID (`jti`/`uti`), client ID (`client_id`/`azp`/`appid`), and permissions (`scope`/`scp`/`roles`). A server-wide `scope_qualifier` prefixes published permissions (for example `https://umbel.example.com/mcp/umbel:read`) and strips that prefix on incoming tokens. Defaults stay unchanged (strict RFC 9068), and token introspection is unchanged. When plain `JWT` is admitted, Umbel requires at least one permission claim, refuses sign-in ID-token markers (`nonce`, `at_hash`, `c_hash`), and refuses an API audience equal to any person-login client ID configured under the **same issuer**.
- **What risk is left:**
  - **ID-token confusion relies on provider hygiene:** Umbel cannot inspect other apps registered at the identity provider. If a deployer gives the API app redirect URIs or shares an audience across APIs, an ID token issued without `nonce`/`at_hash`/`c_hash` (or a token for another API) could be accepted unless the deployer follows the doctor's provider checklist.
  - **Server-wide qualifier:** `scope_qualifier` applies to every issuer on the host. When `scope_qualifier` is set and an access-token issuer reads `scope`, the doctor (`auth.provider`) warns that clients will now request qualified scopes (it cannot inspect whether another provider supports them).
  - **Unverified Entra colon support:** If Entra refuses `:` in scope values (test E1), a later scope-name mapping will be needed.
- **What it rules out later:** Per-issuer scope qualifiers (would need a config change) and multi-tenant `{tid}` issuer templates (tracked as a future AFD rule).
- **Recommendation:** **Confirm as written.** Defaults stay strict for every deployment that sets nothing, and the guards close the `JWT` confusion paths Umbel can observe while making deployer responsibilities explicit.

### D185 — Custom sign-in rules recorded as `declared` (amends D115 and D181)

- **Built status:** **Not built yet.**
- **What people and agents can and cannot do:** Today's strict user-verification check (D115 + D181 passkey coupling) becomes the default `standard` rule, producing assurance level `verified`. A deployer may also declare custom login rules matching their provider's login-strength claim (`acr` or `acrs`) plus required sign-in methods (`amr`, such as passkey or multi-factor values, via `amr_all` / `amr_any`). A login matched by a deployer's rule **can** decide person-gated commands on the hosted page, and records a **new assurance level, `declared`**—not `verified`. The doctor warns once per declared rule (with an extra warning if the rule requires no multi-factor or user-verification method).
  - **Important effect on verified-only reads:** `spaces.<id>.verified_levels` stays `["terminal", "verified"]` by default, leaving `declared` out. So on an Entra deployment, `verified_only` reads (such as Ideas) will **not** return records affirmed on the page until the deployer explicitly adds `"declared"` to `verified_levels`.
  - **Gateway mode restriction:** `auth.mode = "gateway"` refuses declared rules outright and keeps requiring a phishing-resistant standard login.
- **What risk is left:**
  - **Weak custom rules are allowed:** A deployer can write a single-factor or weak `declared` rule; the doctor warns and decisions are labelled `declared`, but Umbel does not block the login (by design under D182).
  - **No per-command `standard`-only lock:** A plugin manifest cannot yet demand the `standard` rule alone and refuse `declared` (tracked as a follow-up).
- **What it rules out later:** Having an Entra (or other custom-rule) deployment work with `verified_only` reads out of the box without adding `"declared"` to `verified_levels`. (The alternative—recording `verified` with evidence beside it—would avoid that config line, at the cost of making weak custom rules indistinguishable from strong standard logins to any reader checking only the level.)
- **Recommendation:** **Confirm as written.** Keeping `declared` separate from `verified` makes loosening honest and visible, and keeping `gateway` strict preserves gateway mode's stronger boundary. *(If you would rather have `declared` accepted by `verified_only` out of the box or allowed in `gateway` mode, say so now before implementation starts.)*

### D186 — Login scopes, discovery metadata checks, and provider presets

- **Built status:** **Not built yet.**
- **What people and agents can and cannot do:** Deployers can ask for extra login scopes (default `["openid"]`, always keeping `openid`; Entra needs `profile` to emit its stable user ID `oid`) and can set `claims_supported_check = "warn"` when a provider's discovery document omits claims its ID tokens actually carry (the login return still refuses tokens missing those claims). **No preset is selected by default**—omitting `preset` keeps today's raw strict rules. Two optional named presets fill only omitted config keys (explicit settings always win):
  - `better-auth` (**supported**, suggested explicit preset): keeps strict standard rules (`EdDSA` signatures, `at+jwt` tokens, and D181's phishing-resistant passkey login `phr` + `mfa`).
  - `entra` (**provisional**, doctor warns every run until 11 real-tenant tests pass): sets `JWT`, `oid`, `uti`, `azp`, `scp`/`roles`, server-wide `scope_qualifier`, 5,400 s token lifetime, and two `declared` rules (`entra-passkey` and `entra-hello`).
  The doctor (`auth.provider`) prints what each preset filled and a checklist of provider-side settings Umbel cannot check itself.
- **What risk is left:**
  - **Unconfirmed third-party assumptions:** The `entra` preset rests on Microsoft documentation and public metadata, with 11 facts unconfirmed against a real tenant (including `:` in scopes, login-strength/method claim values, and user verification enforcement). The `better-auth` checklist relies on Better Auth 1.8+, which was still in beta when the spec was written.
  - **Cross-issuer side effects of `entra`:** Enabling the `entra` preset on one access-token issuer raises `max_token_lifetime_s` to 5,400 s and sets `scope_qualifier` across *all* issuers on that host (reported by `auth.provider`).
- **What it rules out later:** Dropping provisional warnings on `entra` without actually running and recording the 11 tenant tests.
- **Recommendation:** **Confirm as written.** Keeping no preset as the strict default, offering `better-auth` as the suggested explicit preset, and marking `entra` clearly provisional gives deployers working starting points without pretending untested tenant behavior is verified.

### D187 — Recording login evidence on `declared` decisions

- **Built status:** **Not built yet.**
- **What people and agents can and cannot do:** Every login proven by a `declared` rule records its proof evidence (`{ rule, acrClaim, amr }`—the rule name, which login-strength claim matched, and the sign-in methods the provider reported) across the decision record, internal decision mark (`PersonMark`), SDK `PersonDecision`, `Assurance`, and provenance envelope v4. Standard `verified` logins record no extra evidence object, so existing standard deployments produce byte-identical records. The host's resume checks (which verify a completed person-page decision before running the gated command) accept `declared` wherever `verified` is accepted, restricted strictly to method `person-page`.
- **What risk is left:** Stores up to 16 `amr` sign-in method names from the ID token in decision and provenance records (on standing labels, full assurance details remain hidden from everyone except the operator and the space's person per D161).
- **What it rules out later:** Inspecting the raw sign-in method list on a `standard` (`verified`) decision without adding evidence recording to standard logins too.
- **Recommendation:** **Confirm as written.** Directly fulfills D182's rule that records let plugins and readers tell strong proof from weak proof, with zero change to strict deployments.

---

## Part 4 — Purely technical decisions (no owner choice needed)

These four unread entries govern documentation layout, internal trait and conformance-suite structure, cross-document sequencing, or pre-release versioning that has already been superseded. None changes what people or agents can do, adds residual trust risk, or closes off future product choices.

| ID | Summary | Status | Why no owner choice is needed |
| --- | --- | --- | --- |
| **D158** | Places host specifications needed by a first-class plugin beside that plugin's own spec (`endpoints/umbel/docs/plugins/<id>/host-<slug>.spec.md`), in D24's format. | In use (records and review host specs) | Repository documentation layout only; no effect on runtime behaviour or trust model. |
| **D170** | Adds three conformance test groups (`lane`, `standing`, `matching`) with deterministic gardening fixtures and differential privacy checks, 11 `DocumentStore` methods (plus 3 added in step B3 A36), and a "second to land renumbers" rule with Phase 6. | Built (steps B1–B5) | Internal trait surface, test-suite organization, and a temporary version-number tie-breaker (the version chain itself is now superseded by D200). |
| **D183** | Places the auth-profiles specification in one file beside Phase 5 covering both the AFD verifier changes and the Umbel host changes, with Python implementing alongside its M1–M4 parity work. | Not built yet | Document organization and cross-language sequencing only; no runtime or policy effect. |
| **D188** | Adds auth-profiles keys additively to pre-release config v7, person decision v2, envelope v4, and principal v1 instead of bumping to v8. | **Amended by D200** (2026-11-21) | Already superseded by your D200 decision to collapse all pre-release Umbel shapes to a single v1 before the first release ([#1931](https://github.com/lushly-dev/afd/issues/1931)). |

---

## How to reply

You can answer on the pull request or on [#1932](https://github.com/lushly-dev/afd/issues/1932) in whatever form is quickest, for example:
- **"Confirm all 28 as recommended"** (or confirm by group: Part 1, Part 2, Part 3, Part 4).
- **"Confirm all except D185 (…)"** — naming any entry you want amended and the outcome you want instead.
- Optional: note whether you also want D157's wording marked read (or kept outside the checkpoint) and whether D181's specification text needs any change.
