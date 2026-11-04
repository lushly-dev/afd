# Botcore publisher handoff: `lushly-botcore`

The Phase 5 publisher handoff for one distribution, under the rule in [spec.md](./spec.md): freeze, drain and reconcile, disable the old route, enable the new one, verify, and never two publishers at once. The fields are the ones `scripts/release/handoff.mjs` requires of a handoff record. The other five Botcore distributions (`botcore-connectors`, `botcore-llm`, `botcore-agents`, `botcore-memory`, `botcore-teams`) are not part of this handoff: none has been published, and they stay quarantined with no route.

Recorded 2026-11-04. State: **in progress**. The AFD side is prepared; the owner steps below have not started.

## Record

| Field | Value |
| --- | --- |
| Unit | `botcore` in `scripts/release/inventory.json` |
| Registry identity | PyPI project [`lushly-botcore`](https://pypi.org/project/lushly-botcore/); artifacts `lushly_botcore-X.Y.Z-py3-none-any.whl` and `lushly_botcore-X.Y.Z.tar.gz`; metadata `Name: lushly-botcore`; import package `botcore` |
| Old authority | `github: lushly-dev/botcore` |
| New authority | `github: lushly-dev/afd` |
| Old route | `lushly-dev/botcore` `.github/workflows/publish.yml`: a `v*` tag runs `python -m build` and `twine upload` with the repository secret `PYPI_API_TOKEN` (a PyPI API token, not trusted publishing) |
| New route | `pypi-botcore`: a `botcore-vX.Y.Z` tag or a GitHub Release on it runs AFD's `.github/workflows/publish-botcore.yml`, which checks admission with `scripts/release-native.py --unit botcore --route pypi-botcore`, runs `botcore.yml`, builds, inspects into a receipt and publishes from the `pypi-botcore` environment with PyPI trusted publishing |
| Frozen revision | `7d5c54cae8aae90e145374467456af619cf54e41`, the import revision (#473). The source repository's only later commit, `cf2dada1` (#44), changes `AGENTS.md` and `README.md` only. Moved code has been frozen there since the owner's 2026-10-30 decision |
| Queued release work | None. The source repository has no release PR. Two open Dependabot PRs, #45 (`actions/checkout` 6 to 7) and #46 (`actions/setup-python` 6 to 7), touch the old publish workflow; they are closed unmerged in step 1 |
| In-flight release work | None: no queued or running workflow run in `lushly-dev/botcore` (read 2026-11-04). Its last publish run, for `v0.5.0`, completed successfully on 2026-07-29 |
| Registry outcome so far | `none` for the candidate. PyPI serves 0.1.0 to 0.5.0, all from the old route; 0.6.0 is absent. The five other distribution names return 404 |
| Artifact hashes | Last old-route release, 0.5.0 (tag `v0.5.0` at `75bf72ac`): `lushly_botcore-0.5.0-py3-none-any.whl` `38ce6ef7942826d3277481030d77a9f4ca516a99f8adbc41cbbd7ac085d4b4ed`, `lushly_botcore-0.5.0.tar.gz` `dafbd8631bc327da7f6d3039edce845e49f767c4ffa22608b08811fff24c2a56` (PyPI JSON). The 0.6.0 hashes are the ones in the `native-botcore-receipt` of the release run; a local build of this branch is trace evidence only, since the release commit differs |
| Approval | The owner asked for the cutover on 2026-11-04. Publishing 0.6.0 is approved by the owner pushing the `botcore-v0.6.0` tag; an agent does not push it |

## What this change does

- Admits `botcore` in the inventory: `state: admitted`, `authority: github: lushly-dev/afd`, route `pypi-botcore`. `sourceRevision` stays the frozen import revision.
- Adds the `botcore` track to `scripts/release-native.py`, with the normalized artifact stem `lushly_botcore`.
- Adds `publish-botcore.yml` and makes `botcore.yml` reusable (`workflow_call`).
- Updates Botcore's provenance envelope: `publisher_authority` and `publication_state` describe the handoff.

- Ports lushly-dev/botcore's 17 unreleased changesets (changes made there after 0.5.0, all inside the imported code) into the Unreleased section of `endpoints/botcore/CHANGELOG.md`. They include two breaking changes (`research_query` moved to OpenAI, and `default_model` lost its default). The source's open issues were already transferred to AFD.
- Points the project URLs in `endpoints/botcore/pyproject.toml` at AFD, so 0.6.0's metadata doesn't name the archived repository.

**Ordering.** `handoff.mjs` admits the unit at `enable-new`, after `disable-old`. Here the inventory admission merges first, with the old repository's publish workflow already removed (step 1's first part), because admission alone grants nothing: PyPI accepts an upload from `publish-botcore.yml` only once step 3 adds its trusted publisher. A `botcore-v*` tag pushed before then fails at the token exchange, publishes nothing, and the unit goes to `held` (below). The old route's credential is still live until step 1 finishes, so steps 2 and 3 must not start before it.

## Owner steps, in order

1. **Disable the old route.**
   - In `lushly-dev/botcore`: remove `.github/workflows/publish.yml` and close #45 and #46 unmerged. Done in [lushly-dev/botcore#47](https://github.com/lushly-dev/botcore/pull/47) (#45 and #46 closed 2026-11-04).
   - Delete the `PYPI_API_TOKEN` secret.
   - On PyPI, check the scope of the API token behind it (account settings, API tokens). If it is account-wide, find any other repository that uses it before revoking it. Then revoke it, and confirm that no remaining API token can upload `lushly-botcore`.
   - Delete any trusted publisher registered for `lushly-dev/botcore` under the project's publishing settings.
2. **Protect the new route before enabling it.** PyPI matches a trusted publisher on repository, workflow file and environment, not on the git ref. So without protection, anyone who can push a branch could edit `publish-botcore.yml` there to upload without the guard. In `lushly-dev/afd` settings:
   - Create the `pypi-botcore` environment, with a deployment rule that allows only tags matching `botcore-v*` and the owner as a required reviewer.
   - Add a tag ruleset that lets only the owner create, update or delete `botcore-v*` tags.

   AFD's existing `pypi` and `crates-io` environments have the same gap; see the issue linked in STATUS.md.
3. **Add the PyPI trusted publisher for AFD.**
   - First re-read PyPI (0.6.0 still absent) and the old repository's workflow runs (none queued or running since step 1). `enable-new` requires that state, and `skip-existing` would otherwise hide a version the old route published.
   - Then, at <https://pypi.org/manage/project/lushly-botcore/settings/publishing/>, add: owner `lushly-dev`, repository `afd`, workflow `publish-botcore.yml`, environment `pypi-botcore`.
4. **Release 0.6.0 from AFD.** A release PR dates the `0.6.0` section of `endpoints/botcore/CHANGELOG.md` and re-hashes its provenance rows (see the `do-release` skill's Botcore track). After it merges and `botcore.yml` passes, the owner tags the merge commit `botcore-v0.6.0` (annotated) and pushes it. An agent does not push the tag.
5. **Read back the registry and check an isolated install** (the evidence below).
6. **Archive `lushly-dev/botcore`** once the evidence is recorded here.

## Verification evidence still to come

- Old route disabled: the commit removing `publish.yml`; #45 and #46 closed; `PYPI_API_TOKEN` absent from the repository's secrets; the token's scope checked and the token revoked on PyPI; no remaining token or `lushly-dev/botcore` trusted publisher that can upload the project.
- New route protected: the `pypi-botcore` environment's deployment rule (`botcore-v*` tags only) and required reviewer, and the `botcore-v*` tag ruleset.
- New route enabled: the PyPI publishing settings list exactly one publisher, `lushly-dev/afd` `publish-botcore.yml` environment `pypi-botcore`.
- Release run: the `publish-botcore.yml` run for `botcore-v0.6.0`, with its version, test, build and publish jobs, and the receipt's wheel and sdist SHA-256.
- Registry readback: <https://pypi.org/pypi/lushly-botcore/0.6.0/json> lists `lushly_botcore-0.6.0-py3-none-any.whl` and `lushly_botcore-0.6.0.tar.gz` with the receipt's SHA-256, and each file's provenance names `lushly-dev/afd` and `publish-botcore.yml` as its trusted publisher.
- Isolated install: `pip install lushly-botcore==0.6.0` into fresh Python 3.11 and 3.12 environments outside the workspace; `import botcore` reports `__version__ == "0.6.0"` and `botcore --help` runs.
- Archive: `lushly-dev/botcore` shows as archived.

Until these are recorded, Phase 5 for `lushly-botcore` stays in progress in [STATUS.md](./STATUS.md).

## Failure and restoration

- **AFD's route fails** (token exchange, upload or an uncertain result): read PyPI before anything else. A job that failed after the build can be retried with "Re-run failed jobs" in the same run within the 7-day artifact retention, which reuses the same artifacts and receipt. When both the tag push and the Release ran, compare PyPI with the receipt of the run that actually uploaded. To stop uploads at once, delete AFD's trusted publisher on PyPI: a re-run for an existing tag reads that tag's inventory, so only later tags see an inventory change. Then set the unit to `held` in AFD's inventory (or list the version in `heldVersions`), which the guard rejects. A version PyPI serves is published: fix forward from AFD with a new version, never a re-upload of the same one.
- **Restoring the old publisher** is safe only when the unit is held, nothing is queued or in flight, PyPI serves no version from AFD and no upload is uncertain, and the old repository's workflow is known to build the same distribution. Then:
  1. Delete AFD's trusted publisher on PyPI.
  2. In the inventory, set `botcore` back to `state: quarantined` and `authority: github: lushly-dev/botcore`, and restore the provenance envelope's earlier `publisher_authority` and `publication_state` in `endpoints/botcore/scripts/verify_provenance.py`, then re-seal both provenance copies.
  3. Unarchive `lushly-dev/botcore` if needed, restore `publish.yml` from `7d5c54ca`, and give it a new credential: a trusted publisher for that repository, not the revoked token.
  4. Record the restoration here and in STATUS.md.
- Once AFD has published a version, restoration is closed: the old repository lacks AFD's changes, so authority stays with AFD.
