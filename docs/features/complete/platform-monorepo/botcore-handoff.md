# Botcore publisher handoff: `lushly-botcore`

The Phase 5 publisher handoff for one distribution, under the rule in [spec.md](./spec.md): freeze, drain and reconcile, disable the old route, enable the new one, verify, and never two publishers at once. The fields are the ones `scripts/release/handoff.mjs` requires of a handoff record. The other five Botcore distributions (`botcore-connectors`, `botcore-llm`, `botcore-agents`, `botcore-memory`, `botcore-teams`) are not part of this handoff: none has been published, and they stay quarantined with no route.

Recorded 2026-11-04; cutover and release verified 2026-11-07. State: **release verified; archive pending**. The old upload route is disabled, AFD is the sole trusted publisher for `lushly-botcore`, and PyPI serves 0.6.0 from AFD.

## Record

| Field | Value |
| --- | --- |
| Unit | `botcore` in `scripts/release/inventory.json` |
| Registry identity | PyPI project [`lushly-botcore`](https://pypi.org/project/lushly-botcore/); artifacts `lushly_botcore-X.Y.Z-py3-none-any.whl` and `lushly_botcore-X.Y.Z.tar.gz`; metadata `Name: lushly-botcore`; import package `botcore` |
| Old authority | `github: lushly-dev/botcore` |
| New authority | `github: lushly-dev/afd` |
| Old route | `lushly-dev/botcore` `.github/workflows/publish.yml`: a `v*` tag runs `python -m build` and `twine upload` with the repository secret `PYPI_API_TOKEN` (a PyPI API token, not trusted publishing) |
| New route | `pypi-botcore`: a `botcore-vX.Y.Z` tag or a GitHub Release on it runs AFD's `.github/workflows/publish-botcore.yml`, which checks admission with `scripts/release-native.py --unit botcore --route pypi-botcore`, runs `botcore.yml`, builds, inspects into a receipt and publishes from the `pypi-botcore` environment with PyPI trusted publishing |
| Frozen revision | `7d5c54cae8aae90e145374467456af619cf54e41`, the import revision (#473). The source repository's later commits change only `AGENTS.md` and `README.md`, or remove its publish workflow: `cf2dada1` (#44), `ee12751a` (#47) and `85e18ed5` (#48). Moved code has been frozen there since the owner's 2026-10-30 decision |
| Queued release work | None. The source repository has no release PR. Dependabot PRs #45 (`actions/checkout` 6 to 7) and #46 (`actions/setup-python` 6 to 7), which touched the old publish workflow, were closed unmerged |
| In-flight release work | None: no queued, in-progress, waiting, pending or requested workflow run in `lushly-dev/botcore` (rechecked 2026-11-07). Its last publish run, for `v0.5.0`, completed successfully on 2026-07-29 |
| Registry outcome | PyPI served 0.1.0 to 0.5.0 before AFD's publisher was added. It now serves 0.6.0 from AFD, with the two files and hashes recorded below. The five other distribution names returned 404 at the earlier inventory check |
| Artifact hashes | Last old-route release, 0.5.0 (tag `v0.5.0` at `75bf72ac`): `lushly_botcore-0.5.0-py3-none-any.whl` `38ce6ef7942826d3277481030d77a9f4ca516a99f8adbc41cbbd7ac085d4b4ed`, `lushly_botcore-0.5.0.tar.gz` `dafbd8631bc327da7f6d3039edce845e49f767c4ffa22608b08811fff24c2a56` (PyPI JSON). First AFD release, 0.6.0: wheel `98761a49ce131a12b1023a37810050c1c7063341189f2820cb2bd471f1913804`, sdist `38eddb7533e566ada021edb3982682dfd3f16ab683964ded1bf5cf89962be12d` (run receipt and PyPI JSON) |
| Approval | The owner approved the cutover and explicitly asked the agent to push `botcore-v0.6.0` on 2026-11-07. The `pypi-botcore` deployment was reviewed and approved as `Falkicon` before upload |

## What this change does

- Admits `botcore` in the inventory: `state: admitted`, `authority: github: lushly-dev/afd`, route `pypi-botcore`. `sourceRevision` stays the frozen import revision.
- Adds the `botcore` track to `scripts/release-native.py`, with the normalized artifact stem `lushly_botcore`.
- Adds `publish-botcore.yml` and makes `botcore.yml` reusable (`workflow_call`).
- Updates Botcore's provenance envelope: `publisher_authority` and `publication_state` describe the handoff.

- Ports lushly-dev/botcore's 17 unreleased changesets (changes made there after 0.5.0, all inside the imported code) into the Unreleased section of `endpoints/botcore/CHANGELOG.md`. They include two breaking changes (`research_query` moved to OpenAI, and `default_model` lost its default). The source's open issues were already transferred to AFD.
- Points the project URLs in `endpoints/botcore/pyproject.toml` at AFD, so 0.6.0's metadata doesn't name the archived repository.

**Ordering.** `handoff.mjs` admits the unit at `enable-new`, after `disable-old`. Here the inventory admission merged first, with the old repository's publish workflow already removed, because admission alone granted nothing. The old API token and the unexpected `lushly-dev/libraries` publisher were removed before AFD's publisher was added. No `botcore-v*` tag was pushed during the handoff.

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
4. **Release 0.6.0 from AFD.** [PR #786](https://github.com/lushly-dev/afd/pull/786) dated the `0.6.0` section of `endpoints/botcore/CHANGELOG.md` and re-hashed its provenance rows. Its checks and post-merge `botcore.yml` passed. The owner then explicitly asked the agent to push annotated tag `botcore-v0.6.0` on merge commit `88f58272bcca535efb86b43259df52cdf2247dff`.
5. **Read back the registry and check an isolated install** (the evidence below).
6. **Mark the old repository deprecated.** Its README and AGENTS.md say it is deprecated and frozen, point people and agents at `endpoints/botcore` in AFD, and drop the instructions for working there. Done early, in [lushly-dev/botcore#48](https://github.com/lushly-dev/botcore/pull/48): the notice says only that 0.5.0 was the last release from there, so it holds before and after 0.6.0.
7. **Archive `lushly-dev/botcore`** once the evidence is recorded here.

## Cutover verification (2026-11-07)

- Old route: [`lushly-dev/botcore#47`](https://github.com/lushly-dev/botcore/pull/47) removed `publish.yml`; the repository has no Actions secrets and no queued, in-progress, waiting, pending or requested runs. PyPI account `falkicon` had one API token named `lushly-dev`, scoped to all projects, created 2026-01-13 and last used 2026-07-28. No other GitHub Actions PyPI secret or active workflow consumer was found in the inspected organization repositories; the organization Actions secrets page listed none. The owner revoked that token; the signed-in account page then listed zero API tokens. `falkicon` was the project's only collaborator.
- Old publisher: PyPI listed no `lushly-dev/botcore` publisher, but did list `lushly-dev/libraries` / `publish-py.yml` with any environment. That workflow builds `libbot` (which depends on `lushly-botcore`). With the owner's approval, the `libraries` publisher was removed; PyPI then listed no trusted publishers for this project.
- New route: AFD's `pypi-botcore` environment requires owner `Falkicon` review and allows only `botcore-v*` tags. Active tag ruleset `26766436` governs creation, update and deletion of those tags. After confirming 0.6.0 absent and no old run in flight, the owner approved adding the PyPI publisher. PyPI confirmed exactly one publisher: `lushly-dev/afd`, `publish-botcore.yml`, environment `pypi-botcore`.

## Release verification (2026-11-07)

- Release: [Publish Botcore Package run 42406695548](https://github.com/lushly-dev/afd/actions/runs/42406695548) succeeded on annotated `botcore-v0.6.0` (tag object `883b8ae78dc8cbd9676f03b5b386e352969cb393`, peeled source `88f58272bcca535efb86b43259df52cdf2247dff`). Version validation, Python 3.11 and 3.12 Botcore suites, build/inspection, and PyPI upload all passed. GitHub records `Falkicon` approving the `pypi-botcore` deployment. The run's `native-botcore-receipt` names version 0.6.0 and exactly two artifacts; the downloaded run artifacts matched its hashes.
- Registry readback: [PyPI's 0.6.0 JSON](https://pypi.org/pypi/lushly-botcore/0.6.0/json) lists `lushly_botcore-0.6.0-py3-none-any.whl` at SHA-256 `98761a49ce131a12b1023a37810050c1c7063341189f2820cb2bd471f1913804` and `lushly_botcore-0.6.0.tar.gz` at SHA-256 `38eddb7533e566ada021edb3982682dfd3f16ab683964ded1bf5cf89962be12d`, exactly matching the receipt. PyPI's Integrity API for the [wheel](https://pypi.org/integrity/lushly-botcore/0.6.0/lushly_botcore-0.6.0-py3-none-any.whl/provenance) and [sdist](https://pypi.org/integrity/lushly-botcore/0.6.0/lushly_botcore-0.6.0.tar.gz/provenance) each returns one GitHub publisher: repository `lushly-dev/afd`, workflow `publish-botcore.yml`, environment `pypi-botcore`.
- Isolated install: fresh virtual environments outside the workspace used Python 3.11.16 and 3.12.14. `uv --no-cache pip install --index-url https://pypi.org/simple 'lushly-botcore==0.6.0'` succeeded in both. `botcore.__version__` and installed distribution metadata each reported `0.6.0`, and `botcore --help` exited successfully in both.
- Deprecation notice: [lushly-dev/botcore#48](https://github.com/lushly-dev/botcore/pull/48), merged as `85e18ed5` on 2026-11-04.

## Remaining owner step

- Archive `lushly-dev/botcore`. GitHub reported `archived: false` after release verification. Keep this step with the owner, as agreed.

Until the archive is confirmed, Phase 5 for `lushly-botcore` stays in progress in [STATUS.md](./STATUS.md).

## Failure and restoration

- **AFD's route fails** (token exchange, upload or an uncertain result): read PyPI before anything else. A job that failed after the build can be retried with "Re-run failed jobs" in the same run within the 7-day artifact retention, which reuses the same artifacts and receipt. When both the tag push and the Release ran, compare PyPI with the receipt of the run that actually uploaded. To stop uploads at once, delete AFD's trusted publisher on PyPI: a re-run for an existing tag reads that tag's inventory, so only later tags see an inventory change. Then set the unit to `held` in AFD's inventory (or list the version in `heldVersions`), which the guard rejects. A version PyPI serves is published: fix forward from AFD with a new version, never a re-upload of the same one.
- **Restoring the old publisher** is safe only when the unit is held, nothing is queued or in flight, PyPI serves no version from AFD and no upload is uncertain, and the old repository's workflow is known to build the same distribution. Then:
  1. Delete AFD's trusted publisher on PyPI.
  2. In the inventory, set `botcore` back to `state: quarantined` and `authority: github: lushly-dev/botcore`, and restore the provenance envelope's earlier `publisher_authority` and `publication_state` in `endpoints/botcore/scripts/verify_provenance.py`, then re-seal both provenance copies.
  3. Unarchive `lushly-dev/botcore` if needed, revert its deprecation notice (#48), restore `publish.yml` from `7d5c54ca`, and give it a new credential: a trusted publisher for that repository, not the revoked token.
  4. Record the restoration here and in STATUS.md.
- Once AFD has published a version, restoration is closed: the old repository lacks AFD's changes, so authority stays with AFD.
