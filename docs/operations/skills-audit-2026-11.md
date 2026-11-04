# Skills audit and rewrite plan

Snapshot: 2026-11-03. Covers Botcore's canonical skills (`endpoints/botcore/src/botcore/skills`), AFD's projected and local skills (`.claude/skills`), and Lushly's skills at `origin/main`. Status: owner decisions recorded 2026-11-03 (see the end). Batches 0 to 4 (all AFD and Botcore work) merged in #755, #757, #761, #774, #776 and #777. Batches 5 to 7 are in Lushly; Batch 5 waits on the delivery decision below.

## Summary

- **Scale.** Botcore has 55 canonical skills and AFD 69, of which 15 are local. Lushly has 93: 56 copies seeded from Botcore and 37 of its own. Together they hold about 600,000 words, counting each unique skill once. The average SKILL.md is about 1,300 words, and the average description is about 600 characters.
- **The listing is already overflowing.** AFD's descriptions total about 39,500 characters and Lushly's about 52,000. In a Claude Code session in AFD on 2026-11-03, about 30 to 40 skills were listed by name only. Claude Code budgets the skill listing at 1% of the context window (8,000 characters as a fallback) and drops descriptions first from the least-used skills. Those skills include `review-code`, `run-dev-checks`, `write-tests` and `manage-git`.
- **Usage is concentrated.** Across 407 Claude Code transcripts and 48 Codex sessions, almost every explicit invocation went to the session loop (`do-init-lushly` 48, `do-end-session` 41, `do-prepare-pr` 39) and to a few Lushly skills. Real reads cluster on about 20 skills. The 19 Botcore `-learn` skills had one invocation between them.
- **Diagnosis.** Most Botcore skills are textbook material in an identical template: capabilities list, routing table, principles, checklist, "When to Escalate", keyword-stuffed description and duplicate `triggers:` list. That template is the house standard because `manage-skills` and the SK lint rules encode it. Several of these skills contradict house conventions:
  - ESLint, Prettier and Black against Biome.
  - npm against pnpm.
  - Unpinned actions against SHA pins.
  - neverthrow against `CommandResult`.
  - Node 24 against `.nvmrc` 26.
- **The specific skills are valuable but have drifted.** This applies to AFD's language and session skills, Botcore's API skills and Lushly's domain skills. The audit confirmed about 35 concrete drift items. Hand-copied facts rot; skills that point at a single source (`pnpm verify`, `spec/`, `design.md`) don't.
- **Proposed end state.**
  - Botcore: 55 skills → about 9.
  - AFD: 69 → about 22.
  - Lushly: 93 → about 32.
  - SKILL.md text: roughly a quarter of today's.
  - Descriptions: under 300 characters each, totalling under 8,000 characters per repository, so every description fits the listing again.

## What current guidance says

Sources were checked on 2026-11-03.
- Anthropic: Claude Code skills, best-practices and memory docs; the platform's Skill authoring best practices; prompting guidance for current models; the skill-creator plugin; and posts from 2025-10 to 2026-06.
- OpenAI: Codex skills docs and best practices; prompting guidance for GPT-5.6 and GPT-6.
- The agentskills.io specification.
- Evidence: Vercel's AGENTS.md comparison (2026-01), SkillsBench (arXiv 2602.12670), Evaluating AGENTS.md (arXiv 2602.11988), More Skills, Worse Agents? (arXiv 2605.24050) and Chroma's context-rot study.

**What goes in a skill.**
- Only what the agent would otherwise get wrong. The test for each line is "would the agent get this wrong without it?"
- Gotchas are the highest-value content.
- One job per skill.
- Write from real project material; skills the model generated for itself scored slightly negative.
- Leave out time-sensitive content.
- Retire a capability skill once the model passes without it.

**Descriptions.**
- Say what the skill does and when to use it, key use case first, because hosts truncate.
- Include a few phrases users actually type, not an expanding keyword list.
- Say when the skill should not trigger.
- The hard limit is 1,024 characters, but "a few sentences" is the norm.

**Body.**
- SKILL.md under 500 lines and about 5,000 tokens.
- References one level deep, each with a stated reason to load it.
- After compaction, Claude Code keeps only the first 5,000 tokens of a skill, so critical rules go first.

