# October stabilization release readiness

Updated: 2026-10-11. Stabilization PR #367 landed at `f19257e`. Tracks [#347](https://github.com/lushly-dev/afd/issues/347),
[#359](https://github.com/lushly-dev/afd/issues/359) and
[#360](https://github.com/lushly-dev/afd/issues/360), with remaining publication
and advisory work in [#369](https://github.com/lushly-dev/afd/issues/369) and
[#371](https://github.com/lushly-dev/afd/issues/371).

## Published packages and repository source

Registry checks on this date returned npm `@lushly-dev/afd-core` **1.0.0** and
PyPI `afd` **0.8.0**. The repository npm fixed group is **2.0.0**, with pending
changesets selecting **2.1.0**. These are independent language releases; the
private root package version is not a distribution version.

The Python release candidate identifies itself as **0.9.0**, including all three
dependent lockfiles. It contains lazy optional imports and subsequent API/wire
changes absent from published 0.8.0. The dated changelog explains camelCase
migration and preserves the following 0.10.0 server-defaults milestone.
Passing the local 0.9.0 wheel does not repair PyPI's 0.8.0 artifact. PyPI versions
cannot be overwritten; #347 remains open until the new published base wheel passes.

For consumers affected by #347, the published-version workaround remains:

```sh
python -m pip install 'afd[client]==0.8.0'
```

This installs the optional HTTP dependencies required by that published
artifact. It does not provide the repository's newer wire/API behavior.

## Dependency disposition

The full workspace audit started with 12 findings: one critical, five high and
six moderate. Compatible updates reduce it to **two**: one high and one moderate.
The production-filtered audit reports **zero**. These counts are advisory
findings, not demonstrated application exploits.

| Dependency | Before | Stabilized lockfile |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | 1.32.1 |
| `proxy-addr` | 2.0.7 | 2.0.8 |
| `ip-address` | 10.7.0 | 10.7.3 |
| `brace-expansion` | 5.0.9 | 5.0.12 |
| `fast-uri` | 3.1.7 | 3.1.8 |
| `smol-toml` | 1.8.0 | 1.9.1 |
| `source-map-js` | 1.2.1 | 1.2.2 |

The SDK dependency range is raised in the server and todo manifests. Four
vulnerable transitive ranges have bounded, compatible root overrides. The SDK
refresh also resolves its compatible proxy and IP dependencies. No unrelated
major upgrades are included. Existing Dependabot proposals were inspected:
Changesets 3, dotenv 18, GenAI 2 and action major upgrades remain separate work;
the yaml patch proposal and broader dev group are also unrelated to these
advisories. No Dependabot pull request was merged.

Remaining findings reach root development tools Changesets and Knip. Neither
advisory lists a patched version; [#371](https://github.com/lushly-dev/afd/issues/371)
tracks their unresolved disposition separately:

- [`braces` 3.0.3, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
  deeply nested brace patterns can exhaust the stack. Paths include Changesets
  config/git → micromatch → braces; Changesets → get-packages → globby → fast-glob
  → micromatch; and Knip → fast-glob → micromatch. Inputs include repository-controlled
  `fixed`, `linked`, `ignore`, `changedFilePatterns`, workspace and Knip globs.
  The current fixed glob is `@lushly-dev/*`. No shipped AFD command-to-pattern path
  was established. Review these configurations before privileged tooling execution.
- [`sprintf-js` 1.0.3, GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c):
  an attacker-controlled format string with excessive numeric precision can
  throw a RangeError. The path is Changesets → get-packages → read-yaml-file →
  js-yaml → argparse → sprintf-js. The observed YAML library path uses `safeLoad`;
  js-yaml's argparse import is in its standalone CLI, not that library entry point.
  Actual workspace discovery found 16 packages without loading argparse or
  sprintf-js. This does not establish all tooling paths are inactive. Reassess
  if the CLI, argparse or untrusted help/usage templates enter the execution path.

Keep both findings visible in full audits, without suppression. Recheck upstream
before each release and by 2026-11-11. Changesets 2.31.1 is current on its maintenance
line; a Changesets 3 migration changes release behavior and still leaves Knip's
braces path. Compatible fixes/removal or a separately reviewed migration remain
required; this record does not assert blanket risk acceptance.

## Validation before a release candidate

Use Node 24.21.0 for the local npm gate, then the language-specific gates. The
coordinator records the exact final candidate and full test receipts.

```sh
node --version
pnpm install --frozen-lockfile
pnpm check
pnpm audit
pnpm audit --prod
pnpm changeset status --verbose
node scripts/check-versions.mjs

cd python
uv lock --check
uv sync --frozen --all-extras
uv run ruff check --select F821,F841,B904 src
uv run pytest -q
uv build
```

`python.yml` runs these Python checks on 3.10, 3.11 and 3.12. Each interpreter
then installs the wheel into four independent environments: base, client,
server and CLI. `scripts/python-wheel-smoke.py` runs with `python -I`, executes
a local DirectClient command, checks that base has no `httpx`/`mcp`, imports the
client transports, and constructs a server, registers/executes an explicitly
MCP-exposed command and builds its actual FastMCP tool registry. The CLI also
runs its installed entry point with `--help`.

`publish-python.yml` validates the tag for both push and release events, then
calls `python.yml` before building/uploading the release artifact. Actions remain
pinned. The PyPI environment and OIDC publish permission remain in the publish
job. The local smoke matrix is not a receipt for the complete remote workflow.

## npm release sequence

The latest inspected Release run,
[38173831514](https://github.com/lushly-dev/afd/actions/runs/38173831514), succeeded
by updating [release PR #338](https://github.com/lushly-dev/afd/pull/338).
This establishes that Actions can currently manage the version PR. It does not
establish working npm publish credentials; npm remains at 1.0.0.

The accepted versioning decision retains 2.0.0 before 2.1.0. A maintainer can
inspect the old failed candidate and its original gate with:

```sh
gh run view 35950563235
gh run view 35950563235 --log-failed
npm view @lushly-dev/afd-core version
```

Only after the maintainer verifies publishing authentication and explicitly
authorizes publication, re-running `35950563235` publishes the historical
`b4a94e6974e534c57758eb00b8823bb0f370406d` 2.0.0 candidate. That candidate does
**not** include October stabilization fixes. Its rerun window expires 30 days
after 2026-09-24; if unavailable, prepare a separately reviewed recovery path.
Do not silently change the accepted release order or publish the working tree.

After stabilization lands, inspect the refreshed #338 release diff, version
selection, exact-head CI and packaged dependency ranges. Merging that version
PR is a publication trigger, so it needs the maintainer's release authorization.
Confirm all nine fixed-group packages, their tags and installability afterward.

## Python release sequence

The 0.9.0 candidate updates `python/pyproject.toml`,
`python/src/afd/__init__.py`, the dated `python/CHANGELOG.md`, and the three
lockfiles that record AFD's version. To regenerate this metadata, run:

```sh
uv lock --project python
uv lock --project alfred
uv lock --project packages/examples/todo/backends/python
node scripts/check-versions.mjs --write
```

Review camelCase migration notes and the version plan's following 0.10.0 server
defaults milestone. Require the complete Python matrix, isolated-wheel matrix
and conformance checks on the release candidate. Once that PR is merged and
publication is authorized, the maintainer tags the exact merge commit
`python-v0.9.0`; the publish workflow revalidates the tag, matrix and wheel.
This follow-up prepares the version bump; no Python tag or upload is included.

Local 0.9.0 validation passed 2,537 tests on each of Python 3.10, 3.11 and 3.12,
all 12 isolated wheel installations (base/client/server/CLI), and the base import
consumer reproduction on each interpreter. The wheel's runtime payload differs
from the previously tested stabilization wheel only in its version string.

After publication, verify the new registry version with `pip index versions afd`
and install base plus each extra in fresh environments. Run the same isolated
smoke script against the downloaded published wheel, then close #347 only after
the base consumer reproduction passes for that published release.
