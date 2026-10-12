# October stabilization release readiness

Updated: 2026-10-11. Stabilization PR #367 landed at `f19257e`. Tracks [#347](https://github.com/lushly-dev/afd/issues/347),
[#359](https://github.com/lushly-dev/afd/issues/359) and
[#360](https://github.com/lushly-dev/afd/issues/360). Publication recovery in
[#369](https://github.com/lushly-dev/afd/issues/369) is complete; remaining
advisory work is tracked in [#371](https://github.com/lushly-dev/afd/issues/371).

## Published packages and repository source

Registry checks on this date returned all nine npm packages at **2.1.0** and
PyPI `afd` at **0.9.0**. Both match their repository manifests. The accepted npm
sequence published historical 2.0.0 before current 2.1.0. These are independent language releases; the
private root package version is not a distribution version.

Python **0.9.0** was published from the exact #372 merge commit
`4e16a0699eeb00c5d6576d29be575b86ca8fa485`, tagged `python-v0.9.0`.
It contains lazy optional imports and subsequent API/wire changes absent from
0.8.0. The dated changelog explains camelCase migration and preserves the
following 0.10.0 server-defaults milestone. [#347](https://github.com/lushly-dev/afd/issues/347)
is closed after verification of the downloaded published wheel.

Consumers affected by #347 can upgrade to the repaired base package:

```sh
python -m pip install --upgrade 'afd==0.9.0'
```

The base install does not require the optional HTTP or MCP dependencies. Use
the client, server or CLI extra when that functionality is needed.

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

## npm publication outcome

Recovery completed through the existing workflow, in the accepted order:

| Version | Published source | Successful Release run |
|---|---|---|
| 2.0.0 | `b4a94e6974e534c57758eb00b8823bb0f370406d` | [35950563235, attempt 3](https://github.com/lushly-dev/afd/actions/runs/35950563235/attempts/3) |
| 2.1.0 | `0148d2290ccf06769fd33c2b6484d3a8e4940669` | [38198328413](https://github.com/lushly-dev/afd/actions/runs/38198328413) |

Signed-in settings inspection found no trusted publisher connections on the
nine packages. After scoped approval, all nine connections were saved and
verified: GitHub owner `lushly-dev`, repository `afd`, workflow `release.yml`,
no environment name, **Allow npm publish** enabled and dist-tag management
disabled. Existing credentials and publishing-access settings were preserved.
Both successful uploads selected OIDC; this establishes recovery after setup.

The historical 2.0.0 candidate was independently rebuilt and inspected before
its rerun. It does **not** include October stabilization fixes. The refreshed
[release PR #338](https://github.com/lushly-dev/afd/pull/338), head
`5abbc026a29df000e7abc3ea491c946f3b42ba02` on base
`4e16a0699eeb00c5d6576d29be575b86ca8fa485`, passed all seven applicable checks
and independent packed-artifact validation before merging. Its merge tree
matches the reviewed candidate exactly.

Post-publication checks covered all nine packages at **both** versions. Every
downloaded tarball passed registry integrity verification and matched its
reviewed pack file-for-file. All 18 annotated Git tags resolve to the intended
source commits above. Two fresh consumers installed the exact versions through
ordinary npm resolution; package imports, DirectClient, server execution, CLI
version/help and production audits passed. Both production audits reported zero
advisories without workspace overrides.

The installed 2.1.0 consumer additionally passed real loopback MCP and CLI
connect/list/call operations, offline executable selection, result validation,
DOM adapter/CSS checks, MemoryAdapter ID validation and view-state persistence.
Strict view-state root and `/commands` declarations passed with local-db absent;
with it installed, the complete DataAdapter contract passed bidirectional
assignment. These published-consumer checks used Node 24.21.0; they do not claim
a repeated Node 22 or hosted-provider matrix.

Initial registry responses lagged successful uploads. Fresh official JSON
metadata and actual tarball downloads established availability, followed by
ordinary installs with a fresh npm cache. No successful publication was retried
because of stale metadata. A separate unpinned install selected 2.1.0 for all
nine packages, and `npx --offline afd --version` returned 2.1.0. #369 was closed
after registry consumer verification.

## Python release sequence

The 0.9.0 release updates `python/pyproject.toml`,
`python/src/afd/__init__.py`, the dated `python/CHANGELOG.md`, and the three
lockfiles that record AFD's version. To regenerate this metadata, run:

```sh
uv lock --project python
uv lock --project alfred
uv lock --project packages/examples/todo/backends/python
node scripts/check-versions.mjs --write
```

The complete Python matrix, isolated-wheel matrix and conformance checks passed
on the release candidate. After #372 merged, `python-v0.9.0` tagged that exact
merge commit. [Publish Python run 38175942746](https://github.com/lushly-dev/afd/actions/runs/38175942746)
succeeded on the #372 merge commit above, including the supported-interpreter
tests, isolated wheel checks, build and PyPI upload.

Local 0.9.0 validation passed 2,537 tests on each of Python 3.10, 3.11 and 3.12,
all 12 isolated wheel installations (base/client/server/CLI), and the base import
consumer reproduction on each interpreter. The wheel's runtime payload differs
from the previously tested stabilization wheel only in its version string.

Post-publication verification downloaded the actual [PyPI 0.9.0 wheel](https://pypi.org/project/afd/0.9.0/)
and checked its SHA-256:
`fe7ba61cc856488cafa9750f389118383010893e7910e3b0d81c25e6cd965ed6`.
All 12 fresh installations passed: Python 3.10, 3.11 and 3.12, each with base,
client, server and CLI. Checks included the original base-import reproduction,
DirectClient execution, absent optional dependencies in base, transport imports,
actual server tool registration/execution and installed CLI help. A separate
unpinned, uncached install selected 0.9.0 and passed the base smoke. #347 was
closed only after these registry consumer checks passed.
