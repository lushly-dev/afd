---
name: manage-documentation
description: >
  Keeps a repository's documentation true to the code: AGENTS.md as the only
  instruction file, changelog entries, counts, links and sourced prose. Use when
  updating docs after a change, auditing them, or editing README, AGENTS.md or a
  changelog.
metadata:
  source: botcore
  version: 2.1.1
  portable: true
---

<!-- Generated from skills/exports.json; edit the canonical docs-manager skill. -->

# Docs manager

Documentation is worth keeping only while it matches the code. Keep root files short, give each fact one owner, and check every number and link you touch.

## Where things live

- **Skills hold depth; AGENTS.md routes.** AGENTS.md carries what every session needs: commands, layout, hard rules and an index of skills. Every line there costs every session, so when a topic grows past a few lines, move it into a skill or the document that owns it and leave a one-line pointer.
- **AGENTS.md is the only project instruction file.** Never generate, sync or restore a `CLAUDE.md` with its own content; the one exception is a root `CLAUDE.md` whose only line is `@AGENTS.md`, Claude Code's documented fallback, which a repository may keep. By default Claude Code reads AGENTS.md only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in the working directory or above it, so a generated copy quietly replaces AGENTS.md with a stale one. If you find one, merge its unique lines into AGENTS.md, then delete it and any script that regenerated it. Claude-only rules go in `.claude/rules/`, which loads alongside AGENTS.md.
- **Link, don't copy.** A fact written in two places drifts. README.md stays a self-contained quick start and links out for depth.

## Changelogs

- Give every user-visible change an entry saying what changed and why it matters to users: one per logical change, not a commit log. Refactors, tests and CI changes need none.
- When later work changes or reverses what an existing entry says, correct that entry (or its changeset) instead of adding a second one that contradicts it.
- Follow the repository's release mechanism. Where Changesets or a similar tool generates changelogs, write a changeset rather than editing the output, and keep any root CHANGELOG.md as an index of the package changelogs. Versions, tags and bump rules belong to the release skill.

## Botcore commands

The `docs_*` checks are Python functions in `botcore.commands`, not `botcore` CLI subcommands; call them from a bot's `<name>-run` MCP tool or a host that registers them. A pass can mean nothing was checked:

- `docs_lint(path=None)` checks internal links and anchors in a Markdown file, or every `*.md` under a directory (default `docs/`) outside `node_modules`, virtual environments and build output, and fails with `BROKEN_LINKS`; missing `status`, `author` or `created` frontmatter on `*.proposal.md` and `*.spec.md` is a warning. It skips external URLs.
- `docs_check_changelog()` flags staged code under any `src/` directory whose nearest CHANGELOG.md (from its directory up to the root) is not staged, when no `.changeset/*.md` is pending. Code outside a `src/` directory, or with no changelog above it, passes unseen.
- `docs_check_agents()` flags a staged command module (under a `commands/` directory, tests aside) and a new package (`package.json`, `pyproject.toml`, `Cargo.toml` or `src/**/__init__.py`), skill (`skills/**/SKILL.md`) or workflow, without a staged AGENTS.md. Other structural changes pass unseen, and it skips the check when the root AGENTS.md is absent.
- `docs_preflight()` runs both checks as one pipeline.
- `changeset_create(change_type, description)` (CLI: `botcore changeset-create`) writes a category fragment to `.changeset/`. It refuses any repository with a `package.json`, `pnpm-workspace.yaml` or `.changeset/config.json`, so there the checks suggest the repository's own Changesets command instead.

## Before finishing

- Recount every number the docs state (skills, packages, commands) against what it describes, and drop counts nobody needs.
- Check each link you added or moved, anchors to headings you renamed, and references to anything you renamed or removed.
- If the work completes a spec or plan, update its status.

## Prose

- Audit a finished draft against a list of AI tells (stock vocabulary, stacked hedges, signposting). Keep the list out of the generation prompt, because naming the words anchors the model toward them; to set a voice, show a short sample and name the audience.
- Never invent figures, names, dates or quotes to sound specific. Use what the code, the user or a cited source provides; otherwise state the claim plainly, cut it, or mark it `[source needed]`.