**Tone and prescription.**
- Give the goal and the constraints, and exact steps only for fragile sequences.
- Explain why instead of using ALWAYS, NEVER or MUST.
  - Capitals and "CRITICAL" now cause over-application and overtriggering.
  - "Be thorough" and "verify" lines cause over-work on current models.
- Contradictions are worse than missing detail: Claude picks one arbitrarily, and GPT-6 can stall.

**Wrong vehicle.**
- A rule that must always hold belongs in a hook or permission rule.
- Repeated or fragile operations belong in a bundled script.
- Lint and formatting belong to tools.
- Facts needed every session belong in AGENTS.md, which should stay small.
- Workflows with side effects can set `disable-model-invocation: true`. That also removes them from the listing.

**Testing.**
- Run with and without the skill on real tasks, and record cost alongside pass rate.
- For skills the model invokes on its own, run trigger evals: about 20 queries, half near-misses, scored on a held-out set. Anthropic's skill-creator scripts automate this.

**Library size.**
- Wrong-skill selection is the main cost of a large library, driven by how similar the skills are.
- Performance fell up to 21% going from a few skills to 202.
- Two or three relevant skills on a task help most; four or more help less.

**Counter-evidence to respect.**
- Specific, detailed skills still help; only "comprehensive" ones hurt. So rewrites should cut generic and duplicated text, not specific gotchas.
- Curated skills gained about 17 points on average, but only about 4.5 in software engineering, where pretraining already covers the basics.
- Undertriggering is still common, so keep one or two trigger phrases.
- Moving content into AGENTS.md is not free:
  - Context files can lower success while adding more than 20% cost.
  - AFD's AGENTS.md is already about 28 KB against Codex's 32 KiB default `project_doc_max_bytes`.
  - Salvaged lines should therefore go to the skill or doc that owns the topic, not to AGENTS.md by default.

## Verdicts

Verdicts are KEEP, REWRITE (keep the value, cut the rest), MERGE, CONVERT (the value is real but belongs in a doc, script or AGENTS.md) and REMOVE. Words are given as SKILL/references. Each verdict summarizes a per-skill audit that read the SKILL.md and references in full and spot-checked claims against source. Re-check a verdict's evidence against the current tree before acting on it.

### Botcore canonical (AFD name in parentheses)

