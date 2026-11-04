---
name: manage-skills
source: botcore
description: >
  Write, trim and check agent skills (SKILL.md) so each carries only what an
  agent would otherwise get wrong. Use when creating, auditing or rewriting a
  skill, or deciding whether guidance belongs in a skill at all.
version: 4.0.0
portable: true
---

<!-- Generated from skills/exports.json; edit the canonical skill-manager skill. -->

# Skill manager

A skill earns its place only if it changes what the agent does. Current models already know general engineering practice, so write the difference: what is specific to this codebase, product or workflow, and what the agent gets wrong without being told.

## Decide whether it should be a skill

Belongs in a skill:
- Facts the agent can't derive: internal APIs, paths, contracts, and house decisions with their reasons.
- Gotchas that have actually happened. These are usually the most valuable lines.
- A workflow specific to this repository, with its stop conditions and checkers.
- Deterministic helpers (scripts, schemas) that replace guesswork.

Belongs somewhere else:
- **Textbook knowledge** (OWASP lists, REST naming, Git basics, testing pyramids): delete it.
- **A rule that must hold every time**: make it a hook, permission rule, lint rule or CI check.
- **A fact every session needs**: put it in AGENTS.md, and keep that file small. Each line there costs every session.
- **Content another file already owns** (a spec, a design doc, a command's `--help`): link to it. Copies drift.
- **A copy of a public skill**: install the plugin instead.

Test each line with one question: would the agent get this wrong without it? If not, cut the line.

## Write the description

The description is how agents choose a skill, and every description in a repository shares one listing budget. Claude Code allows about 1% of the context window and drops descriptions, starting with the least-used skills, when the listing overflows. Codex does something similar. A long description pushes other skills out of view.

- **Content:** one or two sentences. Say what the skill does, then "Use when ..." with the situations and a phrase or two a user would actually type.
- **Near-neighbours:** if a similar skill exists, say when not to use this one.
- **Length:** aim for under 300 characters. The open standard's hard limit is 1,024.
- **No keyword lists:** no `triggers:` arrays and no "Triggers: a, b, c" strings. Hosts don't read the arrays, and the strings spend budget without improving selection.

## Write the body

**Size and structure**
- Put the critical content first. After compaction, Claude Code keeps only the first ~5,000 tokens of an invoked skill.
- Stay under 500 lines.
- Move lookup material into `references/`, one level deep. Link each file and say when to read it.

**How much to prescribe**
- State the goal and the constraints. Give exact steps only where a step is fragile or the order matters.
- Offer one default rather than a menu.
- Give the reason in a clause instead of writing ALWAYS, NEVER or MUST in capitals; current models over-apply emphatic rules. Keep absolute wording for real invariants, and enforce those mechanically where possible.

**What to leave out**
- Persona lines, capability lists that restate the description, and generic checklists.
- "When to escalate" boilerplate.
- Instructions to "be thorough" or "verify everything". Current models already do this, and these lines cause over-work.
- Dated version, model or price tables.

**Sources and helpers**
- For facts that change, point at their single source (a command such as `pnpm verify`, a spec, a generated file) rather than copying them.
- Put deterministic work (parsing, counting, validation) in scripts. Print results to stdout and recovery advice to stderr.

## Check that it earns its place

- **Before writing:** run the task without the skill, note what goes wrong, and write only enough to fix that.
- **After a rewrite:** rerun two or three real tasks with the old and new text. Compare the result, tokens and time, and drop content whose removal changes nothing.
- **Triggering:** for skills the model invokes itself, try about 20 realistic prompts, half of them near-misses that shouldn't trigger. Anthropic's skill-creator plugin automates trigger evaluation and description tuning.
- **Retirement:** retire a skill once the model does the task as well without it. It can be rebuilt when it has something specific to say.

## Botcore specifics

- **Linting:** run `botcore skill-lint <skills-dir>` before committing.
- **Seeding:** `botcore skill-seed --update` refreshes only skills whose frontmatter says `source: botcore`. A skill without that line counts as locally owned and is skipped, so stripping it silently stops updates.
- **Versions:** bump `version` when you change a canonical skill, so `botcore skill-status` reports drift in consuming repositories.
- **Renamed projections:** some repositories project Botcore skills under other names, such as AFD with `skills/exports.json`. Edit the canonical source and regenerate, because the projections are overwritten.
