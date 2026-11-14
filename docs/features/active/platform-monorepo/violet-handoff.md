# Violet publisher handoff: `violet-npm` and `violet-elements`

The Phase 5 publisher handoff for the six Violet npm packages, under the rule in [spec.md](./spec.md): freeze, drain and reconcile, disable the old route, enable the new one, verify, and never two publishers at once. The fields are the ones `scripts/release/handoff.mjs` requires of a handoff record, as in the [Botcore record](./botcore-handoff.md). Tracked in [lushly-dev/afd#1192](https://github.com/lushly-dev/afd/issues/1192), for Lushly's Violet token tree ([lushly-dev/lushly#2356](https://github.com/lushly-dev/lushly/issues/2356)).

Recorded 2026-11-14. State: **admitted in the inventory; owner steps pending**. Nothing has been published, and no npm name exists yet.

## Record

| Field | `violet-npm` | `violet-elements` |
| --- | --- | --- |
| Unit | `violet-npm` in `scripts/release/inventory.json`, fixed | `violet-elements` in `scripts/release/inventory.json` |
| Registry identity | npm `@lushly-dev/violet-core`, `@lushly-dev/violet-runtime`, `@lushly-dev/violet-afd`, `@lushly-dev/violet-cli` (`violet` binary), `@lushly-dev/violet-server` (`violet-mcp` binary) | npm `@lushly-dev/violet-elements` |
| Old authority | `github: lushly-dev/violet` (private repository) | `github: lushly-dev/fast-af` (private repository); its manifest was `private: true` there |
| New authority | `github: lushly-dev/afd` | `github: lushly-dev/afd` |
| Old route | `lushly-dev/violet` `.github/workflows/release.yml`: on a push to `main`, Changesets opens `chore: release packages`, and merging it runs `pnpm publish:npm` with `NODE_AUTH_TOKEN: secrets.NPM_TOKEN` (an npm token, not trusted publishing) | None: the repository has no publish workflow, tags or releases, and the package could not publish |
| New route | `npm-prerelease` under the npm tag `preview`: AFD's `release.yml` publishes the reviewed version PR's intent through npm trusted publishing, with provenance | The same |
| Frozen revision | `59b4bfa64a8cf423322b857c5c697e110201e0f2`, the import revision. Violet `main` is at `c4e86635` (#141, 2026-10-31), which changes only its README, `AGENTS.md`, `INIT.md` and plan index. Moved code has been frozen there since the owner's 2026-10-30 decision | `5e64a6a5e7d459643fa62d0fe8ea22146afc4db1`, the reconciled import revision |
| Queued release work | Violet [#135](https://github.com/lushly-dev/violet/pull/135) `chore: release packages` is open and mergeable (read 2026-11-14): merging it would publish 0.3.0 from the old route. The owner decided on 2026-10-30 not to merge it, and its changesets are the carried-over fragments here. Dependabot PRs #142 to #147 change no publish step but #142, which bumps `changesets/action` in `release.yml` | None |
| In-flight release work | None: no queued or in-progress run in `lushly-dev/violet` (read 2026-11-14). Its last `Release` run, on `c4e86635`, succeeded on 2026-10-31 and only refreshed #135 | None |
| Registry outcome | none: npm answers 404 for all five names (read 2026-11-14) | none: npm answers 404 (read 2026-11-14) |
| Artifact hashes | None published on either route. The first AFD artifacts are the release plan's, recorded in its receipt when it publishes | The same |
| Approval | The owner approved publishing `fast-element`, `violet-elements` and the Violet packages as prereleases on 2026-11-14, so Lushly can depend on them instead of vendored tarballs | The same |

`lushly-dev/violet` lists no repository secret, so its `NPM_TOKEN` is either an organization secret or unset; reading organization secrets needs an organization administrator.

## What this change does

- Admits both units in the inventory: `state: admitted`, `authority: github: lushly-dev/afd`, route `npm-prerelease`, `distTag: preview`. `sourceRevision` stays each frozen import revision.
- Seeds the manifests for the preview: the five Violet packages at `0.3.0-preview` and `violet-elements` at `0.2.0-preview`, which the inventory's `initialVersion` matches. With the pending fragments, `pnpm version-packages` versions them to `0.3.0-preview.0` and `0.2.0-preview.0`.
- Makes `violet-elements` public, names AFD as its repository (npm's provenance check compares it with the publishing workflow), and peers on `@lushly-dev/fast-element` `workspace:^`, which packs as `^<the fast-element version it was built against>` instead of an exact pin.
- Peers `violet-afd` on `@lushly-dev/violet-core` `workspace:^` (it was `^0.2.0 || ^0.3.0`, which no `0.3.0-preview.N` satisfies), and makes its development dependency on the core `workspace:^`, which Changesets leaves alone, so a version PR does not stale the lockfile.
- Updates both provenance envelopes' `publisher_authority` and `publication_state` and records each edited imported file.
- Makes a prerelease plan refuse to run while any of its names lacks `latest`, or has `latest` on a prerelease other than the `0.0.0` placeholder ([platform release controls](../../../operations/platform-releases.md#npm-workflow)).

**Ordering.** `handoff.mjs` admits the unit at `enable-new`, after `disable-old`. Here admission merges first, as for Botcore: it grants nothing, because npm has none of the six names and a plan refuses a name npm does not have. The old route must be disabled before the names exist, since an existing name is what would let either route upload.

## Owner steps, in order

1. **Disable the old route.**
   - Close [lushly-dev/violet#135](https://github.com/lushly-dev/violet/pull/135) unmerged, and #142 with it.
   - Remove `.github/workflows/release.yml` from `lushly-dev/violet` (or at least `gh workflow disable release.yml --repo lushly-dev/violet`), and record in its README and `AGENTS.md` that AFD publishes the packages.
   - Find the `NPM_TOKEN` the workflow names, at the organization level if not in the repository, and revoke the npm token behind it unless something else uses it.
   - Re-read npm (still 404 for the six names) and Violet's runs (none queued or in progress).
2. **Create the six names, with `latest` on a placeholder.** For each of `violet-core`, `violet-runtime`, `violet-afd`, `violet-cli`, `violet-server` and `violet-elements`, as for Specimen on 2026-11-07: publish a public, deprecated `0.0.0-bootstrap.0` from an empty package (`npm publish --access public --tag bootstrap`, then `npm deprecate @lushly-dev/<name>@0.0.0-bootstrap.0 "<message>"`). npm puts `latest` on a new name's first version, so it holds `bootstrap` and `latest`; check with `npm view @lushly-dev/<name> dist-tags`.
3. **Add each name's trusted publisher:** GitHub Actions, `lushly-dev/afd`, workflow `release.yml`, no environment, dist-tag management off.
4. **Move `latest` back to the placeholder** on the nine names published earlier (the [one-time retag](../../../operations/platform-releases.md#npm-workflow)); until then a prerelease plan refuses them.
5. **Merge this change, then review and merge the version PR** `chore: release packages` that `release.yml` opens. Close and reopen it if it starts no checks.
6. **Verify:** each version at `https://registry.npmjs.org/<name>`, `preview` on the new versions and `latest` still `0.0.0-bootstrap.0`, the tags and GitHub prereleases, and a clean install of `@lushly-dev/violet-elements@preview` with `@lushly-dev/fast-element@preview` and of `@lushly-dev/violet-core@preview`.

## Failure and restoration

- **AFD's route fails:** read npm before anything else, then follow "Holds and recovery" in [platform release controls](../../../operations/platform-releases.md). To stop uploads at once, delete AFD's trusted publisher on the affected names, then set the unit to `held` (or list the version in `heldVersions`). A version npm serves is published: fix forward with a new version.
- **Restoring the old publisher** is safe only while npm serves no version from AFD and nothing is queued, in flight or uncertain: delete AFD's trusted publishers, set `violet-npm` back to `state: quarantined`, `routes: ["npm-main"]` with no `distTag`, restore the Violet provenance envelope's earlier `publisher_authority` and `publication_state`, restore Violet's `release.yml` with a new credential, and record it here and in [STATUS.md](./STATUS.md). `violet-elements` has no old route to restore: it returns to `private: true`, quarantined.
- Once AFD has published a version, restoration is closed: the old repositories lack AFD's changes, so authority stays with AFD.