| Skill | Words | Verdict | Keep or note |
|---|---|---|---|
| accessibility-learn (ensure-accessibility) | 1,835/9,189 | CONVERT | Nothing specific to shadow DOM, FAST-AF or axe. Put a short list of the a11y checks the repos actually run in `loam-design` and Lushly's `build-fast-af-components`, then delete. |
| feature-flags-learn (manage-feature-flags) | 1,327/1,899 | CONVERT | Describes one app's `flag-gate`/`flagStore` stack that neither AFD nor Lushly has. Move it to the repo that owns that stack, or delete it. |
| authentication, caching, code-standards, commands, concurrency, css, data-modeling, deployment, dev-environment, error-handling, i18n, llm-integration, migration, observability, performance, refactoring, state (`-learn`) | ~25,000/~95,000 | REMOVE (17) | Textbook. Several contradict house conventions. A handful of lines are salvaged into SETUP.md, the model-routing doc and Loam docs. |
| api-designer, component-tester, content-designer, dependency-manager, design-implementer, duplication-finder, license-auditor, persona-creator, storybook-builder, systems-architect, test-writer | ~13,000/~38,000 | REMOVE (11) | No ecosystem content. design-implementer is Microsoft Fabric/Fluent residue. duplication-finder cites `lush discover duplicates`, which doesn't exist. component-tester invents a `>>` shadow combinator. storybook-builder targets Lit and npm. |
| pr, hotfix, repo-cleanup, git-manager, project-manager, research, problem-solver, prompt-creator | ~8,000/~15,000 | REMOVE (8) | Three PR body shapes contradict each other. Hotfix assumes `v*` tags and `release/*` branches AFD doesn't have. git-manager recommends status checks that `main` doesn't use. `lush`/`lushx` aren't installed. No repository has a Copilot `.prompt.md`. |
| commit + commit-writer (do-commit, write-commits) | 1,750/1,123 | REMOVE | AFD's `quality_gate.py` calls three `async def` Botcore functions without `await`, so it is broken. Its 50-character subject limit contradicts commitlint's 72. `do-prepare-pr` already owns committing; give it one line pointing at `commitlint.config.js`. |
| release (do-release, override) | 616/310 | REMOVE canonical | AFD's `do-release` is the real one; make it `local`, not an override. |
| docs-update + docs-manager + content-humanizer (do-documentation-update, manage-documentation, humanize-content) | ~4,200/~7,400 | MERGE → `manage-documentation`, about 450 words | Skills hold depth, AGENTS.md routes, and AGENTS.md is the only instruction file. Check counts and links. From humanizer: audit drafts against an AI-tell list rather than putting the list in the prompt, and never invent figures. AFD's humanize-content fork teaches fabrication ("Costs dropped 15%"); delete it. |
| review + code-reviewer (do-review, review-code) | 1,800/1,970 | MERGE + REWRITE → `review-code`, about 400 words | Fresh-agent rule; delete the prior review before re-reviewing; per-artifact boundaries. Drop the "Complete Feature Principle", which blocks phased plans, the generic checklists and "NEVER rely on training data". Heavily read in Lushly. |
| dev-checks (run-dev-checks, override) | 1,470/2,046 | CONVERT | Restates AGENTS.md's "Quality Gates & CI". Add the three lines it alone carries (ci.yml ↔ lefthook parity, the `afd-override: max-lines` cap, Botcore `dev_*` optional), then delete. |
| skill-manager (manage-skills, override) | 1,165/12,933 | REWRITE, about 450 words | This is the rulebook, and it currently encodes the old style (see Batch 0). |
| security-auditor (audit-security) | 1,350/8,068 | REWRITE, about 800 words | Keep the MCP and agent material: write-capable tools raise severity, the tool-power classification, the sandbox policy (with `asyncio` off the allowlist), proportionate calibration, subagent permission inheritance. Cut OWASP, STRIDE, CVSS, report templates and `.claudeignore`. |
| mcp-builder (build-mcp-servers) | 1,563/2,539 | REWRITE, about 700 words | Verified Botcore facts: measure `tools/list`, never truncate structured output, `smart_truncate`, the `stdin=DEVNULL` Windows deadlock. Its `exec(compile())` template contradicts Botcore's trusted-local stance, and the Claude Code config path is wrong. |
| plugin-builder (build-botcore-plugins, override) | 948/2,009 | REWRITE, about 450 words | Every example calls `error("msg")`, but the signature is `error(code, message, *, suggestion=...)`. Rebase it on `docs/host-composition.md`, and delete the stale AFD override. |
| browser-automation (automate-browsers) | 873/2,915 | REWRITE, about 700 words | Missing the `cdp_trace_*` commands, and the network commands are stubs. Add a test that every exported `cdp_*` command is documented. |
| botcore-config (configure-botcore) | 672/1,841 | REWRITE (light), about 900 words | Its CLI-override layer is unwired, and `EnvConfig` and `duplication_*` are unused. |
| agent-config (not projected) | 2,941/956 | REWRITE, about 550 words | Keep connector resolution and the `allow_mcp` semantics. Add the `state` block. Drop the "Fabric UX Agent" examples. |
| spec-writer (write-specifications) | 826/1,341 | REMOVE (owner decision) | Little use. Its only unique rules were interface-only specs and code blocks of 50 lines or fewer. |

### AFD local

| Skill | Words | Verdict | Keep or note |
|---|---|---|---|
| afd + afd-developer | 2,151/13,998 | MERGE → `afd`, about 650 words | Keep the honesty check, define-validate-surface, routing and the meta-tool reference. The parity rule becomes one link. `platform-utils.md` imports from the wrong subpath. afd-developer lists error codes and related skills that don't exist. |
| afd-typescript / -python / -rust | 3,284 / 3,691 / 4,462 | REWRITE to about 1,900 / 2,300 / 2,600 | The APIs are accurate. Cut the Zod, Pydantic and test tutorials and the Parity Rule repeated in five skills, and link `spec/`. Fix the drift: `afd tools --detail`, "FastMCP", crate 0.1.0 against 0.2.1, `register_with_schema` described as "unmerged", tsconfig ES2022. |
| afd-cpp | 1,843 | KEEP | Accurate and specific. |
| afd-auth, afd-directclient | 1,801, 2,323 | REWRITE to about 1,000 and 1,200 | Replace the evidence logs and HTTP boilerplate with pointers. afd-auth's npm baseline is stale (2.1.0 against 2.2.1). |
| optimistic-mutations | 861 | CONVERT | Fold about 120 words into afd-directclient and repoint the two Loam docs that cite it. |
| afd-contracts | 467 | REMOVE | No TypeSpec exists in the repository. |
| afd-site-design | 1,285/3,710 | KEEP, trim | Delete `history.md` (2,300 words, a retired review). |
| loam-design | 1,650/3,764 | REWRITE, about 500 words | Its rules appear three times. Make it a router to `design.md`, the only source. |
| do-init-afd | 1,284 | REWRITE (light), about 800 words | Keep the stop conditions, stash rule, explicit-refspec fetch and landing check. Its claim about which Node versions CI runs is wrong. |
| do-prepare-pr | 1,787 | REWRITE, about 1,000 words | Step 5's gate table covers 5 of 15 workflows. Replace it with `pnpm verify`. "All packages share one version" is false. Keep the review stop condition and the merge-authorization rules. |
| do-end-session | 1,024 | KEEP (light trim) | Accurate. |
| do-release (becomes local) | 2,425/1,407 | REWRITE, about 1,100 words | Move the dated receipts to `docs/operations/`. The baselines in `next-round.md` contradict SKILL.md. |

### Lushly local

| Skill | Verdict | Keep or note |
|---|---|---|
| lushly-execution-policy | REWRITE, about 650 words | Keep the decision-model contract (typed ≠ correct, abstain, correlated judgments, code owns the thresholds). AGENTS.md already carries the routing. |
| review-code-lushly (+ the seeded do-review) | REWRITE; split the reviewer-facing part from the coordinator-facing part | Keep `pnpm review:lanes`, `--verify-handoff`, trusted-base profiles and the evidence table. Model routing is stated in about five places. |
| lushly-gate-discipline, lushly-worktree-discipline | KEEP, trim to about 1,100 and 1,300 | Accurate and used. |
| lushly-understand-plants + -data-strategy | MERGE → `lushly-understand-plant-data` | `technical-patterns.md` documents SQLite, but the repository runs Neon/Drizzle. |
| lushly-understand-domains, -business (refs) | CONVERT to Docs pointers | domains lists about 11 tables that don't exist. |
| lushly-understand-site, -calculations, -create-providers, -manage-data, -manage-commerce, -run-server, -maintain-docs, -voice | REWRITE (450 to 1,300 words each) | Drift: `createLushlyServer` path, "Gemini 2.0 Flash", "68 commands" against about 246 in the code, stale store signatures, a different chat prompt. maintain-docs tells authors to put domain knowledge in skills, which is how the five understand-* skills grew. |
| lushly-botanical-illustration + lushly-image-session | MERGE | |
| lushly-use-lushbot | REMOVE | Documents `botcore changeset-*`; the repository uses `@changesets/cli`. |
| afd-create-commands (+ afd-test-commands, afd-understand-architecture) | MERGE + REWRITE, about 1,300 words | Lushly's `@lushly/core` wrapper rules are real. Turn the checklists that every gate already enforces into a script. |
| build-fast-af-components (+ do-build-, do-review-fast-component) | MERGE + REWRITE, about 900 words plus 3 refs | Move the FAST-AF fork references to `foundations/fast-af` docs in AFD. |
| do-init-lushly | REWRITE, about 900 words, plus `scripts/session-preflight.mjs` | The most-invoked skill. The fetch, ff-only, pnpm-shim and detached-HEAD steps move into the script. |
| do-run-fleet (+ do-orchestrate) | MERGE + REWRITE, about 500 words | Keep leases, batching, `needs:*` lanes and the coverage duty. Delete `codex_exec.sh`, which AGENTS.md forbids using. |
| do-triage | REWRITE, about 1,000 words, plus `labels.yml` and an invariant script | |
| do-sweep | KEEP | |
| frontend-design | REWRITE, about 1,200 words; rename to `lushly-design` | The content is Lushly's own, but it shares a name with Anthropic's plugin skill and carries a stray Apache LICENSE file. |
| skill-creator | REMOVE | A vendored copy of Anthropic's plugin. |
| loop-babysit | REMOVE | Dormant since 2026-03. `/loop` and do-sweep cover it. |
| gemini-, google-maps-, tomorrow-, visualcrossing-research-api | REMOVE | Stale search summaries; the code is the reference. |

Lushly's seeded copies:
- Most will simply be removed with Botcore.
- `do-prepare-pr`, `do-end-session` and `do-commit` are Lushly-owned in practice. Register them as local.
- Drop `do-release` and `build-mcp-servers` from Lushly; it is private, deploys via Vercel, and runs a TypeScript MCP server.
- Re-adopt `manage-documentation`. Lushly's copy still says CLAUDE.md is generated from AGENTS.md.
- Seeding is broken. Lushly commit 9810ff65 stripped `source:` from every skill's frontmatter, and Botcore's `seed.py` skips any skill without `source:`. As a result, `botcore skill-seed --update`, the documented update path, refreshes nothing.
- The root cause is in Botcore: it ships two skill linters that contradict each other.
  - `botcore skill-lint` (`commands/skill_lint.py`) flags `source`, `version`, `triggers` and `portable` as unsupported runtime fields (SK018). Following it is what stripped Lushly's frontmatter.
  - The `skill_lint` command (`commands/skill/lint.py`, used by Alfred) warns when `triggers` or `version` are missing (SK006, SK013).
  - The open standard has a `metadata:` map for exactly this kind of tracking data.

## Plan

Each batch is one PR. Batch 0 goes first, because every later rewrite is judged against it.

**Batch 0: rulebook and listing guard (AFD, covering Botcore).**
- Rewrite `skill-manager` to the principles above (about 800 words, down from about 14,000 including references).
  - Delete its references, templates, README and CI example; the open standard and Anthropic's skill-creator cover that ground.
  - Make AFD's `manage-skills` a projection again. The override held no AFD-specific content, and AGENTS.md already documents the projection workflow.
- Add a listing budget to `pnpm check:skills`.
  - Each profile in `skills/exports.json` declares `listingBudget`: the most description and `when_to_use` characters its model-invocable skills may total.
  - Any description over the open standard's 1,024 characters fails.
  - The budget starts at today's total (39,100) as a ratchet. Batches 1–3 lower it, and the target is 8,000.
- Lint rules are left alone in this batch; they change with the linter merge in Batch 2.

**Batch 1: removals (AFD and Botcore).**
- Delete the 36 generic Botcore skills, the commit chain, canonical `release` and `spec-writer`. Also delete AFD's `afd-contracts`, `run-dev-checks`, and the stale `integrate-llms` and `humanize-content` overrides.
- Move the few salvaged lines to the files that own their topics.
- Update `skills/exports.json` and lower `listingBudget`, then the Botcore README, the package smoke test's skill count, and the provenance rows.
- Retire, don't just delete. `RETIRED_SKILLS` lists the removed skills under their current and earlier names, and rename entries whose target was retired are dropped.
  - `skill-seed` removes botcore-managed copies in consuming repositories, unless `[skills]` include/skip keeps seed away from the name. It reports the copies it keeps.
  - `skill-status` reports them as `retired`.
- Edit `do-prepare-pr`'s commit step.
- Most of this is mechanical; the biggest effect is on the listing.

**Batch 2: surviving Botcore skills (AFD).**
- Rewrite each surviving skill as a single SKILL.md, verifying every API claim against `endpoints/botcore` source:
  - `code-reviewer` (`review-code`), absorbing `review`;
  - `docs-manager` (`manage-documentation`), absorbing `docs-update` and `content-humanizer`;
  - `security-auditor`, `mcp-builder` and `plugin-builder`;
  - `browser-automation`, plus a test that it names every exported cdp command;
  - `botcore-config` and `agent-config`.
- Record the merged skills as renames to their merge targets, so seeding migrates them.
- Make every AFD override a projection again.

**Batch 2b: skill tooling (AFD).**
- Merge the two linters into one rule set:
  - Drop the trigger requirement.
  - Make a description over 1,024 characters an error, and warn above about 300.
  - Warn on `triggers:` and "Triggers:" lists.
  - Warn on bodies over 500 lines.
  - Accept current Claude Code fields.
  - Add a listing-budget rule for consuming repositories such as Lushly.
- Move Botcore's tracking fields (`source`, `version`, `portable`) under the standard `metadata:` map.
  - `skill-seed`, `skill-adopt`, `skill-status` and `skill-list` read them there, falling back to the top level for older copies.
  - This is what lets seeding keep working with runtime-clean frontmatter.

**Batch 3: AFD local accuracy and trim.**
- Fix the 14 confirmed drift items first.
- Merge afd-developer into afd.
- Trim the language, auth and directclient skills, and fold in optimistic-mutations.
- Drop afd-site-design's `history.md`.
- loam-design stays as it is, apart from a shorter description. Loam's phase 0 specification (decision D26) and `endpoints/loam/docs/design.md` deliberately have the skill carry the same rules as the design document. Making it a router would reverse that decision, so it is the owner's call.

**Batch 4: AFD session loop.**
- Rewrite `do-init-afd`, `do-prepare-pr` and `do-release`, and trim `do-end-session`.
- They stay model-invocable, so keep their descriptions short and specific.
- Evaluate by replaying two or three recent sessions against the old and new text before merging. These are the most-used skills.

**Batch 5: Lushly plumbing and removals** (after Batches 1 and 2).
- Decide first how Lushly receives the cleaned skills. It pins `lushly-botcore[all]==0.3.5` from PyPI, and AFD's Botcore is quarantined from publishing, so `skill-seed` there still delivers the old set. The options are a Botcore release, or seeding from AFD's source (for example `uvx --from 'git+https://github.com/lushly-dev/afd#subdirectory=endpoints/botcore'`). This is an owner decision.
- Re-adopt the surviving canonical skills with `metadata:` ownership, so `skill-seed --update` refreshes them again.
- Delete the copies Botcore removed and the Lushly removals listed above.
- Register Lushly's session skills as local.
- Lushly's `scripts/build-review-packet.mjs` lists trusted-base lane contracts that Batch 2 deleted: `review-code/references/review-checklists.md`, `review-code/references/feedback-format.md` and `audit-security/references/agent-and-supply-chain.md`. Remove them and their tests rather than recreating the files. The label definitions now live in `review-code/SKILL.md`, and the lane formats are already in Lushly's reviewer profiles. Keep the lane-specific tool boundary and the `[executed: coordinator]`/`[traced]` tags in `review-code-lushly` and the profiles.
- Add Lushly's listing budget.

**Batch 6: Lushly domain skills.**
- Rewrite `lushly-execution-policy` and `review-code-lushly`.
- Consolidate the understand-* skills and convert the doc duplicates to pointers.
- Merge the two image skills.
- Fix the 7 drift items.
- Change maintain-docs' rule so durable domain knowledge goes to Docs.

**Batch 7: Lushly workflow skills.**
- Rewrite `do-init-lushly` with its preflight script.
- Merge: `afd-create-commands` (absorbing two skills), `build-fast-af-components` (absorbing two) and `do-run-fleet` (absorbing do-orchestrate).
- Rewrite `do-triage` with its scripts.
- Rename and trim `lushly-design`.
- Repoint the `ensure-accessibility` references.

Batches 3–4 and 5–7 are independent of each other once Batches 0–2 land.

Still to confirm: whether Codex discovers these skills through `.codex/skills`. Its current docs name only `.agents/skills`.

## Outcome in AFD (2026-11-04)

- **Skill counts.** Botcore's canonical skills went from 55 to 9, and AFD's from 69 to 21.
- **Listing.** It went from 39,092 to 5,639 description characters, under the 8,000-character fallback that hosts use. `listingBudget` and `botcore.toml`'s `listing_budget` hold it at 5,700, and every AFD skill lints with no errors or warnings.
- **Code findings filed as issues:**
  - #778: the CDP commands.
  - #779: the docs checks.
  - #780: an unverified agents orchestrator reset.
  - #781: the `pnpm verify` preflight.

Still open for the owner:
- **Lushly delivery.** How Lushly receives the cleaned Botcore skills: a release, or installing from AFD's source (see Batch 5).
- **loam-design.** Whether it should become a router to `endpoints/loam/docs/design.md`. That would reverse Loam's D26 (see Batch 3).

## Owner decisions (2026-11-03)

1. Remove the generic skills from Botcore's canonical set, not just from the projections. Rebuild a skill if and when it has unique value to add.
2. Keep the session and release workflows model-invocable. Agents use them mid-flow and recommend them as next steps, so they don't get `disable-model-invocation`.
3. Keep seeding Lushly from Botcore, once Botcore's skills are worth seeding. Repairing ownership tracking (Batches 2 and 5) is part of that.
4. Remove `write-specifications`.
