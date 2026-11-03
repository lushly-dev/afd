# Phase 2 specification: scope and projects

| Field | Value |
| --- | --- |
| Phase | 2, scope, projects and documents ([architecture section 9](../../architecture.md#9-phases)). This is the first of the phase's two specifications (D35); the [documents specification](../2-documents/spec.md) is the second. One phase, one owner, one plan, here in [section 16](#16-implementation-plan) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review; the phase 2 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 1 specification](../1-app-contract/spec.md) with its 9.5 to 9.9, the [architecture](../../architecture.md), the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-02 and revised the same day after two independent reviews (see
  [Review](#review-2026-11-02)). Approved 2026-11-02 by the coordinator under the owner's delegation, with the condition that the step building 3.6's surface port gets a review focused on that boundary. Nothing is implemented; each step's state is one line in STATUS.md's phase 2 block.
- **Last verified:** 2026-11-02 against `main` at `980cc1aa`. Evidence read in the repository:
  - **Kernel:** `endpoints/loam/packages/kernel/src`:
    - `kernel.ts:231-234` (one journal middleware), `:240-258` (`setAppCommands` rebuilds both registries),
      `:265-319` (`run`), `:321-366` (the boot: `loadApps` is awaited before `setAppCommands` and `hydrate`);
    - `types.ts:176-187` (`KernelOptionsV1`), `:243-253` (`APP_CALLABLE_SHELL_COMMANDS_V1`), `:306-313` (`ShellInfoV1`);
    - `context-fields.ts:11-18` (the five declared fields);
    - `apps-runtime.ts:90-123` (`EMPTY_APPS`), `:139-193` (`unavailableApps`, which already lists an app from its projection entry alone);
    - `shell-state.ts:61-83` (one handler per layout id; a second `register` throws), `:116-119`, `:143-152`;
    - `layout.ts:36-48` (`appLayoutId`, `isLayoutId`);
    - `apps/index.ts:58-89` (every package's manifest is fetched first), `:333-339`;
    - `apps/entry.ts:199-209` (`firstLayout`);
    - `apps/store.ts:11-21`, `:41-60` (`scope: null`, `id = key`, table `app-<instance>`);
    - `apps/mounted.ts:247-272` (`pinMountedInput`), `:616` (its call site passes `null`);
    - `apps/definitions.ts:14` (`fromJSONSchema` from classic Zod);
    - `commands.ts:50-56` (`SHELL_EXPOSE`, no MCP or CLI until phase 6).
  - **Chrome:** `endpoints/loam/packages/chrome/src`:
    - `router.ts:7`, `:22-33`, `:55-81` (two routes, relative to `document.baseURI`);
    - `elements/shell.ts:336`, `:383-447` (the boot; `:439` loads the app surfaces before the first frame);
    - `elements/app-nav.ts:15-35` (`loam-rail`, a slot and the settings entry, its tooltip inline);
    - `elements/main.ts:12-35`; `elements/statusbar.ts`;
    - `apps/surfaces.ts:123`, `:209` (`prepare`), `:498` (`#enter`), `:937`;
    - `define.ts`.
  - **Web host:** `endpoints/loam/packages/web`:
    - `index.html:5-8` (`base-uri 'none'`), `:12`; `vite.config.ts` (`base: './'`);
    - `src/main.ts:40-53`; `src/host.ts:36-42` (`isEmptyProjection`); `src/ports.ts:39`; `src/deployment.ts:14-30`; `src/mount.ts:140-146`;
    - `scripts/budget.mjs:28-39` (`CEILINGS`);
    - `test/browser/harness.ts:39-80` (`serveDirectory`, no fallback), `:505-518` (`requestedBeforeFirstPaint`);
    - `test/browser/apps/second-app.test.ts:85-135`.
  - **Manifest:** `endpoints/loam/packages/manifest`: `schemas/app-manifest.v1.json:9`, `:209-216` (`app.scope_levels`);
    `schemas/projection.v1.json`; `src/catalogs.ts` (the surfaces and grants served from phase 2, `SHELL_DOMAINS_V1`);
    `src/refusal-map.ts:103-105`.
  - **AFD:** `spec/context-fields.md` (its own example is `dev.loam/scope`); `packages/server/src/schema.ts:19`, `:289`, `:424-425`;
    `execution.ts:153`; `validation.ts:5`, `:136-150`, `:173-198`; `journal-replay.ts:291-305` (context fields restored on replay);
    `packages/view-state/src/registry.ts:150-168` (`hydrate` reads a whole category); `packages/client/src/streamable-http-transport.ts:158-175`
    (`send` hands `params` to the SDK); `packages/local-db/src/adapter-support.ts:98-118` (`queryRows`, equality on any field),
    `indexeddb-adapter.ts:45-47`, `:219` (one object store, keyed `[table, id]`, so a table costs no upgrade);
    `packages/auth/src/middleware.ts:60-76` (the actor is set before the journal).
  - **Repository:** `.github/workflows/loam.yml`, `scripts/affected/suites.mjs:81-105`,
    `scripts/repository-contract.test.mjs:227-262`, `:315-330` (a workflow reads the one output its gate writes).
  - **Measured 2026-11-02 at `980cc1aa`,** with a build of `main` and throwaway scripts, none committed. See [section 2.1](#21-what-was-measured).
  - **Outside the repository:** see [Trajectory refresh](#trajectory-refresh).
- **Done:** this specification and the [documents specification](../2-documents/spec.md).
- **Not done:** every step of the [implementation plan](#16-implementation-plan).
- **Depends on:** phase 1's exit (2026-11-02). AFD's declared context fields (#528, #569) and the browser-safe registry (#527, #576) are merged. Two AFD
  changes are steps of this plan: [0a](#16-implementation-plan) and [0b](#16-implementation-plan).
- **Follow-ups:** see [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 1, empty shell; 3, everything is a command; 4, opt-in surfaces; 5, scope is shell-level; 9, layout is data; 13, deterministic core; 14,
  every mutation is an event; 15, AFD first.
- **Decisions:** D4 and D31 for scope; D5 and D29 for the rail; D32 for a single tenant; D55 and D56 for instances; D63 for the workspace store; D65 for a pinned space; D66
  for failures; D67 for the catalog; D68 for the app port.
- **New decisions this specification and its sibling decide:** D69 to D83, listed in
  [Amendments](#amendments-to-the-architecture-and-the-decision-log) and added to the decision log by this pull request. The coordinator approves them by approving the
  specifications. None changes a trust model or D54 to D58.
- **Carried from phase 1, handled here:**

  | Item | Where |
  | --- | --- |
  | First paint with an app, [#701](https://github.com/lushly-dev/afd/issues/701) | [Section 2](#2-first-paint), steps 1 and 2 |
  | A lighter schema layer, [#658](https://github.com/lushly-dev/afd/issues/658) | [2.3](#23-the-lean-schema-layer-d70), steps 0a and 1 |
  | Zod's probe under the CSP, [#664](https://github.com/lushly-dev/afd/issues/664) | [2.3](#23-the-lean-schema-layer-d70): the same `jitless` start reaches Mini, because both read one core |
  | The rail does not scroll, and `unavailableApps` lets a switch past a shell modal, [#709](https://github.com/lushly-dev/afd/issues/709) | [7.5](#75-overflow-and-tooltips-709), step 6, and [2.2](#22-two-stages-d69) |
  | D55's membership on `projects`, a pinned space's call site | [Section 9](#9-mounted-instances), step 8 |
  | The sidebar's `tree`, header breadcrumbs, the status bar's left items | [7.4](#74-sidebar-header-and-status-bar) and [8.3](#83-new-keys), step 6; the tree's first user is the [documents section](../2-documents/spec.md#8-the-documents-section) |
  | Phase 0's A4 reference index budget | The [documents specification](../2-documents/spec.md#9-references) |
  | #706, #707, #708 | Not closed here. New elements add to #708's passes and #707's fixtures; each stays open, and E12 records what it could not judge |
  | #710, limits on a view's size, rate and storage | Not closed here. Documents widen what a view stores, so [section 13](#13-security) names the limit that matters; the issue stays open for phases 6 and 7 |
  | #711, D65's reach | Open with the owner. Phase 2 does not depend on the answer: every view it ships is first-party ([section 13](#13-security)) |
  | #712, #713 | #713 is phase 5's. #712's `violet-listbox` press bug is met by the tree and New: the [documents specification](../2-documents/spec.md#8-the-documents-section) says how |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-02:

| Row | Recorded | Now | Effect on phase 2 |
| --- | --- | --- | --- |
| W1 | MCP Apps 2026-01-26, draft open; `ext-apps` 2.0.4 | Unchanged: the specification's directory holds `2026-01-26` and `draft`, and npm's latest is 2.0.4 | An editor in a view is the same profile, with `dev.loam/` keys in `hostContext` and `dev.loam/` methods, which the profile leaves open. No change |
| W3 | Scoped registries in all three engines | MDN's compatibility data now lists the constructor at Chrome 146, Firefox 159, Safari 26 | D34's polyfill path stays; `loam.yml` stays Chromium (#706) |
| W6 | Navigation API precommit handler missing in Safari | Compatibility data lists `Navigation` and `NavigateEvent.intercept` at Chrome 102 and 105, Firefox 147, Safari 26.2, and has no precommit entry that this check could read | The router registers no precommit handler, as phase 0 does, so nothing changes. Without the API, a link is a full load, which works because of [section 6](#6-the-url-scheme-d74) |
| R5 | Routing on the Navigation API and URLPattern | Five fixed shapes need no pattern language: split on `/` is smaller and first paint has no room for more | R5 keeps the Navigation API; [section 6](#6-the-url-scheme-d74) leaves out URLPattern, and phase 0's fallback branch goes with it |
| R8 | A personal, reorderable rail, persisted as view-state, phase 2 | Not needed for the exit criterion, and a band's rule is hard enough to read without it | R8 moves to phase 4, with personal settings. `workspace-app-set`'s `order` is the workspace's. [7.3](#73-entries-and-bands) keeps ordering in one function, the seam |
| R10 | Workspaces bound to provider organizations, a reserved tenant field | Phase 3 binds; D32 holds | `WorkspaceV1` reserves `organization` and `tenant` as `null` |
| W28 | CRDT choice before the collaboration specification | Not re-checked; nothing in phase 2 selects one | A `crdt` binding is refused until then ([documents specification](../2-documents/spec.md#31-the-binding-d46)) |
| New | Zod's version | npm's latest is 4.6.7, the workspace's | The measurements of [2.1](#21-what-was-measured) are of that version |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary). This specification adds:

| Term | Meaning |
| --- | --- |
| Active scope | The person's current scope in the shell: the view-state record `loam.scope`, and what the URL shows. An input to each in-process call, never connection state |
| Requested scope | What a call carries on its context, from the caller or the active scope |
| Effective scope | What a handler sees: the requested scope, narrowed to the owning app's levels ([3.4](#34-the-order-of-a-call-d72)) |
| Access decision | `decideAccess`, in the kernel: whether the actor may enter a scope, before anything else about the call |
| Stage A, stage B | The two stages of a boot ([2.2](#22-two-stages-d69)): what runs before the first frame, and what runs after it |
| Boot record | The display fields of one app, in the projection, that `loam deployment write` copied from its manifest |
| Late commands | Shell commands that load in stage B, so they add nothing to first paint |
| Generation | The digest of a projection's entries, which says whether the workspace store has them yet |
| Section | The architecture's word; the two this phase adds are `projects` and `documents` |

## 1. Units and repository placement

No new package. Three new apps, private and quarantined:

| Directory | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| `endpoints/loam/apps/tasks/` | `@lushly-dev/loam-app-tasks` | A native app with `scope_levels = ["project"]`: the phase's project-scoped app, with `app.resource_keys` and a `project_summary` | `@lushly-dev/loam-sdk`, `@lushly-dev/fast-element`; dev: `@lushly-dev/loam-cli`, `@lushly-dev/loam-testing`, `vite` |
| `endpoints/loam/apps/notes/` | `@lushly-dev/loam-app-notes` | The reference document type ([documents specification](../2-documents/spec.md#10-the-notes-type)) | The same |
| `endpoints/loam/apps/checklist/` | `@lushly-dev/loam-app-checklist` | The second document type, a view, which lands with no shell change | The same |

The exit criterion's other two apps exist: tally is the workspace-only app, since it declares no `scope_levels`, and hello is the dual-scope app, since it declares both
(`apps/hello/manifests/native.toml:18`).

**`tasks`,** `manifest_version = 2`, with the `store` grant: `tasks-add { title }`, `tasks-add-blank {}`, `tasks-list {}`, `tasks-rename { task, title }`, `tasks-complete { task }`, `tasks-summary {}`. `resource_keys` names `task` for the rename and the complete. Its surfaces are a rail entry, a `list` sidebar and main, under `list-detail`, with `ui.project_summary` and one `ui.new` entry. It exists to be project-only, and **no file in `kernel`, `chrome` or `web/src` names it**, which step 6's unit test holds, as phase 1's does for tally.

| Package | Change |
| --- | --- |
| `kernel` | Kernel interface version 2 ([11](#11-the-kernel-and-the-sdk)); `src/late/`, loaded in stage B; `src/scope/`, in first paint: the field, `decideAccess`, the middleware and the project cache; store scoping in `src/apps/store.ts` |
| `chrome` | `router.ts` rewritten; `src/rail/`, in first paint; `src/sections/` and `src/editor/`, lazy; `loam-project-switcher`, `loam-tree`, `loam-tooltip` |
| `web` | The two-stage boot, `base` from `import.meta.url`, a fallback in the harness, the `budget` rows |
| `manifest` | `app-manifest.v2.json`, `deployment.v2.json`, `projection.v2.json`; `readBoot` in its root; `readProjection` reads version 2 only; `readDeployment` reads 1 and 2 |
| `sdk` | `ScopeV1`, `ProjectsV1`, `DocumentsV1`, and additions to the contexts ([11.3](#113-the-sdk)) |
| `testing` | `createAppTestKernel` takes `scope` |
| `cli` | `deployment write` writes projection version 2, boot records and the generation, rewrites `index.html`'s URLs for `base_path`, and writes `404.html` |
| `console` | Nothing. It is given a client as before; a call carries the active scope with no change there |
| `theme` | Nothing. No token is added; the contract stays version 1 |

- **Workspace.** `endpoints/loam/apps/*` is already a glob.
- **Release inventory.** Three more entries in `scripts/release/inventory.json`, in phase 1's shape: ids `loam-app-tasks`, `loam-app-notes`, `loam-app-checklist`, each
  `state: "quarantined"`, `routes: []`, `fixed: false`, `private: true`, `gates: ["pnpm check", "loam.yml", "release-approval"]`. Nothing publishes.
- **Repository contract.** `scripts/repository-contract.test.mjs`'s Loam test names them, each in the step that creates it.
- **`loam.yml`.** Its path filters need nothing: `endpoints/loam/**` covers the apps, and steps 0a and 0b's packages are listed. `web` takes a dev dependency on each new app, as it does on
  hello and tally, so `pnpm -F "@lushly-dev/loam-web..." build` builds them and the `run` gate reaches them; the `--package` lists do not change. `lint:tokens` gains the three apps,
  in `loam.yml` and in `scripts/affected/suites.mjs` together. The new tests run in the jobs [section 15](#15-exit-criterion-and-tests) names. Editing `suites.mjs` selects the whole
  workspace, as phase 1's 9.9 found, so that step says so.
- **`AGENTS.md`.** The architecture tree gains the three apps, and the Loam key rule's `lint:tokens` line matches. Step 6 does it.
- **Changesets.** Steps 0a and 0b carry their own. None for the private units.

## 2. First paint

Settles [#701](https://github.com/lushly-dev/afd/issues/701) and [#658](https://github.com/lushly-dev/afd/issues/658). **After this phase, a deployment with any number of apps
loads the same JavaScript before its first frame as the empty shell, and that amount is smaller than it is today.** Everything else here serves that sentence.

### 2.1 What was measured

`main` at `980cc1aa`, Vite's production build, Chromium through the harness's `serveDeployment`, 4x CPU throttling and an 8 Mbit/s, 70 ms emulated network:

| Deployment | JavaScript before first contentful paint | Requests | `first-contentful-paint` |
| --- | --- | --- | --- |
| Empty | 318,497 bytes (94,561 gzip) | 13 | 792 ms |
| Hello | 679,123 bytes | 24 | 1,964 ms |
| Hello and tally | 679,123 bytes, and a second manifest | 25 | 1,980 ms |

So phase 1's "about 340 KB more" is 360,626 bytes, and a real deployment paints 2.5 times later than the number the budget holds. Those bytes are `validate.generated` (174,580), `apps` (102,261),
`surfaces` (50,984), `deployment` (2,501) and what `surfaces` imports, the listbox and the option among them.

The empty shell's first paint is 11 chunks, of which `schemas-*.js` is **Zod alone: 103,269 bytes, 28,661 gzip**. Three options for it were measured on the real page, by aliasing `zod` to a
throwaway shim over `zod/v4/mini` with the chain methods the graph calls, and rebuilding:

| Schema layer | First paint | Gzip | Saves |
| --- | --- | --- | --- |
| Classic Zod, today | 318,497 | 94,561 | |
| Zod Mini, with `toJSONSchema` still in the graph | 298,144 | 89,697 | 20,353 and 4,864 |
| Zod Mini, with `toJSONSchema` out of the graph | 276,547 | 83,146 | 41,950 and 11,415 |

Those shims are measurements, not a port: they show the size and were never run. They hold none of the JSON Schema literals a real port needs, and no locale, and the build still had classic Zod lazily, through the MCP client's own `zod/v4`, so what classic widens in the shared core stays in first paint in those figures. **An independent review measured what they leave out:** the input schemas of today's 29 first-paint commands as literals are 4,504 bytes and 902 gzip; Mini's English locale is 3,115 and 1,072; and Mini alone with classic only lazy holds about 40 KB of `zod/v4/core` that classic widens, as phase 1's 9.5 predicted for `fromJSONSchema`. Trying this changed the expected answer. A first estimate from a small sample, 45,087 bytes of Mini against 103,269 of classic, promised about 58,000
bytes; Mini alone gives a third of that, and **`toJSONSchema` is half of the saving**, which is the second option of #658 and why step 0a is shaped as it is.

Also measured: under no throttling, Chromium in the harness can report `first-contentful-paint` after the idle chunks have loaded (18 requests on the empty shell, 372,888 bytes, 60 ms). So a byte count in a
test cannot rest on that moment, and [E1](#15-exit-criterion-and-tests) reads a mark the shell sets instead.

### 2.2 Two stages (D69)

The boot splits at the first frame.

| Stage | When | What runs |
| --- | --- | --- |
| **A** | Before the first frame, in every deployment | `deployment.json` read by a hand-written check; `createKernel` over the stores, with the first-paint commands; each app's layout record registered from its boot record; `hydrate`; the chrome's parts, the rail from `app-list` |
| **B** | After the first frame | The late commands; the readers, validators and `kernel/src/apps/`; every package's manifest, validated; the app commands and the surfaces; a persisted or URL-named app opening |

**Stage A trusts the projection for display, and for one value more.** What the boot record says reaches the rail as text and a layout's first shape. No command, grant, module or surface comes of it. **The one value is `workspace.id`,** which becomes the kernel's workspace: line 1 of every call, and every record's `workspace`. It stays when stage B refuses the projection. So `readBoot` holds it to its pattern ([4.2](#42-the-deployment-file-version-2)), and a boot record that lies about anything else is corrected by stage B, which E1 tests. Stage B reads the
projection with `readProjection` and each manifest with `readManifest`, as phase 1 does, before anything of that app registers, so phase 1's "a manifest is untrusted input: the kernel validates it at load even though `app
pack` did" still holds. Whoever can change `deployment.json` on the shell's origin can change the shell's own JavaScript, so a boot record that lies costs only that deployer's rail, until stage B corrects it. **This is not a trust-model
change.**

#### The projection, version 2

`manifest/schemas/projection.v2.json`, closed at every depth. `loam deployment write` writes:

```json
{
	"deployment_version": 2,
	"generation": "sha256-3b7e9f...",
	"workspace": { "id": "acme", "name": "Acme" },
	"sandbox_origin": null,
	"apps": [
		{
			"instance": "hello", "app": "hello", "package": "apps/hello/", "order": 10,
			"config": { "default_name": "friend" },
			"boot": {
				"title": "Hello", "kind": "native", "icon": "system/document", "order": 10,
				"scope_levels": ["workspace", "project"], "rail": true,
				"parts": ["sidebar", "inspector"],
				"layout": { "sidebar": { "open": true, "width": 260 }, "inspector": { "open": false } },
				"refusal": null
			}
		}
	]
}
```

| Key | Rule |
| --- | --- |
| `generation` | `sha256-` and the hex digest of the canonical JSON of `{ workspace, apps }`, each `boot` left out, with keys sorted. It changes when a deployer's entry changes, not when a package's display does |
| `workspace` | From the deployment file ([4.2](#42-the-deployment-file-version-2)). `{ "id": "personal", "name": "Personal" }` when it names none |
| `boot.title`, `icon`, `order` | What phase 1's `app-list` computes: the entry's override, then the manifest's, then the default |
| `boot.kind` | `plugin.kind`, or `native` when the manifest cannot be read |
| `boot.scope_levels` | `app.scope_levels`, default `["workspace"]`. A mounted entry with `projects` is `["project"]` ([9.1](#91-an-instance-and-its-projects-d55)) |
| `boot.rail` | `false` when the manifest declares `ui.documents` and no rail, sidebar or main ([8.3](#83-new-keys)). `true` otherwise, also for a refused package |
| `boot.parts`, `boot.layout` | The parts the surfaces declare, and `ui.layout`. Stage A gives them to `firstLayoutOf(parts, layout)`, `firstLayout` of `apps/entry.ts` moved to `layout.ts` |
| `boot.refusal` | `null`, or the `{ code, message, suggestion }` that `readManifest` or the entry's checks refused it with |

`vite build`'s own `public/deployment.json` holds `{ "deployment_version": 2, "generation": "empty", "workspace": { "id": "personal", "name": "Personal" }, "sandbox_origin": null, "apps": [] }`.
Version 1 of the projection is not read: `dist` and its projection are written together, and no deployment exists. The manifest package keeps `projection.v1.json` for its history.

#### Reading it

`manifest/src/read-boot.ts`, exported from the package's root, in first paint and holding no validator, replaces `isEmptyProjection`. The kernel takes these types and `web/src/main.ts` calls it:

```ts
export interface BootProjectionV2 {
	generation: string;
	workspace: { id: string; name: string };
	apps: BootAppV2[];
}
export interface BootAppV2 {
	instance: string; app: string; title: string; kind: 'native' | 'view' | 'mounted'; icon: string; order: number;
	scopeLevels: Array<'workspace' | 'project'>; rail: boolean; parts: string[]; layout: unknown;
	refusal: { code: string; message: string; suggestion: string } | null;
}
/** Undefined when `raw` is not a version 2 projection at all. Each field is checked as it is read, as `unavailableApps` does. */
export function readBoot(raw: unknown): BootProjectionV2 | undefined;
```

An entry with a display field out of shape takes that field's default and stays listed, since stage B will refuse it with its reason. **`instance` and `app` have no default:** an entry whose `instance` or `app` fails the projection's pattern (`^[a-z][a-z0-9]{0,31}$`) is dropped, since it would otherwise name a layout id and a view-state record. A `workspace.id` off its pattern makes the whole result `undefined`, which loads the reader at once and shows "Loam cannot start" with the refusal, as phase 1's 9.4 does: that is a
`deployment.json` from nothing Loam wrote.

#### Stage A in the kernel

`KernelOptionsV2` ([11.1](#111-kernel-interface-version-2)) takes `boot`, `initialScope` and `appsLoader`, which stage B calls. **Stage A's registries hold only the commands boot calls:** `appearance-get`, `layout-get`, `auth-session-get`, `app-list`, `scope-get` and `section-get`, and their literals, in first paint ([2.3](#23-the-lean-schema-layer-d70)). `createKernelParts` does, in this order:

1. `registerShellState(viewState)`, which now also registers `loam.scope`, and `loam.layout.~projects` and `loam.layout.~documents`.
2. For each `boot.apps` entry, `state.registerAppLayout(instance, ...firstLayoutOf(parts, layout))`, under the workspace-level id.
3. `await state.hydrate()`, then `await projects.load(store)`, one `list` of `project`, and `await workspaceApps.load(store)`, one `list` of `workspace-app`.
4. **The active scope.** `initialScope`'s slug if the cache has it and `decideAccess` allows it; otherwise `loam.scope`'s id, on the same two tests; otherwise the workspace. This is in memory: a change is journaled in stage B ([6.3](#63-the-scope-and-the-url)).
5. For an app whose levels hold `project`, with a project active, register `appLayoutId(instance, project)` from the same boot fields, and `await viewState.hydrateOne(id)`, so the first frame has this project's layout. Without this, a reload in a project paints the workspace's.
6. `apps = bootApps(boot, workspaceApps, state, reason?)`, in `apps-runtime.ts`, replacing `unavailableApps`, which it generalizes. `summaries()` lists every entry: `state: 'refused'` with `error` for a `refusal`, `'disabled'` for a record so marked, otherwise `'loading'`, with `scopeLevels`, `rail` and `available`. `open`, `close` and `detail` work as `unavailableApps` does. `open` refuses a project-only app with no project as `SCOPE_PROJECT_REQUIRED` from the boot record's levels, and honours a shell-owned modal as `OVERLAY_MODAL_BUSY`, closing #709's second half. `port` throws `APP_NOT_READY`, retryable.
7. `setAppCommands([])`. Return the kernel. `createKernel` resolves here.

With no `boot`, as in every test and the test kit, `createKernelParts` runs stage B itself before it resolves, so `createKernel({ deployment, ports })` keeps phase 1's meaning, and so does `replayKernel`. `deployment` is then a `ProjectionV2`, and `@lushly-dev/loam-testing` writes one with `generation: 'test'`.

#### Stage B in the kernel

`kernel.startApps()` is idempotent and returns one promise, `kernel.appsReady`, which never rejects:

1. `const { lateCommands } = await import('./late/index.js')`. This chunk loads in every deployment, on the empty shell too. Its definitions **join `fixed`** (`kernel.ts:225-228`) and are name-checked there, so `taken` and mounted discovery's `setCommands` (`kernel.ts:338`, `apps/mounted.ts:707`) see them, and `setAppCommands` keeps its signature. If the import fails: `LATE_COMMANDS_UNAVAILABLE`, kept on `kernel.lateFailure`, and `run` answers it, retryable, for each name stage A does not hold; the chrome shows main's "Could not load. Reload to try again."
2. If `boot` lists an app: `const loaded = await options.appsLoader()`, which gives `{ deployment, ports }` or `{ refused: string }`, then `await import('./apps/index.js')` and `loadApps(...)`, as `kernel.ts:326-355` does. A chunk that fails is `APP_RUNTIME_UNAVAILABLE`, through `bootApps(..., reason)`. `refused` lists every entry `failed` with `DEPLOYMENT_INVALID`, whose message is the reader's, rather than phase 1's notice, because the shell is already on screen and D66 says a bad deployment shows in the rail.
3. `setAppCommands(apps.commands)`, and keybindings as today.
4. `apps.reconcileLayouts()`: `state.registerAppLayout` now replaces a record's `initial` and `declared` when one is registered, so a manifest that differs from its boot record wins, keeping what `hydrate` loaded where it still validates.
5. **Boot's journaled work,** unless `internals.replaying` ([10](#10-journal-and-replay-with-scope)), through `run` with `BOOT_FIELDS`: `workspace-deployment-apply` when the generation differs ([4.1](#41-the-workspace-store-d73)), and `document-trash-expire` when anything has expired.
6. Resolve.

**A call before stage B ends.** `run` waits rather than failing: if `name` is not a registered command, or is in `NEEDS_STAGE_B` (`app-get`, `app-command-list`, `app-instance-list`, `app-instance-refresh`, `app-selection-get`, `app-selection-set`, `status-item-set`), it awaits `startApps()` first. So a chord before stage B ends runs a moment later, an agent's first call works, and a real unknown name still answers `COMMAND_NOT_FOUND`. `listCommands()` lists what is registered, and the chrome and the palette re-read it on `appsReady`, since `setAppCommands` drops the palette's index anyway.

**Boot-only commands** (`workspace-deployment-apply`, `document-trash-expire`) are in `BOOT_ONLY`. `run` answers `COMMAND_NOT_FOUND` for those names unless `fields === BOOT_FIELDS`, an object in the kernel's closure that no caller can name, so no person, app or agent reaches them, on either interface. `INTERNAL_COMMANDS` filtering a list would not be enough, as `kernel.agent.call` would still run it. A replay reaches them through `replayJournal`'s target, which calls the registry directly. **That guard is in `run`, and a server does not call `run`:** `createMcpHandler` executes from its own command map, so `mcpOptions().commands` leaves out `BOOT_ONLY` and `INTERNAL_COMMANDS` ([3.3](#33-over-mcp)).

**What `run` may do.** `replayKernel`'s target calls `registry.execute` (`testing.ts:322`), so **`run` never executes in a replay, and it changes no state a replay must reproduce.** Every such change is in a handler or a middleware, which a replay runs. What stays in `run` is the requested scope, which a journal entry restores, the wait for stage B, the boot-only guard and the event.

#### Stage A and B in the chrome

- **`mountShell`** takes `base` and loses `apps`. `loam-shell`'s `#start` (`shell.ts:383-447`) reads what it does, plus `scope-get` and `section-get`, and `app-list` **only when `boot` lists an app, which `mountShell`'s new `listsApps` says**, so an empty shell's journal gains nothing. It renders the rail, sets `booted`, and awaits the frame. `hasApps` becomes `appCount > 0`, read from that `app-list` and re-read on `appsReady`.
- **After the first frame, always,** by `afterFirstFrame(view)` in `chrome/src/first-frame.ts`: two `requestAnimationFrame`s raced with a 300 ms timer, since a hidden tab fires none, and it never waits for idle. Then `performance.mark('loam-stage-b')`, then `kernel.startApps()`, and when `appCount > 0`, the `surfaces` chunk. `prepare` and `start` of `apps/surfaces.ts:209` run when `appsReady` resolves. **The mark is what the exit test reads** ([E1](#15-exit-criterion-and-tests)). The palette's `whenIdle` work stays where it is, and starts after this.
- **Main in the first frame.** `loam-main` gains `busy`, set when the persisted or URL-named owner is an app, a section or a document. It hides the landing and sets `aria-busy`, in its first-paint stylesheet. `busy` clears when the owner's surface is in, or on any failure, from `appsReady`, from the `surfaces`, `sections` or `editor` chunk failing, or after 15 seconds, with main's heading saying "Could not load. Reload to try again." Phase 1's "Opening Hello…" after 400 ms stays in the `surfaces` chunk. So no landing flashes before an app, which is why 9.6 thought the manifests were needed first.
- **`AppSurfaces`** gains `host(): SurfaceHostV1`, `{ ensureActivated(instance): Promise<void>; createMount(instance, element, label?): LoamMount }`, what `#activate`, `#hold` and `#mount` (`surfaces.ts`) do privately, for the [editor frame](../2-documents/spec.md#56-the-editor-contract). `attachSurfaces`' use of `shell.hasApps` (`surfaces.ts:937`) becomes `appCount > 0`.

### 2.3 The lean schema layer (D70)

Phase 0's and phase 1's budgets met Zod by narrowing around it. This step removes it from first paint.

**AFD, step 0a.** `@lushly-dev/afd-server` keeps every signature and gains one export. **This step adds the path, and moves nobody onto it,** so first paint gains only what it must, [measured below](#23-the-lean-schema-layer-d70), within today's margin of 1,503 bytes and 439 gzip:

```ts
// @lushly-dev/afd-server/define and /direct, in a new module `define-core.ts`.
export function defineCommandWithSchema<TInput extends $ZodType, TOutput>(
	options: ZodCommandOptions<TInput, TOutput> & { jsonSchema: JsonSchema; outputJsonSchema?: JsonSchema }
): ZodCommandDefinition<TInput, TOutput>;
```

- **`defineCommand`** computes `jsonSchema` with `zodToJsonSchema` and calls it, so nothing else changes for any existing caller. `ZodCommandOptions`' bound widens from `ZodType` to `$ZodType` of `zod/v4/core`, of which classic's `ZodType` is a subtype. `ContextField.schema` (`context-fields.ts:19`) widens the same way.
- **The module graph.** Reachable from `defineCommandWithSchema`, `createDirectRegistry` and `createJournalMiddleware`, no module imports `zod` or `zod/v4/classic` at run time. They use `zod/v4/core`'s functions, `safeParse(schema, input)` among them, which is the one run-time dependency on Zod that stays, for validation and `examples`. `validation.ts:136-150` reads `schema._zod.def.innerType` with `instanceof $ZodObject`, `$ZodOptional` and the rest, since Mini has no `.unwrap()`, and classic's schemas have the same `_zod.def`.
  `patterns` (`validation.ts:173-198`) moves to `patterns.ts`, still exported from the root alone (`index.ts:214`). `zodToJsonSchema` moves to `json-schema.ts`, with `toJSONSchema` imported from `zod/v4/core`.
- **Messages.** A Mini schema with no locale says `Invalid input`, and classic registers English only on first constructing a type (`zod/v4/classic/schemas.js:9-12`), so one schema's text would change on the page when classic loads. **`formatZodIssue` (`validation.ts:73-84`) builds its message from `issue.code`, `expected` and `path` when `issue.message` is the bare `Invalid input`,** and no locale is added to first paint, whose bytes it would cost. A table test holds a Mini schema's `VALIDATION_ERROR` message and suggestion equal to the same classic schema's, so "actionable errors" holds and other callers see no change.
- **`checkContextFields`** does no conversion. `describeContextFields`, which calls `zodToJsonSchema` only at discovery, moves to `context-fields-describe.ts`, which only `createDirectToolSurface` and the servers import.
- **`packages/server/src/entry-points.test.ts`** bundles an entry that imports `createDirectRegistry`, `createJournalMiddleware` and `defineCommandWithSchema`, and fails if the output includes `zod/v4/classic` or the module of `toJSONSchema`. Its other budgets stay.
- **Also.** The `afd-typescript` skill names `defineCommandWithSchema`; a changeset, minor, for `afd-server`. **Corrected by step 0a:** `skills/exports.json` lists `afd-typescript` as local, so its `SKILL.md` is the source, with no Botcore source to sync.

**What step 0a measured and decided, correcting the above.**

- **The ledger's "nothing" did not hold, and the margin did.** The registry reaches the message builder, and `defineCommand` the new modules, so first paint gained 621 bytes and 330 gzip: 319,118 and 94,891 against 318,497 and 94,561, inside today's margin, leaving 882 and 109 for what lands before step 1.
- **The message table is partial, because its budget is.** All of English cost 2,323 bytes here, and `entry-points.test.ts`'s host budget of 39,000 had 412 to spare at esbuild 0.28.2. So `issue-message.ts` rebuilds a wrong type, a value, a size other than a file's, an unknown key, a regex and a discriminator, equal to classic in the table. A format keeps its own name (`Invalid email` for `Invalid email address`), and a rarer code stays bare, with its path, each pinned in a second table. **So those texts still change on the page when classic loads in stage B.** Every shape the first-paint commands use today is in the first table, except `.email()`. That budget now has almost nothing left: the next addition to the registry's graph moves something out or raises it openly.
- **The message needs the issue's `input`,** to say what it received, and Zod drops that unless asked, so validation parses with `{ reportInput: true }`. It never reaches a result, a log or the journal. It runs only with no locale loaded, so a schema's own text, an error map and a chosen locale stay as they are. `applyContextFields` and `examples` use it too, so a Mini context field says the same.
- **`outputSchema` widens as well,** since a Mini output has to fit. A caller reading it, or `ContextField.schema`, as classic needs a cast; nothing here does. `ZodCommandDefinition` with no type argument keeps `inputSchema` classic, so its readers compile.
- **`checkContextFields` recognises a schema by `_zod`,** since `$ZodType` promises no `safeParse` method.
- **The entry itself, one command through Vite:** classic with `defineCommand` 122,951 and 36,782; Mini with `defineCommand` 74,338 and 24,065; Mini with `defineCommandWithSchema` 52,106 and 17,201. So `toJSONSchema` alone is 22,232 and 6,864, as 2.1's shim found (21,597 and 6,551). Mini's own saving here is larger than the shim's only because this host has no lazy classic beside it, so it says nothing about step 1, whose acceptance stands unmeasured. Under esbuild, import `* as z from 'zod/mini'`: `import { z }` keeps all of Zod, locales and `toJSONSchema` included.


**Loam and AFD together, step 1.** One pull request, so first paint never holds both layers:

- **`@lushly-dev/afd-view-state` and `@lushly-dev/afd-auth`.** Their `commands.ts` move to `zod/mini` and `defineCommandWithSchema`, each schema beside its JSON Schema as a literal, each package's test holding every literal equal to `toJSONSchema(schema)`. A changeset, minor, for both.
- **`auth-session-get` needs a route into first paint alone.** `createAuthCommands` (`packages/auth/src/commands.ts:38`) builds all three together. So `@lushly-dev/afd-auth/commands` gains `createAuthSessionGetCommand(adapter)` and `createAuthMutationCommands(adapter, options)`, in modules of their own, and `createAuthCommands` returns both, unchanged for other callers. First paint imports the first and `late/` the second, so `checkNames`' `COMMAND_NAME_DUPLICATE` never sees `auth-session-get` twice. `createViewStateCommands` goes to `late/` whole, since boot calls none of its three.
- **`kernel/src/commands.ts`, `app-commands.ts`, `overlays.ts` and `context-fields.ts`** move the same way.
- **The registry splits.** Only the six boot commands of [2.2](#22-two-stages-d69) stay in first paint, with their literals. Every other shell command's definition, the view-state and auth commands' with them, moves to `kernel/src/late/`, loaded in stage B. `run`'s wait makes this invisible to a caller. With no `boot`, stage B runs inside `createKernel`, so a unit test sees every command at once and phase 0's tests read as before.
- **Classic Zod moves to stage B.** `apps/definitions.ts` keeps `fromJSONSchema` and `defineCommand`, from classic, in the `apps` closure, and `narrowZodFromJsonSchema` stays, for the reason it was written. Honestly stated: **classic's schemas leave first paint, and about 40 KB of `zod/v4/core` that classic and the MCP client widen stays,** since a bundler tree-shakes across chunks ([9.5](../1-app-contract/spec.md#95-decided-by-step-3)). Mini's floor of 23,829 bytes is not reachable while `apps` or the MCP client use classic; a follow-up asks whether it should be.
- **`zodJitlessByDefault`** needs no change: classic and Mini share `zod/v4/core`'s `globalConfig`, the object it starts `jitless` (#664), and E2's CSP checks hold that.

**The acceptance.** Step 1 must reach **at most 272,000 bytes and 82,000 gzip** for first paint, what the ceilings less the ledger below leave. The shim's 276,547 and 83,146 held no literals, about 1,000 and 200 for six commands, and did not move any definitions out, an estimated 15,000 to 20,000 and 4,000 to 5,000, unmeasured. So the expected result is about 258,000 to 265,000. **If it misses, the agent stops.** A ceiling rises only by a pull request with the measurement and the coordinator's approval. The named fallback comes first: `ICONS_V1` and `loam-tooltip` move after the first frame, leaving a blank icon slot for that frame, in a rail of fixed width so nothing shifts; estimated 3,000 to 4,000 bytes and 1,000 to 1,400 gzip, unmeasured.

### 2.4 The budget, and the rule

`scripts/budget.mjs`'s rows at the end of phase 2. **Budgets are real: a step that adds first-paint code first moves something out, and says so in its pull request with the two measurements.** Phase 0's rule still applies: under 70% of a ceiling, it is lowered to the measurement plus 10%, and raising one needs an amendment.

Every lazy row is a **static closure**: the named chunks and what they import that was already counted as loaded, in the order a page loads them, first paint, then `late`, then `apps`, then `surfaces`, then the rest. So classic Zod, in whichever shared chunk the bundler parts it (`iso-*` in a trial), is charged to `apps`, and not to `mount`.

| Row | Measures | Now | Ceiling | Set by |
| --- | --- | --- | --- | --- |
| `jsMinified`, `jsGzip` | The entry's static closure: **first paint, the same for every deployment** | 318,497, 94,561 | 300,000, 91,000 | Step 1 sets them. Lowered from 320,000 and 95,000 |
| `cssMinified` | As phase 0 | 7,719 | 8,496 | Unchanged |
| `kernelMinified` | The kernel alone, without `src/apps/` and `src/late/` | 226,747 | 231,360 until step 1, then the measurement plus 10% | Step 1 |
| `lateMinified` | `late-*` and what it imports that first paint has not loaded, with the moved command definitions | None | 75,000, a first estimate from the ledger below | Step 1 |
| `appsMinified` | The `apps`, `validate.generated` and `deployment` chunks' closure, now with classic Zod | 279,342 | At most 400,000: step 1 sets it to its measurement plus 5%. The one raise, for bytes that left first paint | Step 1 |
| `surfacesMinified` | As phase 1, and it loads after first paint | 78,554 | 85,000 | Unchanged |
| `viewMinified`, `consoleMinified`, `mountMinified` | As phase 1, with `apps` counted as loaded | 22,800, 83,325, 217,081 | 25,080, 91,222, 238,268 | Unchanged. `view` holds the editor's frame host unless step 12 amends it |
| `switcherMinified` | `switcher-*`: the project list | None | 30,000, a first estimate | Step 6 |
| `sectionsMinified` | `sections-*`, the projects section | None | 45,000, a first estimate | Step 7 |
| `documentsMinified`, `editorMinified`, `newMinified` | The [documents specification's chunks](../2-documents/spec.md#12-budgets) | None | 45,000, 40,000, 12,000, first estimates | Steps 10 and 11 |

`budget.mjs` adds the `--json` keys, keeps `hello` and `tally` as recorded rows and adds `tasks`, `notes` and `checklist`.

**The ledger.** What first paint may gain, by step, in bytes and gzip bytes, from step 1's acceptance. A lazy chunk's boundary costs first paint too, as [9.8](../1-app-contract/spec.md#98-decided-by-step-6) measured, so each has a line. **Step 1's real figures replace its line as the running base,** and each step records its real figure here and carries it down. Steps 0a and 0b land before step 1, on today's margin of 1,503 and 439.

| Step | Adds to first paint | Allowance | Running |
| --- | --- | --- | --- |
| 0a | Planned as nothing. Measured: the message builder and the moved modules, which the registry and `defineCommand` reach ([2.3](#23-the-lean-schema-layer-d70)) | 621, 330 | 319,118, 94,891 |
| 1 | The acceptance above: what is left after moving out classic's schemas, `toJSONSchema` and the non-boot definitions | | 272,000, 82,000 |
| 0b | `hydrateOne`, a method on a class first paint holds. Measured with 0a, before step 1: 180 and 50, so 319,298 and 94,941, leaving 702 and 59 for what lands before step 1. Step 1 re-bases this column, so it stays on the allowance until then | 200, 100 | 272,200, 82,100 |
| 2 | `readBoot`, `bootApps` in place of `unavailableApps`, the stages, `run`'s wait, `busy`, and `loam-app-entry` with `ICONS_V1` (measured by the first review at 8,292 and 2,688, leaving 812 gzip for the rest) | 9,800, 3,500 | 282,000, 85,600 |
| 4 | `decideAccess`, the field, the middleware, the project cache, `scope-get`, `section-get`, the `workspace-app` read, the `late` boundary | 4,600, 1,800 | 286,600, 87,400 |
| 5 | `parseRoute`, `formatRoute`, the router's writes | 2,000, 800 | 288,600, 88,200 |
| 6 | The bands, `loam-section-entry`, the switcher's button, `loam-tooltip`, the status bar's left items, the live region, the `switcher` boundary, less the settings tooltip's CSS | 5,600, 2,100 | 294,200, 90,300 |
| 7 | The `sections` boundary | 150, 100 | 294,350, 90,400 |
| 10 | The `editor` boundary | 150, 100 | 294,500, 90,500 |
| 11 | `loam-new-button`, a text button with no icon, and the `documents` and `new` boundaries | 600, 250 | 295,100, 90,750 |

That total leaves 4,900 and **250 gzip** under the ceilings. **Gzip is the binding margin,** and if step 1 lands where it is expected to, it gains about 2,000 to 4,000 more. **Everything else this phase adds is lazy.** A step over its allowance moves code out or amends this table first.

**The `late` chunk's ledger,** a rough count for about 70 commands, each a schema, a literal and a handler. Each step records its real figure, and a step that would pass the ceiling moves logic to a chunk of its own first.

| Step | Adds | Allowance | Running |
| --- | --- | --- | --- |
| 1 | The non-boot shell, view-state, auth, overlay and app commands, about 25 | 20,000 | 20,000 |
| 4 | `project-*`, `workspace-*`, `scope-set`, `section-open`, `app-route-set`, `applyScopeChange` | 14,000 | 34,000 |
| 7 | `project-summary-get`, `resourceLinkUrl` | 2,000 | 36,000 |
| 9 | The registry, the `document-*` commands, the check | 16,000 | 52,000 |
| 10 | `editor-*`, `validateEditorState` | 6,000 | 58,000 |
| 11 | `new-list`, the palette's document rows | 3,000 | 61,000 |
| 12 | `document-link-*`, `createDocumentIndex` | 5,000 | 66,000 |

## 3. Scope

### 3.1 The value (D71)

```ts
// @lushly-dev/loam-sdk
export interface ScopeV1 {
	/** The workspace's id. */
	readonly workspace: string;
	/** A project's `id`, when the call runs in one. */
	readonly project?: string;
}
```

Its Zod Mini schema is `SCOPE_V1` in `kernel/src/scope/field.ts`: a strict object with `workspace` and an optional `project`, each a string of 1 to 128 characters. Ids, never names. The JSON form is the same.

### 3.2 The field

Scope is one more declared context field (D31), `journal: true`, in `KERNEL_CONTEXT_FIELDS`:

| Name | `_meta` key | Value |
| --- | --- | --- |
| `scope` | `dev.loam/scope` | `ScopeV1` |

So a handler reads `context.scope`, the journal keeps it (`spec/journal.md`), and `replayJournal` restores it (`journal-replay.ts:291-305`). No AFD change: this is the example `spec/context-fields.md` gives.

**What each path sets:**

| Path | The requested scope |
| --- | --- |
| `kernel.call`, `kernel.agent.call` | `options.scope`, if given, otherwise the active scope at the moment of the call. `run` sets it on the context per call, so it is explicit per request; no registry or connection holds it |
| `options.scope: 'workspace'` | The active workspace with no project: what a dual-scope app's workspace list asks for ([7.4](#74-sidebar-header-and-status-bar)) |
| An app's surface | **The scope its [surface port](#36-a-surfaces-port-d83) was created with,** so a press in flight during a switch stays in the project it was pressed in; or `level: 'workspace'`. A surface given anything else refuses it with `SCOPE_NOT_GRANTED`: an app never chooses a project. Only the chrome creates a surface port, so an embed's scope is the shell's choice, not the app's ([documents specification](../2-documents/spec.md#92-embed)) |
| A nested call | The outer call's effective scope. A handler's `context.client` takes `{ level: 'workspace' }` and nothing wider |
| A view's or a frame's `tools/call` | `_meta["dev.loam/level"]: 'workspace'` is that level. Nothing else in `_meta` is read for scope, and `dev.loam/scope` from a frame is ignored, so the SDK's `level` works in `/view` |
| MCP `tools/call` | `params._meta["dev.loam/scope"]`, and absent means the workspace with no project ([3.3](#33-over-mcp)) |
| A journal's replay | The entry's value. An entry with none, written before phase 2, replays as the workspace with no project |

### 3.3 Over MCP

**The architecture's exit criterion says the scope travels in `_meta` over MCP. No hosted server exists until phase 6, so phase 2 proves it with a test-only handler, as D64 did for the mounted route, and says so wherever the result is recorded.**

- **Inbound.** `KernelParts.mcpOptions()` returns what phase 6's hosted lane passes to `createMcpHandler`:

  ```ts
  export interface KernelMcpOptions {
  	/** Every registered command but `BOOT_ONLY` and `INTERNAL_COMMANDS`, with `expose.mcp` as phase 6 will decide; the test sets it on all. */
  	commands: readonly ZodCommandDefinition[];
  	/** The auth middleware, the journal's, then the scope middleware (3.4): the kernel's own chain. */
  	middleware: readonly CommandMiddleware[];
  	/** `scope` alone. */
  	contextFields: readonly ContextField[];
  }
  ```

  **Only `scope` is declared to a server.** `caller`, `app`, `instance`, `replay` and `parent` are set by trusted code alone, and declaring them over MCP would let a caller claim them, so `KERNEL_CONTEXT_FIELDS` stays the direct registries' list and `MCP_CONTEXT_FIELDS` is `[scope]`. An undeclared key is dropped, as `spec/context-fields.md` says.
- **Absent is the workspace.** There is no active scope on a server, and D4 forbids connection state: `scopeMiddleware` reads an absent field as `{ workspace }`. So `required` stays `false`, `afd-help` works with none, and a client that sends nothing never lands in somebody's project.
- **`tools/list` does not vary.** A declared field never changes it (`spec/context-fields.md`). E5 compares the lists across scopes, on one connection.
- **The claim is checked.** `spec/context-fields.md`: a field "is a claim", and "a handler that acts on a claimed scope checks the caller's access to it first". The scope middleware does ([3.4](#34-the-order-of-a-call-d72)), on every path, so nothing distinguishes a value from `_meta`.
- **Boot-only and internal commands are not served.** `createMcpHandler` builds its own command map and never calls `run` (`packages/server/src/server.ts:132-141`), so `run`'s guard cannot help: `workspace-deployment-apply` with a forged `projects`, or `document-trash-expire { before }` with a date far ahead, would otherwise be a client's to call. `mcpOptions()` leaves them out, and E5 asserts they are not listed and answer `COMMAND_NOT_FOUND`.
- **What this proof leaves out.** E5 runs the handler, the declaration and the kernel's middleware. It skips everything only `run` does: a default scope from the active scope, the wait for stage B, the event and `dev.loam/seq`. **Identity over MCP is unproved:** a server's actor is `{ kind: 'agent' }` with no id (`server.ts:140`), which `decideAccess` reads as `local`, so a signed-in person's agent is refused from that person's restricted project, and any caller with no session could enter a project restricted to `local`. How `onBehalfOf` maps to a member is phase 3's decision ([Follow-ups](#follow-ups)).
- **Outbound,** to a mounted instance: [section 9](#9-mounted-instances).

### 3.4 The order of a call (D72)

The chain is the kernel's: auth, then journal, as `kernel.ts:244-247` has it, then a new `scopeMiddleware`, last, so **every refusal below is journaled**, with the scope and the actor, as `CALL_NOT_GRANTED` is. AFD validates a field before middleware, so a malformed scope is `VALIDATION_ERROR`, and it is the only one that is not journaled, as a validation failure is not today. `scopeMiddleware` runs after `next` is due, so it sees the actor that auth set; and the journal reads context after `next()`, so **what is journaled is the effective scope,** and a replay's narrowing is idempotent. `run`'s `KernelEventV2.scope` comes from a `scopesSeen` map by trace ID, as `seqs` does, since `withContextDefaults` copies the context.

**Which commands take which lines.** A shell command does not act in a project by being called in one, so that a person can always sign in, read the layout, change scope or restore a project. **Lines 2, 3 and 6 run for commands an app or a mounted instance owns, and for instance commands.** A shell command has line 1, and its own rule:

| Shell commands | Rule |
| --- | --- |
| `appearance-*`, `auth-*`, `palette-*`, `shell-info-get`, `overlay-*`, `toast-show`, `modal-open`, `status-item-set`, `app-*`, `scope-get`, `section-*`, `workspace-*` | Runs at any scope |
| `layout-*`, `editor-*` | Each reads and writes **`context.scope`'s record,** `loam.layout.<owner>[@<project>]` or `loam.editor[@<project>]`, not the active scope's, so a replay finds the same one. A record not yet registered is registered then, from the owner's preset, so a `layout-set` between the stages works in the session and in a replay. With a project in `context.scope`, `decideAccess` runs first, and a refusal is `PROJECT_NOT_FOUND` |
| `view-state-get`, `view-state-set`, `view-state-list` | An id holding `@<project>` runs `decideAccess` on that project. Refused, it answers as an id that was never registered, and `view-state-list` leaves it out, so a signed-out person cannot read a restricted project's id or open documents through `view-state-get { id: 'loam.editor@prj_atlas' }`. `view-state-set` answers `VIEW_STATE_READ_ONLY` for `loam.scope`, `loam.apps`, any `loam.editor` record and `loam.new.recent`, naming the command that owns each |
| `scope-set`, `project-get`, `project-update`, `project-archive`, `project-restore`, `project-summary-get` | **`decideAccess` on the project they name,** first, and `PROJECT_NOT_FOUND` the same as line 2. `scope-set`'s and `project-update`'s rows say what else they refuse |
| `project-create`, `project-list` | No project is named. `project-list` filters each row through `decideAccess` |
| `document-*`, `new-list` | The [documents specification's check](../2-documents/spec.md#42-the-check-on-every-document-command), and `decideAccess` on any `project` they name |

**One function changes the scope.** `applyScopeChange(to, reason, context)`, in `kernel/src/late/scope-change.ts`, holds [4.3's switch rules](#43-the-project-store): it writes `loam.scope` and `loam.apps`, clears selections, dismisses a left app's overlays, swaps the editor state, and records a `ScopeChangeV2` for that call's event ([11.1](#111-kernel-interface-version-2)). Its callers:

| Caller | When | `reason` |
| --- | --- | --- |
| `scope-set` | Always, and `previous` comes from the persisted `loam.scope`, not from memory, since stage A may already hold the URL's project ([6.3](#63-the-scope-and-the-url)) | `scope-set` |
| `document-open` | The document is in another scope | `document-open` |
| `project-archive` | The active project is the one archived | `project-archive` |
| `scopeMiddleware`, **after `next()`** for a successful `auth-*` command | `decideAccess` refuses the active project for the actor the adapter now reports | `actor` |
| `scopeMiddleware`, **before `next()`** on any call | `actorKey(context)` differs from the last actor it saw, and `decideAccess` refuses the active project. So a session that expires, which runs no `auth-*` command, takes effect at the next call | `actor` |

A person who signs out inside a restricted project lands at workspace level, and is never locked out. **Both middleware callers are inside the chain, so a replay hits them,** with the same result in the same order, and a later `scope-set { project: null }` replays with zero differences. `reason: 'actor'` is not refused by a `shell`-owned modal, which it cancels, since no person chose it. Until stage B has loaded `late/`, no `auth-*` command can have run, so stage A needs no copy of this function.

**The chrome keys on the event,** `scopeChanged` and `mainChanged`, and never on a command's name, so all four callers recreate surfaces ([7.6](#76-surfaces-on-a-scope-change)), move the URL ([6.3](#63-the-scope-and-the-url)) and re-read the rail ([7.2](#72-the-elements)) the same way.

For one call of an owned command `name`, with requested scope `r` and actor `a`:

| # | Check | On failure |
| --- | --- | --- |
| 1 | `r.workspace` is this kernel's workspace | `SCOPE_WORKSPACE_UNKNOWN`. D32: one workspace per deployment in phase 2 |
| 2 | **The access decision:** `decideAccess(a, r)` | `PROJECT_NOT_FOUND`, with no other detail. See below |
| 3 | The owning app's levels, from `apps.scopeLevelsOf(name)` | `SCOPE_PROJECT_REQUIRED` when the app is project-only and `r` has no project: `Open a project first`, with `scope-set` as its suggestion |
| 4 | **Narrowing:** the effective scope. Workspace-only app with `r.project`: `context.scope` becomes `{ workspace }`. Otherwise `r` | Cannot fail. Narrowing never refuses, so a workspace app keeps working with a project active |
| 5 | **The resource check** ([3.5](#35-a-resource-in-another-project)) | `SCOPE_MISMATCH`, naming the right project, or `PROJECT_NOT_FOUND` |
| 6 | A mutation under an archived project | `PROJECT_ARCHIVED`, naming `project-restore` |
| 7 | Mounted only: [9.2](#92-a-call) | `MOUNT_PROJECT_NOT_LISTED`, `MOUNT_SPACE_PINNED` |
| 8 | The handler runs, with `context.scope` effective | Its own result |

**Where each line runs.** Lines 1 to 4 and 6 are in first paint, in `kernel/src/scope/`, and need only the project cache and `apps.scopeLevelsOf`, which answers `undefined` in stage A, when no owned command exists. Line 5's searches are in `apps/` and `late/`, and line 7's in `apps/mounted.ts`: the middleware calls them through `apps.checkResource(name, input, scope)` and the late commands' `checkDocument`, each absent until stage B has loaded it, by when no such command could have run.

**`decideAccess`** is pure, in first paint, in `kernel/src/scope/access.ts`:

```ts
export interface AccessInputV1 {
	/** `context.actor?.id`, or `LOCAL_ACTOR` ('local') for a signed-out person on a personal store. */
	actor: string;
	scope: ScopeV1;
	/** Undefined when no record has that id. */
	project: ProjectV1 | undefined;
}
export function decideAccess(input: AccessInputV1): { allowed: true } | { allowed: false };
```

- No `scope.project`: allowed. The workspace's membership is phase 3's, and until then whoever reaches the kernel is a member (D11, D32).
- **The actor's id must survive a reload and a replay,** or a `restricted` project strands its creator, and `createdBy` differs. Today `MockAuthAdapter`'s is `mock-user-${Date.now()}` (`packages/auth/src/adapters/mock.ts:52`), and `REPLAY_IGNORE` skips `data.user.id` for that reason. **Step 0b derives it from the email, `mock-user-<email>`,** so the same person is the same member, and a replay of `auth-sign-in`, whose email is in the journal, gives the same id. A person signed in with another email sees such a project as missing, as they should.
- `project` undefined, or `access.mode === 'restricted'` with `actor` not in `access.members`: not allowed.
- Otherwise allowed. **Active scope is never an input.** It narrows what a person sees and grants nothing (D4).

**The same refusal for "does not exist" and "you may not".** `PROJECT_NOT_FOUND` has one fixed message, `No project with that name is available to you`, and the suggestion `List the projects you can open with project-list`. No detail says which, so a non-member learns nothing, as phase 1's `CALL_NOT_GRANTED` keeps a view from learning about other apps.

**Phase 3's seam.** `decideAccess` takes the record, so phase 3 changes `access` and the actor's source and not the order. An agent member's project list (D40) and a persona never reach it as a grant (D11).

### 3.5 A resource in another project

"A mutation naming a resource in another project is refused after the access decision, with a suggestion naming the right project" (architecture section 7).

The shell knows a resource's project in two cases.

- **Documents.** The record says, so every command taking a document id does this check ([documents specification](../2-documents/spec.md#41-commands)).
- **App resources in the `store`.** An app names which input property holds a store key, in its own section of the manifest, so the check runs in the kernel for any kind:

  ```toml
  [app]
  scope_levels = ["project"]
  resource_keys = { "tasks-complete" = "task", "tasks-rename" = "task" }
  ```

  `tasks-complete { task: "t-1" }`, in project Atlas, with no record `t-1` in Atlas: the middleware searches the instance's table by `key`.

  | Found | Answer |
  | --- | --- |
  | In this scope | The call proceeds |
  | Nowhere | The call proceeds, and the handler says what it says of a missing key. The shell cannot tell a new key from a mistyped one |
  | In a project the actor may enter, or at workspace level from a dual-scope app's call in a project | `SCOPE_MISMATCH`: `` `t-1` is in the project Beacon, not Atlas ``, with the suggestion `` Switch with scope-set { project: "beacon" } and run this again. `` and `details: { project: { id, slug, name } }`, or `` is in the workspace `` and `scope-set { project: null }`. The first such project by `createdAt`, when several hold the key. **When `fields.caller` is set, an app called, so the message says only `in another scope`, with no details:** an app learns no project's name without the `projects` grant |
  | Only in a project the actor may not enter | Proceeds as "nowhere", which reveals nothing. A store's namespace already keeps that key out of this scope ([5](#5-the-store-grant-d77)) |

  **It is a helper, and the store is the boundary.** With or without `resource_keys`, `context.store` holds only the call's effective scope, so a cross-project write cannot happen by construction, in any kind. `resource_keys` gives the refusal its suggestion. The search is one `list` of the table, on a call that was going to miss, and happens only when the key is absent from this scope.

- **A mounted command** names no store. The space pin does what it can ([9.2](#92-a-call)).

### 3.6 A surface's port (D83)

Binding a surface's scope needs an object per surface. Today there is one port and one broker per instance (`kernel/src/types.ts:105`, `apps/view-broker.ts:47`), and `broker.toolsCall(params)` has no idea which surface called (`chrome/src/view/view-host.ts:133`), so a view's press sent in Atlas and arriving after `scope-set`, before its teardown, would write to Beacon. So:

```ts
export interface SurfaceOptionsV2 {
	/** Fixed for this surface's life. Only the chrome calls `surface`; an app never holds a port. */
	scope: ScopeV1;
	/** An embed: every mutation is `EMBED_READ_ONLY`. */
	readOnly?: boolean;
}

export interface SurfacePortV2 {
	readonly scope: ScopeV1;
	readonly readOnly: boolean;
	/** `options.level: 'workspace'` is the only widening. Any other scope is `SCOPE_NOT_GRANTED`. */
	call<T = unknown>(name: string, input?: unknown, options?: { signal?: AbortSignal; level?: 'workspace' }): Promise<CommandResult<T>>;
	/** The view's broker, closed over this surface. Absent for any other kind. */
	readonly view?: ViewBrokerV1;
}

export interface AppPortV2 extends AppPortV1 {
	surface(options: SurfaceOptionsV2): SurfacePortV2;
}
```

- **The chrome makes one per surface,** when it creates the mount or frame, and drops it with the surface. `loam-view-frame` takes `surface.view`, so `toolsCall(params)` and `runBound` close over its scope. A view's `tools/call` has no way to name a surface, so a frame cannot claim another's.
- **A native surface's context** is `{ ...held.context, client: surface }`, in `#mount` (`surfaces.ts:850`), so an element's `context.client` is bound to it. That is a contract, as all of a native app is (D54). For a view it is a boundary.
- **The checks of phase 1's 5.3** run in `surface.call` as they do in `port.call`, then `readOnly`: a command the registry reports as a mutation is refused through the internal `app-embed-refuse`, journaled.
- **`port.call`** stays, for the chrome and tests, and uses the active scope. A handler's `context.client` is the nested client, which holds the outer call's scope. A handler frame's own `tools/call` and `dev.loam/store` take theirs from `callId`.

## 4. The stores

`storeInterface` becomes 1 in `shell-info-get`. Every table goes through `DataAdapter`, in the same `loam-store` database, with no IndexedDB upgrade, since a table is a key prefix (`indexeddb-adapter.ts:219`). The conformance suite gains these tables' behaviour in `kernel/src/stores.test.ts`, over `MemoryAdapter` and `fake-indexeddb`.

| Table | Record | Key |
| --- | --- | --- |
| `workspace` | `WorkspaceV1` | Its `id`. One row in phase 2 |
| `workspace-app` | `WorkspaceAppV1` | The instance id |
| `project` | `ProjectV1` | `prj_` and 10 characters |
| `document`, `document-link` | The [documents specification](../2-documents/spec.md#3-the-document-record) | |
| `app-<instance>` | Phase 1's `AppStoreRecord`, with its `scope` filled ([5](#5-the-store-grant-d77)) | |
| `settings` | View-state, as today | |

**Every record carries** its workspace and, where it has one, its scope, the actor that wrote it and timestamps, and the store functions in `late/` refuse a write without them (architecture section 7), as E10 tests. `createdBy` and `updatedBy` hold the actor's id or `local`. A `store` grant's row keeps phase 1's `actor`, whose `null` now reads as `local`. Time and ids come from the command's clock and random, so a replay reproduces them: `prj_` followed by `random()` in base 36, ten characters.

### 4.1 The workspace store (D73)

D63: "Phase 2's workspace store takes the entries, except what D56 keeps in configuration."

```ts
export interface WorkspaceV1 {
	id: string;              // and its slug: `^[a-z0-9][a-z0-9-]{0,62}$`, not reserved (6.1)
	name: string;
	generation: string;      // the projection's, once applied
	trashDays: number;       // default 30; the documents specification's trash
	organization: null;      // reserved: phase 3 (R10)
	tenant: null;            // reserved (D32)
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
}

/** One entry of the projection, kept. Never a location, a credential or a command line (D63). */
export interface WorkspaceAppV1 {
	id: string;              // the instance
	workspace: string;
	app: string;
	package: string;
	config?: Record<string, unknown>;
	prefix?: string;
	audience?: 'team' | 'person';
	transport?: 'http' | 'stdio';
	route?: string;
	projects?: string[];
	space?: Record<string, string>;
	expose?: Record<string, boolean>;
	commands?: Record<string, unknown>;
	order?: number;
	title?: string;
	/** What a person changed, which outlives the next deployment. */
	overrides: { enabled?: boolean; order?: number; title?: string };
	/** The generation that last listed it, or null once it stopped. */
	listed: string | null;
	updatedAt: number;
	updatedBy: string;
}
```

**What moves, and what stays.**

| Key of phase 1's entry | Where |
| --- | --- |
| `instance`, `app`, `package`, `order`, `title`, `config`, `prefix`, `audience`, `transport`, `route`, `projects`, `space`, `expose`, `commands` | The projection, then `workspace-app`. **A deployer's write, read-only to every command** |
| `url`, `bearer_file`, `bearer_env` | The deployment file and `writeDeployment`'s `mounts`. Never the browser, the projection or the store (D63, D64) |
| `command`, `cwd` | The deployment file. Never the browser, the projection or the store (D56) |
| `sandbox.origin` | The projection, because it reaches the CSP at deployment time, and no store can change that |

**The migration.** There is no data to convert: phase 1 stored no entry. On stage B:

1. Read `workspace`. If `workspace.generation === projection.generation`, nothing happens.
2. Otherwise run the boot-only command `workspace-deployment-apply { generation, workspace, entries }`, journaled, whose `entries` are the projection's without `boot`, each checked by the projection's own entry schema, never `unknown`. So an empty projection with no record does nothing: **an empty shell's journal is unchanged**, which phase 0's E2 holds. A project created on an empty shell creates the `workspace` row then.
3. It upserts each entry, keeping each record's `overrides`; sets `listed` to the generation; and sets `listed: null` on a record the projection no longer lists, and keeps it, so its `app-<instance>` table and its documents' records survive a deployment that drops and later restores it.

**How the kernel uses it.** `loadApps` takes `deployment.apps` as it does, each entry overlaid with its record's `overrides`, read by `workspaceApps` in stage A. **A disabled instance is a gate, not an omission:** `loadApps` reads it as any other, so a replay, whose fresh store has no overrides until a `workspace-app-set` entry arrives, registers the same commands. `gated` and `apps.open` read `workspaceApps` at each call, and answer `APP_DISABLED`, so `workspace-app-set { enabled }` takes effect at once, in the session and in a replay alike, and no reload is needed. It is listed with `state: 'disabled'`, a new `AppStateV2`, in the workspace's app list and not the rail, and its commands are left out of the palette. A disabled mounted instance is not discovered; enabling one runs `app-instance-refresh`. In stage A, `bootApps` reads `workspace-app` too, so the rail is right in the first frame.

**Commands.** Only `enabled`, `order` and `title` can change. **E10 scans every registered command's input schema that a person, app or agent can reach for `command`, `cwd`, `url`, `bearer`, `transport`, `route`, `projects`, `space`, `expose`, `audience` and `prefix`,** and finds them only on mounted tools, which are the server's own; and it **calls** `workspace-deployment-apply` on both interfaces and through a port, each answering `COMMAND_NOT_FOUND`. So D55's and D56's "no command, app or agent may write it" hold by construction, as phase 1's E4 held for its three: **for a person, an agent and a view. For a native app it is a contract** (D54), since a module in the page can open the store's IndexedDB itself, as D77 says of `context.store`.

`workspace-app-set` has no role check in phase 2, since every reacher is a member. Phase 3 restricts it to an owner, by the seam of [3.4](#34-the-order-of-a-call-d72).

### 4.2 The deployment file, version 2

`manifest/schemas/deployment.v2.json`. `readDeployment` reads 1 and 2; a version 1 file means `{ id: "personal", name: "Personal" }` and `base_path = "/"`. Everything of phase 1's 3.1 stands. It adds:

```toml
deployment_version = 2

[workspace]
id = "acme"          # default "personal"
name = "Acme"        # default: the id, capitalized

[site]
base_path = "/"      # the path this deployment is served under, with both slashes
```

| Refusal | Code |
| --- | --- |
| `workspace.id` off its pattern, or one of the reserved segments of [6.1](#61-the-shapes) | `DEPLOYMENT_WORKSPACE_INVALID` |
| A different `workspace.id` from the one `--out` last held, where `--out` already has a `deployment.json`. A browser's records are under the old id | `DEPLOYMENT_WORKSPACE_CHANGED`, a warning with what it strands |
| `base_path` off `^/([A-Za-z0-9._~-]+/)*$`, or holding a `.` or `..` segment, so `//evil.example/` is refused | `DEPLOYMENT_BASE_PATH_INVALID` |
| An instance id of `p` | `DEPLOYMENT_INSTANCE_RESERVED`: it would read as a URL's project segment |
| A `projects` slug off the project pattern | `DEPLOYMENT_PROJECT_INVALID` |
| A mounted `team` entry with no `projects` | `TEAM_INSTANCE_WHOLE_WORKSPACE`, a warning in `deployment check`: "This team instance serves every member of the workspace" |

`writeDeployment` adds to phase 1's 3.2: it rewrites `index.html`'s `src` and `href` from `./assets/` to `<base_path>assets/`, and writes `404.html` as a copy of the rewritten `index.html`, so a static host that serves `404.html` for a missing path serves the shell ([6.2](#62-a-deep-link-and-the-base)).

### 4.3 The project store

```ts
export interface ProjectV1 {
	id: string;              // `prj_...`
	workspace: string;
	slug: string;            // `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, unique, not `all`, and fixed once created
	name: string;            // 1 to 80 characters
	icon: string;            // one of ICONS_V1, default 'system/folder'
	status: 'active' | 'archived';
	access: { mode: 'workspace' } | { mode: 'restricted'; members: string[] };
	/** Raised when `access` changes. Unused until the collaboration service revalidates a session on it (D46). */
	memberEpoch: number;
	createdAt: number;
	updatedAt: number;
	createdBy: string;
	updatedBy: string;
}
```

- **A slug is fixed.** It is the URL and what a deployment's `projects` and `space` name, so `project-update` changes `name` and `icon`, and has no `slug`. A rename keeps the URL. Changing one, with redirects, is a follow-up. `all` is refused, since `document-list` takes it. `PROJECT_SLUG_TAKEN` says a slug exists, including a restricted project's: accepted for phase 2, where one person holds the store, and named for phase 3.
- **Membership.** Inherited from the workspace unless the project restricts it (architecture section 7). `members` holds actor ids; `project-create` and `project-update` refuse a `restricted` list without the caller, `PROJECT_MEMBER_SELF_REQUIRED`, since nobody could fix it afterwards in phase 2. Phase 3 replaces who may change this.
- **The cache.** `ProjectCache`, in first paint, is a `Map` loaded by one `list` at stage A and written through by the late commands. `decideAccess` and the rail read it, so a call costs no store read. A hosted host's second writer is phase 6's concern, and the cache's interface is the seam.
- **Archive.** No delete in phase 2: nothing here needs one, and a project's resources would need a retention rule. `project-archive` hides it from the switcher and refuses mutations in it ([3.4](#34-the-order-of-a-call-d72), step 6); reads stay, so `project-get` and its documents can be read, and `project-restore` is its undo. Archiving the active project moves the active scope to the workspace, in the same command.

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `project-create` | mutation | `{ name; slug?; icon?; access? }`. A missing `slug` comes from `name`, lower-cased, with runs of anything else as `-`, and leading and trailing `-` trimmed | `ProjectV1`. Undo: `project-archive` |
| `project-list` | query | `{ status?: 'active' \| 'archived' \| 'all'; limit?: 1 to 200; offset? }`, default `active` | `{ projects: ProjectV1[], total }`, only those `decideAccess` allows. Through a port, each row is `AppProjectV1`, with no `access`, `memberEpoch`, `createdBy` or `updatedBy` |
| `project-get` | query | `{ project }`, an `id` or a slug | `ProjectV1`, or through a port `AppProjectV1` |
| `project-update` | mutation | `{ project; name?; icon?; access? }` | `ProjectV1`. Undo restores the previous values |
| `project-archive` | mutation | `{ project }` | `{ project, scope }`. Undo: `project-restore` |
| `project-restore` | mutation | `{ project }` | `{ project }`. Undo: `project-archive` |
| `project-summary-get` | query | `{ project }` | [7.7](#77-project-summary) |
| `scope-get` | query, first paint | `{}` | `{ scope: ScopeV1, workspace: { id, name }, project: ProjectV1 \| null }`. **Through a port: `{ scope }` alone, the call's effective scope, with no record,** so a workspace-only app narrowed under Atlas learns no project, and no app reads `access.members` |
| `scope-set` | mutation | `{ project: string \| null; app?: string }`, an `id` or a slug; `app` opens that instance after the switch, for the undo | `{ scope, previous, active, app: 'kept' \| 'left' }`. Undo: `scope-set { project: previous, app: left }` |
| `workspace-get` | query | `{}` | `WorkspaceV1`, or the projection's values when no row exists yet |
| `workspace-app-list` | query | `{}` | `{ apps: WorkspaceAppV1[] }`, the deployer's keys read-only |
| `workspace-app-set` | mutation | `{ instance; enabled?; order?; title? }` | `WorkspaceAppV1`. Undo restores the overrides. It takes effect at once ([4.1](#41-the-workspace-store-d73)) |
| `workspace-deployment-apply` | internal | `{ generation; workspace; entries }` | `{ added, changed, unlisted }` |
| `section-open` | mutation | `{ section: 'projects' \| 'documents'; path?: string }` | `{ section, previous }` |
| `section-get` | query, first paint | `{}` | `{ section: string \| null, path: string }` |
| `app-route-set` | mutation | `{ instance; path: string (0 to 1024) }`. Called `path` in its input so E10's scan for a mount's `route` stays exact. A `.` or `..` segment is `APP_ROUTE_INVALID`, since `new URL` would resolve it into another project or app | `{ path }`. Undo restores |

All have `SHELL_EXPOSE`. `scope-get` and `section-get` are in first paint; the rest are late commands, which use the lean layer too, so **an empty shell never loads classic Zod**. **`scope-get` and `section-get` join `UNJOURNALED_COMMANDS`,** with `palette-search`: each runs at every re-read of the rail, reads memory and writes nothing, and journaling it would add entries to an empty shell's boot, which phase 0's E2 holds unchanged. The chrome reads `app-list` at boot only when the boot record lists an app, as phase 1's `prepare` did. **The domains** `workspace`, `section`, `editor` and `new` join `SHELL_DOMAINS_V1`, and the ids `p` and `workspace` are refused with `MANIFEST_ID_RESERVED`. `INTERNAL_COMMANDS` gains the boot-only commands and the new port refusals, `app-scope-refuse` and `app-embed-refuse`.

**The record `loam.apps`** becomes `{ active: string | null; section: string | null; path: string }`, a persisted record with fewer keys reading their defaults. `path` is the active app's or section's `<rest>`, persisted so a reload at `/` restores it, and cleared by `app-open`, `section-open` and any change of scope.

**A switch's rules** (the proposal's "Switching project keeps the active app when it supports the new scope and returns to the projects section when it does not"), atomically, in `applyScopeChange` ([3.4](#34-the-order-of-a-call-d72)), as a switch's overlay rules run inside `app-open`:

| Before | Changing to | Active app | Then |
| --- | --- | --- | --- |
| A dual-scope app | A project, or none | Kept | Its surfaces are recreated ([7.6](#76-surfaces-on-a-scope-change)) |
| A project-only app | Another project | Kept | The same |
| A project-only app | None | Left | The projects section |
| A workspace-only app | A project | Left | The project's home in the projects section |
| A workspace-only app | None | Unchanged | Nothing: it was already at workspace level |
| No app, a section | Anything | None | The section reads the new scope |

"Left" dismisses the app's overlays as `app-switch`, as phase 1's section 8 does. A selection is cleared on any change of scope. A `shell`-owned modal refuses the switch with `OVERLAY_MODAL_BUSY`, but for `reason: 'actor'`, which cancels it.

## 5. The store grant (D77)

"Writes carry the scope; reads are filtered by it." `AppStoreV1`'s signature does not change, so no app does either. `createAppStore` takes the call's effective scope.

```ts
/** Workspace level keeps phase 1's id, so a phase 1 store needs no migration. */
export function storeRecordId(scope: ScopeV1, key: string): string {
	return scope.project === undefined ? key : `p~${scope.project}~${key}`;
}
```

| Rule | Detail |
| --- | --- |
| Key | `checked` also refuses a key starting `p~`, with `TypeError`, as it refuses `.` and `..` |
| Record | `scope` is `ScopeV1`, as phase 1 left room for. `scopeKey` is new: `w`, or `p:<project>`, a string so `queryRows` can filter on it. An old record's `scope: null` and missing `scopeKey` read as the workspace |
| `list(prefix?)` | `adapter.list(table, { scopeKey })`, then the prefix. A phase 1 row has no `scopeKey`, so workspace level also reads rows with `scope: null`: the list reads the table with no filter at workspace level and drops every row with a `p~` id. Project level filters |
| `delete`, `get` | By `storeRecordId` |
| The port's `store` | For the chrome and tests: the active scope, at the moment of each operation. A surface never gets it |
| `dev.loam/store` from a handler frame | Bound to the call's effective scope, as the frame's clock is to its call, by `callId` |
| **A query cannot write** | Today `storeRequest` checks the grant and the call, and not whether the call is a mutation (`apps/handler-frame.ts:146-177`), so a query's handler could write, and an embed could change data through one. With the command's `mutation` false, `put` and `delete` are refused: in a frame `STORE_WRITE_IN_QUERY`, `-32601`, a boundary; in `createAppStore`'s `readOnly` for a native handler, a rejected promise with that code, a contract. No shipped app is affected: hello's and tally's writes are all under `store-write` |
| A workspace-only app | Always workspace level, whatever is active, by narrowing |
| Moving a resource between scopes | The architecture says it is "an app command with undo". An app can only do it from a surface, with two calls at the two levels, since a handler's store holds one scope. Documents move through `document-move`, which the shell does ([documents specification](../2-documents/spec.md#41-commands)) |

**The `projects` and `documents` grants.** Principle 7 gives every app the scope, so `context.scope` needs no grant. A name does:

| Grant | The app gets | Enforced |
| --- | --- | --- |
| `projects` | `context.projects`: `active(): Promise<AppProjectV1 \| null>`, `list()`, `get(ref)`. It may read, never write ("apps never create or delete projects"), and sees no members. `active()` answers the call's effective scope, so `null` for a workspace-only app. `project-list` and `project-get` join what the port may call with this grant | Through the port, for a view; a contract for a native app (D54) |
| `documents` | The [documents specification](../2-documents/spec.md#11-the-documents-grant) | The same |

`GRANT_UNAVAILABLE` for those two goes away as each step serves it. `GRANT_CATALOG_V1` already says `servedFrom: 2`.

## 6. The URL scheme (D74)

### 6.1 The shapes

Relative to the deployment's base, as the architecture has them:

| Path | Route | Scope |
| --- | --- | --- |
| `/` or `/index.html` | `root` | The persisted scope |
| `/<workspace>` | `workspace` | `{ workspace }` |
| `/<workspace>/~/<section>/<rest...>` | `section` | `{ workspace }` |
| `/<workspace>/p/<project>` | `project`, the project's home | `{ workspace, project }` |
| `/<workspace>/p/<project>/~/<section>/<rest...>` | `section` | `{ workspace, project }` |
| `/<workspace>/p/<project>/<instance>/<rest...>` | `app` | `{ workspace, project }` |
| `/<workspace>/<instance>/<rest...>` | `app` | `{ workspace }` |
| Anything else | `not-found` | The persisted scope |

- **Reserved.** A `workspace` may not be `apps`, `assets`, `mounts`, `sandbox`, `p`, `~`, `deployment.json`, `index.html` or `404.html`, which a deployment's own files use, or which would read ambiguously. An instance may not be `p` ([4.2](#42-the-deployment-file-version-2)), and `~` is off its pattern.
- **`<project>`** is a slug, `<instance>` an instance id, `<section>` `projects` or `documents`. `<rest>` is percent-encoded per segment and joined with `/`, and reaches an app as its `route`.
- **Documents** are `.../~/documents/<document id>`: [documents specification](../2-documents/spec.md#51-where-it-shows-d80).
- **A workspace that is not this one** is `not-found`, in any shape, so `/elsewhere` shows "Nothing here", which `web/test/browser/layout.test.ts:276-284` holds.
- **What each means for a person.** `/<workspace>` shows the same as `/`. `/<workspace>/~/projects` lists projects. A project's home is `/<workspace>/p/<slug>`.

```ts
// chrome/src/router.ts, first paint
export type RouteV1 =
	| { kind: 'root' }
	| { kind: 'workspace'; workspace: string }
	| { kind: 'section'; workspace: string; project?: string; section: string; rest: string[] }
	| { kind: 'project'; workspace: string; project: string }
	| { kind: 'app'; workspace: string; project?: string; instance: string; rest: string[] }
	| { kind: 'not-found' };

export function parseRoute(url: string, base: string): RouteV1;
export function formatRoute(route: RouteV1, base: string): string;
```

`parseRoute` splits on `/` and never decodes a segment past `decodeURIComponent`, whose failure is `not-found`. **`formatRoute` refuses `.` and `..` in any segment,** as `app-route-set` does, because `encodeURIComponent('..')` is `..`, and `new URL` would walk it. A test holds `formatRoute(parseRoute(u)) === u` for a table of each shape but `/index.html` and `not-found`, and a table of hostile paths: `..`, encoded slashes, `__proto__`, a 10,000-character segment, each `not-found` or literal text. **The URL is untrusted input,** so every segment that names something is looked up, and is never put in markup but as text.

### 6.2 A deep link and the base

This is new work the seam did not foresee, and it is the reason D74 exists.

- **Today's relative paths break on a deep link.** `vite.config.ts` has `base: './'`, so `index.html` loads `./assets/...`, and at `/acme/p/atlas/hello` that resolves under `/acme/p/atlas/`. `<base>` cannot fix it, since the CSP has `base-uri 'none'` (`index.html:7`), and `fetch('deployment.json')` (`main.ts:40`), `document.baseURI` (`ports.ts:39`, `router.ts:57`, `shell.ts:336`) and a mount's route (`mounted.ts:717`) resolve the same way.
- **The rewrite.** `loam deployment write` writes `base_path` into `index.html`'s `src` and `href` ([4.2](#42-the-deployment-file-version-2)). `vite build`'s own `dist` keeps `./`, so it is servable from any directory at its root, as today, and a deep link there is a 404, as today.
- **The base at run time.** `web/src/main.ts` computes `const base = new URL('../', /* @vite-ignore */ import.meta.url).href`, since the entry is always `assets/index-*.js` under the deployment's root, and uses it for `deployment.json`. `webPorts` takes it for `baseUrl`, and `mountShell` takes `base`, for the router and `home`. **Nothing reads `document.baseURI` any more:** a test scans `web/src` and `chrome/src`. Dynamic imports already resolve against the chunk. `importNative` already takes an absolute URL, and the sandbox's URL is already absolute.
- **The server.** A deployer's host must answer `index.html` for a path with no file, and answer `200`. `404.html` covers the hosts that have only that. Phase 6's hosted lane serves it, and its `distribution` documents both, with `frame-ancestors`.
- **The harness.** `serveDeployment` gains `basePath?`, which serves the site under that prefix, and that fallback: a `GET` with `accept: text/html` of a path with no file answers `index.html`, so a route segment with a dot still works. `serveDist` stays strict.

### 6.3 The scope and the URL

**Two truths, one rule: a person's navigation is a command, and a command moves the URL. All of this is the chrome's;** the kernel holds state and refuses what it must.

- **URL to state.** `createRouter` intercepts a same-origin navigation, as it does, and calls `onRoute(route, { replace, info })`. The chrome compares `route` with `scope-get`, `app-list`'s `active` and `section-get`, and for what differs calls `scope-set`, then `app-open`, `section-open`, `app-route-set` or `document-open`, each a journaled command, in that order. An `app` route whose instance does not support the scope, or does not exist, goes to `not-found`.
- **State to URL.** On a kernel event with `scopeChanged` or `mainChanged`, from anyone, whatever the command ([3.4](#34-the-order-of-a-call-d72), [11.1](#111-kernel-interface-version-2)), the chrome formats the state, and if it differs from `location` calls `navigation.navigate(url, { history: mainChanged, info: 'loam-state' })`, or `history.pushState` or `replaceState` where the API is absent. `mainChanged` is `'push'` or `'replace'`, and the kernel sets it wherever `loam.apps` or the active scope's active tab changes: `editor-activate` and `editor-close` say `replace`, and so do `document-trash` and `document-move` when they close the active tab; the rest say `push`. So a sign-out, an archive and a trashed document's closed tab each move the URL, with no list here to keep. A handler seeing `info === 'loam-state'` does nothing else. A `layout-*` or a query never moves the URL.
- **While a route is being applied, state to URL is suspended,** by a `#applying` count in the router's owner, and compares once at the end. So a traverse's `scope-set` then `app-open` does not push between them, which would destroy forward history. E8 holds `history.length`, and that Forward still works.
- **Back and forward** are navigations, so they run commands, and the journal records them as what they did.
- **Boot.** The record `loam.scope` is `{ project: string | null }` by id, read-only through `view-state-set` as `loam.apps` is, with `VIEW_STATE_READ_ONLY` naming `scope-set`. `mountShell`'s host parses the URL first and passes `initialScope`:
  1. **Stage A.** The URL's project slug, when `decideAccess` allows and the cache has it, is the active scope in memory, unjournaled, for the first frame. Otherwise the persisted record, and otherwise the workspace. A named project that fails shows `not-found`, the same for missing and refused. `not-found` paints as phase 0 has it.
  2. **Stage B.** If that differs from the record, the chrome runs `scope-set`, so the change is journaled, and then `app-open` or `section-open` for the route. `scope-set`'s `previous` is the persisted record's, so the entry is what a replay computes, though stage A already held the project in memory.
  3. **`/`.** If the state names something to show, `navigation.navigate(format(state), { history: 'replace', info: 'loam-state' })`. If not, `/` stays, with the landing, as phases 0 and 1 have it, and an empty shell's URL does not move.
- **Reload** of any shape restores it, with the same first frame, **but for a restricted project under the Mock:** `web/src/host.ts:106` builds a new `MockAuthAdapter` per page, so a reload signs out, stage A's `decideAccess` refuses, and the person lands at workspace level until they sign in again. A URL naming that project shows `not-found` until then. A provider whose session survives a reload is phase 3's.
- **`shell-open`** is phase 5's, and takes a `ResourceLinkV1` by this scheme ([documents specification](../2-documents/spec.md#91-a-resource-link)).

## 7. The rail, the projects section and the parts

### 7.1 The bands (D75)

D5 and D29, with what the proposal adds. The rail has **two bands, with a divider**:

| Band | Holds, in this order |
| --- | --- |
| **Top** | 1. Projects, the section. 2. The project switcher. 3. Documents, the section. 4. Apps with `project` in their levels that belong here, by the table below, sorted by `order` then instance |
| **Bottom** | Apps with no project at this moment, by the table below, sorted the same way. Then, last and outside the bands, Settings, as phase 0 has it |

| Levels | No active project | A project is active |
| --- | --- | --- |
| `["workspace"]` | Bottom | Bottom |
| `["project"]` | **Top, dimmed**: `aria-disabled`, and its tooltip says `Choose a project to open <title>` | Top |
| `["workspace", "project"]` | **Bottom** ("otherwise in workspace scope", D29) | **Top** ("under the project when one is active", D29) |
| A mounted instance with `projects` | As `["project"]`. Dimmed too when the active project is not in `projects`, with the tooltip `<title> is not available in <project>` | |

- **One entry per app.** A dual-scope app moves with `moveBefore` where the browser has it, which keeps its state and focus, and otherwise by re-inserting it and restoring focus if it held it, since re-parenting blurs and reconnects. E3 tests that a focused entry keeps focus.
- **Open with the owner: D29 with no active project.** The table's bottom band follows D29's "otherwise in workspace scope" and the proposal's text. D5 says the bottom band "lists apps that never take a project", and D29's consequence says "the band says whether the app cares about the project". If the owner reads it as staying in the top band, the change is one row of `bandFor` and E3's expectation.
- **A dimmed entry** stays in the Tab order. A press does nothing but show its tooltip, and `app-open` from anyone answers `SCOPE_PROJECT_REQUIRED`, journaled.
- **`rail: false`** apps, a document-only plugin such as `notes`, have no entry. `app-list` still lists them, with `rail: false`, since a person finds them through New and the documents section.
- **A disabled instance** has no entry ([4.1](#41-the-workspace-store-d73)).
- **With no apps at all,** the rail holds Projects, the switcher, Documents, the divider hidden, and Settings. **This changes phase 0's "rail holds only the settings entry",** for an empty shell, so step 6 amends those tests, and `design.md`'s line for `loam-rail`. The landing's text stays. Principle 1 stands: a section aggregates across apps and is the shell's.

### 7.2 The elements

Each under the [component checklist](../../design.md#the-component-checklist), with a line in `design.md`'s component list and a Specimen fixture in `apps.specimens.ts`, in the three themes and two densities.

| Element | Where it loads | What |
| --- | --- | --- |
| `loam-app-entry` | Moves from `surfaces` to first paint | As phase 1, with `dimmed` |
| `loam-section-entry` | First paint | The same element's shape for Projects and Documents, with `aria-current` on the active section. No tooltip of its own: the shared one |
| `loam-project-switcher` | The button in first paint; its list in the `switcher` chunk, on first press | A `button` with `aria-haspopup="listbox"`, `aria-expanded` and the visible label's `aria-label` of `Project: Atlas`, or `Project: none`. Its icon is the project's, on the selected colors when one is active. Pressing opens a `violet-popover` with a `violet-listbox` of `project-list`, and first `No project`, then the projects, each with its icon, and last `All projects`, which opens the section. Selecting calls `scope-set` or `section-open`; Escape closes and returns focus. The list makes a pressed row active on `mousedown`, as the console does, for #712's `handleFocus` |
| `loam-tooltip` | First paint | One shared element, `popover="manual"`, in the top layer, positioned by CSS anchor positioning with `anchor-name` set through CSSOM, which `style-src 'self'` allows ([#709](https://github.com/lushly-dev/afd/issues/709)). **One in each of `loam-rail`'s and `loam-tabbar`'s own shadow roots, with each entry's host as the anchor,** because anchor names are tree-scoped |
| `loam-projects-section` | `sections` chunk | [7.7](#77-project-summary) |
| `loam-tree` | `documents` chunk, for a `tree` sidebar | A tree over `violet-tree`, in the same way `loam-list` is over the listbox |

- **`loam-rail` and `loam-tabbar`** gain two `ul`s, `aria-label="Project apps"` and `aria-label="Workspace apps"`, and keep `<slot>` out: `RailBands`, a controller in `chrome/src/rail/`, owns the entries in first paint, reads `app-list` and `scope-get`, and re-reads on an event with `scopeChanged` or `mainChanged`, after `project-*` and `workspace-app-set`, and on `appsReady`. `AppSurfaces` stops putting entries in the nav.
- **The divider** is `color.border.subtle` between the lists, `aria-hidden`, since the lists' names say what it says.
- **Compact.** `loam-tabbar`'s order is the same, one scrolling line, with the divider vertical. The switcher's list opens as the palette's list does, as a modal drawer's list.
- **The title bar's** first text stays `Loam` in phase 2. A workspace switcher ("workspace ▾" in the proposal's drawing) has nothing to switch to until phase 3, so it is named here as the seam and left out; `document.title` and the status bar name the workspace.
- **F6's order** is unchanged: the rail is one stop.

### 7.3 Entries and bands

`bandFor(entry, scope, projects)` in `chrome/src/rail/bands.ts` is pure and unit-tested over every row above, and sorts with one comparator, which is R8's seam.

### 7.4 Sidebar, header and status bar

- **A dual-scope app's sidebar (D29).** With a `list` or `tree` sidebar and an active project, the shell renders two groups, each a `region` with a heading: `In <project name>`, calling the command at the active scope; and `In <workspace name>`, calling it with `level: 'workspace'`. So "its workspace resources and project resources kept apart in its sidebar" needs no code in the app. With no project, one list, no heading, as phase 1. A project-only or workspace-only app has one list. A `custom` sidebar gets `scope` and does it itself.
- **A selection** gains its level: `app-selection-set { instance, id, level? }`, `app-selection-get` answers `{ id, level }`, the surface element gets `selectionLevel`, and a view gets `dev.loam/selectionLevel`. Main calls its command at that level, through `level`, which in `/view` becomes `_meta["dev.loam/level"]` ([3.2](#32-the-field)).
- **`tree`.** `ui.surfaces.sidebar.shape = "tree"`, served now. Its command takes `{}` and returns `{ items: Array<{ id; title; description?; children? }> }`, to a depth of 8 and 2,000 nodes, or the part shows `SIDEBAR_RESULT_INVALID`. Selection as a list.
- **The header.** Phase 1 renders a title and actions, when declared. A `loam-part-header` now also shows breadcrumbs when `ui.surfaces.header` is declared, as `violet-breadcrumb`: the workspace, the project, the app, then each segment of `route`, as text, each ancestor a link by the URL scheme. An app supplies no labels in phase 2: its route's segments are what it has.
- **The status bar's left items** (`status`, "Left: shell"). In first paint: `<workspace name>`, and `<project name>` when one is active, in `loam-status-item`, before the actor. Each is text, with the project's item a button to its home.
- **`document.title`** is `<app or section> · <project> · <workspace>`, leaving out what is absent (WCAG 2.4.2).

### 7.5 Overflow and tooltips (#709)

The rail's lists scroll with `overflow-block: auto` and `scrollbar-width: thin`. Tooltips leave the list for `loam-tooltip`, which is why it could not scroll before (9.6). The settings entry and its tooltip move to the same element, which saves its CSS in `app-nav.ts:75-96`. Hover, focus and Escape behave as phase 0's tooltip does (WCAG 1.4.13). A test renders 40 entries at a 600-pixel height: every entry scrolls into reach by keyboard, and its tooltip is not clipped.

### 7.6 Surfaces on a scope change

**Nothing of Atlas stays under Beacon.** On an event with `scopeChanged`, whichever command caused it, for a kept app:

- Every surface of the app is dropped and recreated, each with a new [surface port](#36-a-surfaces-port-d83): mounts, parked or not, and a view, through `ui/resource-teardown` as a switch does. `activate` does not run again. So an app needs no scope-change code; it reads `scope` when it is created. Phase 1's parking stays what it was, across an app switch within one scope.
- `LoamSurfaceElementV1` gains `scope?: ScopeV1`, and `route?: string`, assigned before it connects. A view gets `dev.loam/scope` and `dev.loam/route`, in `hostContext`, and a change of route as `host-context-changed`. A route is a property change and recreates nothing.
- Status items, overlays and keybindings follow the app, as a switch has them, except that a kept app's keep their chords. A value of `status-item-set` is per instance and scope: `statusItems` in `app-get` answers for the active scope.
- **Per-app layout** is the architecture's "keyed by app and scope". `appLayoutId(instance, project?)` is `loam.layout.<instance>` at workspace level, so phase 1's records are kept, and `loam.layout.<instance>@<project id>` in a project. A workspace-only app has only the first. **The record registers on first entry**, with the manifest's preset, and then `viewState.hydrateOne(id)` (step 0b) reads a persisted one, since `hydrate` reads a whole category and would write over what is in memory. Sections have `loam.layout.~projects` and `loam.layout.~documents`, registered in stage A. `isLayoutId` already covers these.

**AFD, step 0b.** `ViewStateRegistry.hydrateOne(id): Promise<void>` in `packages/view-state/src/registry.ts`, the same read as `hydrate` for one registered id, by `adapter.get(table, id)`, ignoring a missing record, with a test and a changeset.

**Notes from step 0b's reviews, for steps 4 and 6.**

- **Await `hydrateOne` before any `set` or `replace` on that id.** It applies the record over the handler's state, so a `layout-set` that lands while the read is pending is lost in memory, while its scheduled write still reaches the store, and the layout flips at the next reload. A `set` still inside the debounce when the read starts does the same, since the read returns the older row. A review reproduced this on `MemoryAdapter`. `hydrate` has the same gap, but it runs before the kernel takes calls; first entry, and a `layout-*` that registers a record ([3.4](#34-the-order-of-a-call-d72)), do not. A guard in the registry would not fit step 0b's allowance, so the registry documents the order and the kernel must keep it, holding calls on that id until the promise settles.
- **Choose what an invalid record does.** `shell-state.ts`'s handlers tolerate one only while its `hydrating` flag is set, and only `state.hydrate()` sets that. Stage A's step 5 and this section call `viewState.hydrateOne` directly, so an invalid record throws in the handler, is caught, and logs `Hydration failed`, where `hydrate` ignores the same record silently. The state is kept either way. The step adding the first caller chooses: a `state.hydrateOne` under the same flag, silent like `hydrate`, or the warning.

### 7.7 Project summary

**The section.** `loam-projects-section`, in main, on `/<workspace>/~/projects` and `/<workspace>/p/<project>`. Main shows it when `section-get` says so, and no app is active: `app-open` clears the section and `section-open` clears the active app, in `loam.apps`, which gains `section: string | null`, and a persisted record with none reads `null`. Its declared parts are none but main, so `loam.layout.~projects` has every other part closed.

- **The list.** `h1` `Projects`; a filter field; a table of name, status, updated; `New project` opens an inline form of name and slug, with the slug's rule in its help text, calling `project-create`, whose failure shows beside its field; each row links to the home. A checkbox `Show archived`. Empty: `No projects yet`, with the form open.
- **The home.** `h1`, the project's name, its status, whether its access is the workspace's or restricted, with `Rename`, `Archive` or `Restore`; and then one card per app with a summary, then one card, `Documents`, by type ([documents specification](../2-documents/spec.md#83-in-a-project)).

**The surface.** `ui.project_summary = { command = "tasks-summary" }`, for `native` and `view` manifests whose levels include `project`. The command takes `{}`, must have `effects = ["inspect"]`, and must need no input, else `MANIFEST_SUMMARY_INVALID`. It runs at the project's scope. It returns:

```ts
export interface ProjectSummaryV1 {
	counts?: Array<{ label: string; value: number }>;   // at most 8; a label of 1 to 40 characters
	recent?: Array<{ title: string; updatedAt?: number; link?: ResourceLinkV1 }>;   // at most 10; a title of 1 to 120
	links?: Array<{ label: string; link: ResourceLinkV1 }>;   // at most 6
}
```

**`project-summary-get`.**

- `decideAccess` on the named project, then for each enabled app with a summary, in parallel, `runAs(command, {}, { signal }, { parent, scope })` with a 2,000-millisecond deadline. So each is **a nested query**, journaled with `parent` when it ends. Nothing mutates: a handler's write under it is `STORE_WRITE_IN_QUERY` ([section 5](#5-the-store-grant-d77)), a boundary for a view and a contract for a native app. `kernel/src/late/project-summary.ts`.
- **On replay, `project-summary-get` answers from its record:** it joins `REPLAY_RECORDED_QUERIES`, since a wall-clock deadline decided its result and a call that timed out left no nested entry to answer from. Its answer depends on what has loaded, as the others there do.
- The result is `{ project, summaries: Array<{ instance; title; icon; summary?: ProjectSummaryV1; error?: { code; message; suggestion } }> }`, sorted by the rail's order. One app's failure is that row's error, and the rest stand: `PROJECT_SUMMARY_TIMEOUT`, `PROJECT_SUMMARY_INVALID` (`readProjectSummary`, hand-written, reads each field for what it is, and drops what is over a bound), or the command's own failure.
- **The shell never reads resources,** only what each app returns (architecture section 7). What an app says is text: `loam-projects-section` renders with bindings, never markup, and a link is navigation, never execution (architecture, "Resource link").

### 7.8 Accessibility of what moves

- A scope change announces through **a visually hidden `role="status"` in `loam-shell`,** in first paint, because the toast region is in the `surfaces` chunk, which an empty shell does not load: `Project: Atlas` or `No project`, and what was left.
- A band change is not announced. `aria-current` and the lists' names carry it, and focus does not move.
- `scope-set` from the switcher returns focus to the switcher. If the app was left, focus goes to main's `h1`, as phase 1 moves focus from a surface that left.
- Screen-reader passes stay open with #708.

## 8. The manifest, version 2 (D76)

### 8.1 One validator, two versions

Phase 1's 2.2 has "a later phase that adds a key writes `app-manifest.v2.json` with `manifest_version: 2`, and the kernel reads both." It does, with **one compiled validator**, because `validate.generated` is already the largest chunk the shell has and a second copy would double it:

- `app-manifest.v2.json` is v1 with the keys below and `"manifest_version": { "enum": [1, 2] }`.
- A rule in `loam-rules.ts`, `manifest-version-keys`, refuses any v2-only key under `manifest_version = 1`, with `MANIFEST_SURFACE_UNAVAILABLE`, naming the key and the suggestion `Set manifest_version = 2.`. So a v1 manifest means what it meant, and phase 1's refusal keeps its code, with a new suggestion. Its "naming phase 2" case in `profile-cases.json` and E7's test are amended by step 3.
- `app-manifest.v1.json` stays committed, unused by the reader, and a test holds that every valid case of it is valid under v2, and reads the same.
- `readManifest`'s result is `ManifestV2`; a v1 document reads with the new keys absent.
- `scripts/plugin-manifest.test.mjs` runs the profile comparison on v2. `SHELL_DOMAINS_V1` gains its four, in step 4, and the surface `catalog` stays version 1, since 8.3's keys were already named there.
- A package's `app pack` writes the version its TOML has. Hello and tally stay version 1, as the proof, and only `tasks`, `notes` and `checklist` are version 2, with hello's manifests raising only if a step needs one.

`shell-info-get` reports `kernelInterface: 2`, `manifestVersion: 2`, `storeInterface: 1`, `documentRecord: 1`, `editorState: 1`, and keeps `appProtocol: 1`, `surfaceCatalog: 1`, `compositionLibrary: 1` and `sdk: 1`: **every addition to the SDK is optional to an app, so `protocol` and `sdk` do not move,** and a phase 1 package loads unchanged.

### 8.2 Conformance

P3 gives Loam `app`, `native`, `view`, `ui` and `agent`, so every new key is under `app` or `ui`, and nothing is added to the core's `commands[]`. That is why `resource_keys` is in `app`, keyed by command name, and not `commands[].resource_key`, which a first sketch had, and which the profile test refuses.

### 8.3 New keys

| Key | Rule |
| --- | --- |
| `app.resource_keys` | A map of a declared command's name to a property of its input schema, `MANIFEST_RESOURCE_KEY_INVALID` otherwise. Needs `store`. Refused for `mounted` |
| `ui.surfaces.sidebar.shape` | Adds `tree`, for native and view, needing `command`. Its row in `refusal-map.ts` goes |
| `ui.project_summary` | `{ command }`, [7.7](#77-project-summary). `MANIFEST_SUMMARY_INVALID`. Refused for `mounted`, as its commands are unknown until discovery |
| `ui.documents`, `ui.new` | [Documents specification](../2-documents/spec.md#2-the-document-type-registry) |
| A rail-less plugin | No new key. A manifest with `ui.documents`, and no `ui.surfaces.rail`, `sidebar` or `main`, has `rail: false`. Phase 1's "absent, a default entry" stays for all others |

`REFUSALS_LATER` for those keys in `refusal-map.ts:103-105` goes. `ui.account`, `settings`, `experiments`, `menus` and `automations` keep theirs.

## 9. Mounted instances

### 9.1 An instance and its projects (D55)

Phase 1 recorded `projects` and `space`, and phase 2 acts on them. They name **slugs**, as a deployer writes them before a project exists: a slug no project has yet is a warning at load, `INSTANCE_PROJECT_UNKNOWN`, and the instance is simply unavailable there. It takes effect when the project is created with that slug.

- **`projects` absent:** the whole workspace, under `app.scope_levels`.
- **`projects` present:** the instance works only in those projects, so its levels are `["project"]` whatever its manifest says, and `deployment check` warns `INSTANCE_LEVELS_OVERRIDDEN` if the manifest said `workspace` alone.
- **D55's rule.** "A Loam instance may mount a team Umbel instance only where every member of its projects may read all of it. Access is decided in Loam by project membership." A call reaches the instance only after `decideAccess` allowed the project, on [3.4](#34-the-order-of-a-call-d72)'s second line, so Loam's project membership is the access decision. Umbel still sees one principal, so the notice `TEAM_INSTANCE_SINGLE_PRINCIPAL` stays, in `app check`, the console and `deployment check`: whether every member may read all of it is a deployer's statement the shell cannot verify.
- **A limit, stated.** With no roles in phase 2, whoever reaches the kernel can create a project with a slug a deployment lists, or edit a project's `members`. That makes "every member" no longer only the deployer's statement. It cannot matter yet, since phase 2 has one person per store and no hosted lane, so **no multi-member deployment can exist until phase 3 restricts both to an owner, which is now a condition of phase 3's specification**, in [its row](../../STATUS.md) and the follow-ups below. D55 itself is not changed.

### 9.2 A call

`apps/mounted.ts`'s `call` adds, before `pinMountedInput`:

1. **Listed.** `entry.projects` set, and the effective scope's project's slug not in it, or no project: `MOUNT_PROJECT_NOT_LISTED`, journaled, with the suggestion `Switch to a project this instance serves: <slugs>`.
2. **Pinned.** `pinMountedInput(entry, scope, schema, input)` at `mounted.ts:616`, with `scope` as `{ project: slug }` of the effective scope, or `null`. The function does not change, and neither do its tests, so **"phase 2 only supplies the scope"** holds. Its refusal stays `MOUNT_SPACE_PINNED`.
3. **Scope on the wire.** `MountTransportV1.callTool(name, args, signal, meta?)` gains `meta`. The handler passes `{ "dev.loam/scope": context.scope }` on every `tools/call` of a command, through `afd-call` too, and nothing on `afd-help`, `afd-detail` or discovery, since discovery is not scoped. `web/src/mount.ts:140-146` adds `_meta: meta` to its `params`, and `StreamableHttpTransport.send` already hands `params` to the SDK.

So: **a server that declares `dev.loam/scope` sees it, and validates it, as any AFD server does; a server that does not, such as a stock `umbel` today, drops it** (`spec/context-fields.md`: "Undeclared `_meta` keys are still dropped").

- **It is a claim made by the shell, to a server the shell labels untrusted.** It holds ids, and never a name, and what it tells a server is only which project a person's call runs in, which that server needs for the call. It is journaled as a context field. A deployer who wants less sets `projects`.
- **Discovery's `tools/list` does not vary,** and a mounted instance's commands are one set for the deployment.
- **Mapping.** `space = { atlas = "main" }` with `work-hello-greet` in project Atlas sends `space: "main"`, and a person's `space: "other"` is refused. E6 runs that against a real Umbel, through the test-only relay.

## 10. Journal and replay with scope

Recorded by the field ([3.2](#32-the-field)), so these are what changes.

- **Every entry** has `context.scope` when the kernel set one, on both interfaces. It is an id, never a secret, so `journal: true` is allowed (`spec/context-fields.md`).
- **Replay.** `replayKernel` runs stage B inside `createKernelParts`, with `internals.replaying: true`, so its registries hold everything from the first entry, and step 5 of [stage B](#22-two-stages-d69) is skipped: the entries are what ran. The middleware runs as it did, with the same store and project records: an access refusal in the journal is the same refusal in a replay, and a project created by an earlier entry is in the cache by then, with the same id off the tape.
- **The actor.** Replay runs one Mock across the whole journal (`testing.ts:283`), and its session lasts an hour from when the replay signs in, so neither a reload nor an expiry would match the session. So `KernelPartsInternals.actorOf(traceId)` gives the journal's recorded actor, and `scopeMiddleware`, running after auth, sets `context.actor` from it. A refusal stays a refusal, and an allow an allow, whatever the Mock holds. The Mock's id, now stable, keeps `createdBy` and a project's `members` the same across a real reload.
- **Boot-only state.** The URL's `initialScope` is the first frame's. What it changes reaches the journal as `scope-set` in stage B, so a replay never needs a URL. A `layout-set` between the stages can land before that `scope-set`: it carries `context.scope`, and `layout-*` reads, and if need be registers, the record from that ([3.4](#34-the-order-of-a-call-d72)), so it replays against the same record.
- **`resetSession`.** Where the trace IDs' base changes (9.5), a replay forgets overlays, selections, the documents specification's dirty tabs **and auth:** it becomes async and signs the replay's Mock out, as a real reload does (`host.ts:106`; `kernel.ts:409` leaves auth alone today), because the boot's journaled `auth-session-get` would otherwise differ, and `REPLAY_IGNORE` does not cover `data.status`. Scope, `loam.apps` and layouts are persisted, so they carry over, as 9.5's rule has it. A reload inside a restricted project is `scope-set { project: null }` in the journal, from stage B.
- **A disabled instance** replays the same, since it is a gate on `workspace-app-set`'s state, not an omission from `loadApps` ([4.1](#41-the-workspace-store-d73)).
- **`REPLAY_RECORDED_QUERIES`** gains `project-summary-get`, for [7.7](#77-project-summary)'s reason. `workspace-deployment-apply` re-executes from its own `entries`, so a replay needs no projection.
- **The undo of a scope-dropping command** is recorded in its result as every other's.
- **The scripted session.** `web/test/browser/scope/session-scope.ts`: create two projects, switch, run each kind of app at each level, a refused cross-project call, archive and restore, and reload in the middle. E4 replays it with zero differences. `SESSION_50`'s calls are unchanged, and `session:record` regenerates it, since `shell-info-get` has new fields, as in phase 1.
- **`diffJournals` does not compare `context` today** (`testing.ts`, its `field`s are command, success, input and result). Step 4 adds `field: 'context'`, so two sessions differing only in scope report a difference.

## 11. The kernel and the SDK

### 11.1 Kernel interface, version 2

```ts
export const KERNEL_INTERFACE_VERSION = 2;

export interface LoamKernelV2 extends Omit<LoamKernelV1, 'version' | 'call' | 'agent' | 'subscribe'> {
	readonly version: 2;
	subscribe(listener: (event: KernelEventV2) => void): () => void;
	call<T = unknown>(name: string, input?: unknown, options?: CallOptionsV2): Promise<CommandResult<T>>;
	readonly agent: Pick<LoamKernelV2, 'call' | 'listCommands'>;
	/** Runs stage B once. The chrome calls it after the first frame; a call may start it sooner (2.2). */
	startApps(): Promise<void>;
	/** Resolves when stage B has ended, however it ended. Never rejects. */
	readonly appsReady: Promise<void>;
	/** Set when the late commands could not load (2.2). */
	readonly lateFailure?: CommandError;
}

export interface CallOptionsV2 extends CallOptionsV1 {
	/** Default: the active scope. See 3.2. */
	scope?: ScopeV1 | 'workspace';
}

export interface ScopeChangeV2 {
	from: ScopeV1;
	to: ScopeV1;
	/** The instance a switch left, if any. */
	left?: string;
	reason: 'scope-set' | 'document-open' | 'project-archive' | 'actor';
}

export interface KernelEventV2 extends KernelEventV1 {
	/** The call's effective scope. */
	scope?: ScopeV1;
	/** The active scope changed in this call, by `applyScopeChange` (3.4). */
	scopeChanged?: ScopeChangeV2;
	/** What main shows changed, and how the URL should follow (6.3). */
	mainChanged?: 'push' | 'replace';
	/** The document an instance command named (documents specification). */
	document?: string;
}

export interface KernelOptionsV2 extends Omit<KernelOptionsV1, 'deployment'> {
	/** With no `boot`: the validated projection, and `createKernel` runs stage B before it resolves. */
	deployment?: ProjectionV2;
	/** What `readBoot` read. With it, `createKernel` resolves after stage A. */
	boot?: BootProjectionV2;
	/** What stage B reads. Required with `boot` when it lists an app. */
	appsLoader?: () => Promise<{ deployment: ProjectionV2; ports: KernelPortsV1 } | { refused: string }>;
	/** The URL's project, by slug, for the first frame (6.3). */
	initialScope?: { project: string };
	/** The workspace when no `boot` names one. Default `{ id: 'personal', name: 'Personal' }`. */
	workspace?: { id: string; name: string };
}

export type AppStateV2 = AppStateV1 | 'disabled';

export interface AppSummaryV2 extends Omit<AppSummaryV1, 'state'> {
	state: AppStateV2;
	scopeLevels: Array<'workspace' | 'project'>;
	rail: boolean;
	/** Whether it can open in the active scope, as the rail shows. */
	available: boolean;
}

export interface MountTransportV2 extends Omit<MountTransportV1, 'callTool'> {
	callTool(name: string, args: unknown, signal?: AbortSignal, meta?: Record<string, unknown>): Promise<McpToolCallResult>;
}
```

- **The move.** As phase 1's: `LoamKernelV1` stays exported for the `extends`, the chrome checks `version === 2`, and its full-page mismatch error names both.
- **`AppsRuntime`** gains `scopeLevelsOf(name)` and `checkResource(name, input, scope)`, and `summaries()` returns `AppSummaryV2`. `EMPTY_APPS` answers `undefined` and `[]`. `KernelParts` gains `mcpOptions()`, its `resetSession` returns a promise, and `KernelPartsInternals` gains `replaying` and `actorOf`. `appPort(instance)` returns `AppPortV2` ([3.6](#36-a-surfaces-port-d83)). `scopesSeen`, by trace ID as `seqs` is, carries the scope, `scopeChanged` and `mainChanged` from the handler and middleware to `run`'s event.
- **`createKernel`** rejects only as phase 0 does.

### 11.2 Commands and the port

Section 4's and the documents specification's. `APP_CALLABLE_SHELL_COMMANDS_V1` keeps its name for phase 1's nine, and `appCallable(grants)` in `apps/port.ts` adds `scope-get` and `app-route-set`, for its own instance, always, `project-list` and `project-get` with `projects`, and [the documents specification's list](../2-documents/spec.md#11-the-documents-grant) with `documents`. Anything else is `CALL_NOT_GRANTED`, as phase 1's check order has it.

`palette-search` and `listCommands` keep phase 1's rule, and also leave out a command of an app not `available` in the active scope. It stays callable by name, and answers as [3.4](#34-the-order-of-a-call-d72) says. That is the catalog's "filtered by active app and scope".

### 11.3 The SDK

Additions to `@lushly-dev/loam-sdk`. Each is optional to an app.

```ts
export interface ScopeV1 { readonly workspace: string; readonly project?: string }

export interface AppCallContextV1 {
	// ... phase 1's, and:
	/** The call's effective scope. */
	readonly scope: ScopeV1;
	/** Present with the `projects` grant. */
	readonly projects?: ProjectsV1;
	/** Present with the `documents` grant (documents specification). */
	readonly documents?: DocumentsV1;
}

export interface LoamClientV1 {
	call<T = unknown>(name: string, input?: unknown, options?: { signal?: AbortSignal; level?: 'workspace' }): Promise<CommandResult<T>>;
}

export interface ProjectsV1 {
	active(): Promise<ProjectV1 | null>;
	list(): Promise<ProjectV1[]>;
	get(ref: string): Promise<ProjectV1 | null>;
}

export interface LoamSurfaceElementV1 extends HTMLElement {
	// ... phase 1's, and:
	scope?: ScopeV1;
	route?: string;
	selectionLevel?: 'workspace' | 'project';
}

export interface AppContextV1 {
	// ... phase 1's, and:
	/** Moves this app's route, by `app-route-set`, so the URL follows. Native only: a view calls `app-route-set` through its client. */
	navigate(route: string): Promise<void>;
}
```

`AppContextV1` holds no scope, since `activate` runs once and a scope changes: a surface reads its element's `scope`. `@lushly-dev/loam-sdk/view`'s `ViewHostContextV1` gains `dev.loam/scope`, `dev.loam/route` and `dev.loam/selectionLevel`. `app-route-set`'s `path` is refused as [its row](#43-the-project-store) says, so a view cannot walk the URL into another project.

`@lushly-dev/loam-testing`'s `createAppTestKernel` gains `scope?: { project?: string }`, which creates that project in the headless kernel and sets it, and `port` follows. `app new`'s scaffold writes `manifest_version = 2`, with `scope_levels = ["workspace"]` written out and a comment naming the other values.

## 12. Failure modes and error codes

Every code has a suggestion and is added to `LoamKernelErrorCode` or the deployment's refusals. Each row is covered by a unit test or an exit test. Phase 1's section 10 stands.

| Code | When | Effect | Suggestion says |
| --- | --- | --- | --- |
| `PROJECT_NOT_FOUND` | [3.4](#34-the-order-of-a-call-d72): none, or not allowed. One message for both | A failure, journaled | `project-list` |
| `SCOPE_WORKSPACE_UNKNOWN` | Line 1 | A failure, journaled | The workspace's id, from `workspace-get` |
| `SCOPE_PROJECT_REQUIRED` | Line 3 | A failure, journaled | `scope-set` |
| `SCOPE_MISMATCH` | [3.5](#35-a-resource-in-another-project), and the documents specification's | A failure, journaled | The right project, by name and slug |
| `SCOPE_NOT_GRANTED` | An app's port asked for a scope other than its own | A failure, journaled through the internal `app-scope-refuse` | Scope is the shell's |
| `PROJECT_ARCHIVED` | Line 6 | A failure, journaled | `project-restore` |
| `PROJECT_SLUG_TAKEN`, `PROJECT_SLUG_INVALID`, `PROJECT_NAME_INVALID`, `PROJECT_MEMBER_SELF_REQUIRED` | `project-create`, `project-update` | A failure | Per row |
| `PROJECT_SUMMARY_TIMEOUT`, `PROJECT_SUMMARY_INVALID` | [7.7](#77-project-summary) | That row of the result | Report to the app's owner |
| `MOUNT_PROJECT_NOT_LISTED` | [9.2](#92-a-call) | A failure, journaled | The slugs it serves |
| `INSTANCE_PROJECT_UNKNOWN`, `INSTANCE_LEVELS_OVERRIDDEN`, `TEAM_INSTANCE_WHOLE_WORKSPACE` | [9.1](#91-an-instance-and-its-projects-d55), [4.2](#42-the-deployment-file-version-2) | A warning | Per row |
| `DEPLOYMENT_WORKSPACE_INVALID`, `DEPLOYMENT_BASE_PATH_INVALID`, `DEPLOYMENT_INSTANCE_RESERVED`, `DEPLOYMENT_PROJECT_INVALID` | [4.2](#42-the-deployment-file-version-2) | `deployment write` stops | The fix |
| `DEPLOYMENT_WORKSPACE_CHANGED` | [4.2](#42-the-deployment-file-version-2) | A warning from `deployment write` | What it strands |
| `DEPLOYMENT_INVALID` | A projection that passes `readBoot` and fails `readProjection` | Each app `failed`, in stage B. Phase 1's notice stays for a file `readBoot` cannot read | Rewrite the deployment |
| `MANIFEST_RESOURCE_KEY_INVALID`, `MANIFEST_SUMMARY_INVALID` | [8.3](#83-new-keys) | The package is refused | The fix |
| `SIDEBAR_RESULT_INVALID` | A `tree` over its bounds | Shown in the part | Report to the app's owner |
| `APP_DISABLED` | `app-open` or a call into a disabled instance ([4.1](#41-the-workspace-store-d73)) | A failure, journaled | `workspace-app-set { enabled: true }` |
| `STORE_WRITE_IN_QUERY` | A `put` or `delete` under a command that is not a mutation ([section 5](#5-the-store-grant-d77)) | The store call is refused; the handler decides what it answers | Declare `store-write` on the command |
| `APP_ROUTE_INVALID` | A `.` or `..` segment in `app-route-set`, or a path over 1,024 characters | A failure, journaled | Use a path under the app's own base |
| `LATE_COMMANDS_UNAVAILABLE` | The `late` chunk did not load ([2.2](#22-two-stages-d69)) | A failure, retryable, for each name stage A does not hold | Reload; check that the deployment serves its assets |

## 13. Security

- **The shell's CSP does not change.** `script-src`, `connect-src` and `base-uri` stay as phase 1's section 12 has them. Every Chromium scenario still fails on a violation.
- **The projection** still holds no location, credential or command line. Adding `boot` adds display text from a manifest: rendered as text, as every manifest field is. The schema stays closed.
- **The URL** is untrusted input ([6.1](#61-the-shapes)). A slug is looked up. Nothing from it reaches markup or a store's key but through the lookup. An app's path cannot hold a dot segment, in `app-route-set` or `formatRoute`.
- **The scope** is a claim on every path. Nothing but `decideAccess` and the store use it as authority, and neither takes a stronger word than the record's.
- **Scope in a store's id.** `checked` refuses a `p~` key, so a key cannot name another scope's record. `project` in the id comes from the context, never from an app.
- **A view and its scope.** A view's broker is its [surface port's](#36-a-surfaces-port-d83), closed over the scope that surface was created with, so its calls run there or at workspace level, whatever is active when they arrive. The record `id` a frame names in `dev.loam/store` is built by the kernel, and a frame's `callId` ties a store call to the call's scope. A query's handler cannot write ([section 5](#5-the-store-grant-d77)).
- **What a view can learn.** Through a port, `scope-get` holds no record, a project has no members, and a document outside the call's scope answers as a missing one ([documents specification](../2-documents/spec.md#42-the-check-on-every-document-command)).
- **Identity over MCP** is not decided, and nothing here is safe to serve to a real client until phase 3 maps `onBehalfOf` ([3.3](#33-over-mcp)).
- **Native apps** remain trusted code (D54): `context.store`'s scope is a contract for one, since it shares the page, and a boundary for a view.
- **What a view holds.** Documents let a view editor hold document content, so [phase 1's section 12](../1-app-contract/spec.md#12-security) reaches further: **a view's data is not confidential from its author,** and a document type served as a view can send what it reads anywhere over WebRTC. Phase 2 ships one view type, `checklist`, first-party. It therefore does not depend on the owner's answer to #711. If the owner decides otherwise, `checklist` becomes native at no cost to the phase, and the second document type's proof is unchanged.
- **Limits (#710).** A journaled command's input is unbounded, and now a document's content is what commands carry. The [documents specification](../2-documents/spec.md#44-limits) bounds that one path; #710 stays open for the broker and the journal in general.
- **Personal data.** Project names and member ids are in the store and the journal. Phase 3's `redact` extends as it was going to.

## 14. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 2 |
| --- | --- | --- |
| Memberships from a provider, roles, owners, organizations, a workspace switcher | Phase 3 | `decideAccess`'s input; `organization`, `tenant`; the title bar's first text |
| Settings at project scope, personal rail order (R8) | Phase 4 | `trashDays` on the workspace; `bandFor`'s comparator |
| `calls`, events, `shell-open` | Phase 5 | `ResourceLinkV1`; the URL scheme |
| A hosted server serving scope over MCP for real, the mount route | Phase 6 | `mcpOptions()`; `base_path`, `404.html` |
| Changing a project's slug, with redirects | A follow-up | `slug` fixed |
| Deleting a project | A follow-up, with retention | Archive |
| Several workspaces in one store | Phase 3, with binding | `workspace` on every record, and a store id that needs a prefix in one function, `storeRecordId` |
| Collaboration | [Its own specification](../2-documents/spec.md#13-collaboration-the-seam-and-nothing-more) (D46) | `memberEpoch`, the binding |

## 15. Exit criterion and tests

The phase exits when every test below and the [documents specification's D1 to D10](../2-documents/spec.md#14-exit-criterion-and-tests) pass on `main` in `loam.yml`, and STATUS.md records the run, with "through a test-only relay" beside E6 and "through a test-only handler" beside E5, each named as what it does not prove. **Each row names the job that runs it.** "Units" is the `loam` job's "Unit suites with coverage" step, "Chromium" is its `test:browser` step, and "Mounted" is the `mounted` job's `test:mounted` step.

`web`'s `test:browser` gains `test/browser/scope/`. Every scenario fails on any CSP violation, as phases 0 and 1 do.

| # | Criterion | Job | Test |
| --- | --- | --- | --- |
| E1 | **One first paint** ([section 2](#2-first-paint)) | Chromium | Through a new `measureFirstPaint(page)` in the harness, which lists what was requested **before the mark `loam-stage-b`**, so it does not depend on when a machine reports `first-contentful-paint` ([2.1](#21-what-was-measured)): the empty shell, hello, and hello with tally **request the same chunks, byte for byte**, with `deployment.json` differing and no `app-manifest.json`. The JavaScript's sum is at or under 300,000 and equals `budget`'s row. None of `apps-`, `validate.generated-`, `deployment-`, `surfaces-` or `late-` is among them. `apps/layout.test.ts:110`'s and phase 1's E5 assertions on `requestedBeforeFirstPaint` become this. The harness holds `apps/*/app-manifest.json` and each stage B chunk: **with them held, a frame paints,** by `first-contentful-paint` firing, with the rail listing hello, tally and a refused fixture with its "(unavailable)", and main `aria-busy` with no landing for a persisted active app. Under 4x CPU and 2.1's network, `first-contentful-paint` is recorded in the run, not asserted. **Boot records:** a hostile record, with markup in a title, a bad `instance`, and a bad `workspace.id`, renders as text, drops that entry, and shows "Loam cannot start"; a record that lies about title, levels and parts is corrected by stage B, whose manifest wins. Step 5 adds a deep link, and step 6 adds tasks |
| E2 | **Budgets** | `loam` job's "Bundle budget" step; Chromium; `loam` job's "AFD's lean path" step for `entry-points.test.ts` | Bundle budget: every row of [2.4](#24-the-budget-and-the-rule) passes, with `jsMinified` at or under 300,000 and `jsGzip` at or under 91,000. Each step's pull request records its ledger line. Chromium: A1 to A3 stay within budget, `__zod_globalConfig.jitless` is true and no `securitypolicyviolation` fires, in the empty shell and after stage B |
| E3 | **Two projects, a project-scoped app, a workspace-only app and a dual-scope app behave as the proposal describes** | Chromium | Tally, tasks and hello, with projects Atlas and Beacon. No project: tally and hello in the bottom band, tasks dimmed in the top, and its `app-open` is `SCOPE_PROJECT_REQUIRED`, journaled. Atlas: hello moves to the top as one element, tasks opens. Hello's sidebar shows `In Atlas` and `In <workspace>`, with a value stored at each kept apart, and a focused entry keeps focus when it moves. Beacon, from tasks: tasks stays, with Beacon's records, and nothing of Atlas in the deep DOM. To no project from tasks: the projects section. From tally to Atlas: the project's home. A `kernel.agent` `tally-add` under Atlas runs at workspace level and is journaled with its effective scope. Switcher by keyboard, with Escape returning focus. `bandFor` units cover every row of 7.1. A mounted fixture with `projects` is dimmed elsewhere |
| E4 | **Scope in the context, the journal and replay** | Units; Chromium | Kernel unit: each path of 3.2 reaches `context.scope`, on both interfaces. A press in flight during a switch keeps its surface's scope. Each row of 3.4's shell-command table: signing out inside a restricted project lands at workspace level, with `scope-get`, `layout-get` and `auth-sign-in` working throughout, **nothing of Atlas in the deep DOM, the URL moved and the rail re-read, by Chromium, and a later `scope-set` replaying with zero differences;** the same for a Mock session expired by a fake clock, at its next call, for `document-open` across scopes and for `project-archive` of the active project; `view-state-get` and `view-state-list` on a restricted project's `@` ids, signed out, answer as unregistered; `project-restore` works on an archived project; each named-project command refuses a project the actor may not enter. `session-scope.ts`, signed in, with a reload in the middle **and a sign-in after it,** replays with zero differences, including a refusal after the reload, a project created by that person, and a summary answered from its record. A `layout-set` between the stages after a URL boot, and a disabled instance's `app-open`, replay the same. `workspace-deployment-apply` is not applied twice in a replay. An entry with no `scope` replays as the workspace. `diffJournals` reports `context` for two sessions that differ only in scope. Under Chromium, an IndexedDB journal holds `context.scope` |
| E5 | **The scope travels in `_meta` over MCP**, through a test-only handler | Units: `kernel/src/mcp-scope.test.ts` | `kernel` takes a dev dependency on `@lushly-dev/afd-client`. A real `createMcpHandler` from `@lushly-dev/afd-server` with `mcpOptions()`, on a loopback `node:http` server, and `StreamableHttpTransport` as its client, in both eras. One connection: `tools/list` equal across scopes; a `probe` app's echo command with `_meta["dev.loam/scope"]` Atlas, then Beacon, then none, each seeing its own and none seeing another's, and the journal holding each value. **`BOOT_ONLY` and `INTERNAL_COMMANDS` are not in `tools/list`, and calling each answers `COMMAND_NOT_FOUND`.** A project restricted to a named member is refused on that same command, because a server's actor reads as `local`: that shows the middleware ran, and not that identity works over MCP, which [3.3](#33-over-mcp) says is unproved. `_meta["dev.loam/caller"]`, `app`, `instance`, `replay` and `parent` are not read: the context holds no such value. `afd-call`'s `meta` argument gives the same. Malformed: `VALIDATION_ERROR` naming the field. Its header comment says that it proves the declaration and the middleware, and not `run`, identity or a hosted server |
| E6 | **Scope reaches a mounted instance**, through a test-only relay (D55, D65) | Mounted | A real `umbel` with `space = { atlas = "main" }`: `work-hello-greet` in Atlas answers with `space: "main"`, `space: "other"` is `MOUNT_SPACE_PINNED`, and neither reaches Umbel, by the relay's log. In a project outside `projects`, and at workspace level, `MOUNT_PROJECT_NOT_LISTED`, with no request. A non-member of a restricted project gets `PROJECT_NOT_FOUND`, with no request. `web` takes a dev dependency on `@lushly-dev/afd-server`. A fixture AFD server through the same relay, `test/mounted/scope-server.ts`, declaring `dev.loam/scope`, echoes it through a first-class tool and through `afd-call`, and a stock `umbel` answers the same with the key present. Discovery carries none. The journal's entry has `scope`, `instance` and `replay: 'recorded'`. `git diff --exit-code origin/main -- endpoints/umbel` is in the step's checks |
| E7 | **A cross-project mutation is refused after the access decision** | Units; Chromium | Kernel unit and a Chromium scenario through the palette and `kernel.agent`, with the journal read after each: `tasks-complete { task }`, in Atlas, for a task of Beacon, is `SCOPE_MISMATCH` naming Beacon with its `scope-set` suggestion; for a restricted project the actor is not in, it reaches the handler as a missing key, and nothing in the result names the project; a `scope` on a restricted project, for a non-member, is `PROJECT_NOT_FOUND`, with the same bytes as for a project that does not exist. A view's `dev.loam/store` under Atlas reads nothing of Beacon's key, and a key starting `p~` is a `TypeError`. A nested query keeps the outer scope. A view asking `scope` through `tools/call`'s `_meta` is ignored. `document-rename` is the [documents specification's](../2-documents/spec.md#14-exit-criterion-and-tests) D6 |
| E8 | **The URL scheme** | Units; Chromium | `parseRoute` and `formatRoute` tables. Chromium over `serveDeployment`, with `base_path = "/"` and again with `/loam/`: a deep link to each shape loads, under the CSP, with `base-uri 'none'`, and shows what it names. Back and forward run commands, journaled, with `history.length` unchanged by a traverse and Forward still available. `scope-set` from `kernel.agent` moves the URL. A view's `app-route-set` with a `..` is `APP_ROUTE_INVALID`, and the URL stays. A route to a missing project and to a refused one both show "Nothing here", identically. `/` stays on an empty shell, and is replaced for a persisted app. A scan of `web/src` and `chrome/src` finds no `baseURI`. `deployment write`'s `index.html` and `404.html` hold the rewritten URLs |
| E9 | **The projects section and `project-summary`** | Chromium | Create from the form, a refused slug shown beside its field, rename keeping the URL, archive, refuse a mutation in it with `PROJECT_ARCHIVED`, restore. The home shows tasks' counts and a link that navigates. A summary that hangs, one that throws and one over its bounds each show as their row, and the rest stand. It replays from its record with the app's handler stopped, whatever the deadline did. A hostile `title` and `label` render as text |
| E10 | **The stores and the migration** (D63, D73) | Units; Chromium | Both adapters: each table's fields, a write without its workspace or actor refused. Phase 1's `app-<instance>` rows, written by a fixture with `scope: null`, read at workspace level and keep their ids. A store row of project Atlas is invisible to Beacon, to workspace level and to `list`. A new generation adds, changes and unlists, keeping `overrides`, journaled, and a second boot journals nothing. An empty shell journals none of it, and phase 0's E2 is unchanged. A scan of the store's rows and the browser's files for each mounted fixture's URL, token and command line finds none. **Every reachable command's input schema is scanned for `command`, `cwd`, `url`, `bearer`, `transport`, `route`, `projects`, `space`, `expose`, `audience` and `prefix`, and each boot-only command is called on both interfaces and through a port, answering `COMMAND_NOT_FOUND`** |
| E11 | **The manifest** | Units; `loam` job's "AFD's lean path" step for `scripts/plugin-manifest.test.mjs` | `profile-cases.json` covers each new key and refusal. A v1 document with a v2 key is refused with its suggestion; every valid v1 case reads under v2. Hello and tally load as version 1 and tasks as version 2, side by side. `scripts/plugin-manifest.test.mjs` passes with the v2 profile. `schema:build` compiles under `strict: true` |
| E12 | **Accessibility and captures** | Chromium | Specimen captures of each new element in the three themes and two densities, with an ARIA snapshot; #707's workaround stays. Axe with phase 0's tags on the shell with bands and a dimmed entry, the switcher open, the projects section's list and home, a dual sidebar, in each theme and density, under `forcedColors: 'active'` and in the compact class, zero violations. 40 rail entries scroll by keyboard, each tooltip unclipped. F6's order holds. A scope change is announced in the live region. #708's screen-reader passes stay open, and E12's record says axe cannot judge them |
| E13 | **What exited stays exited** | Chromium; Mounted; Units | Phases 0's and 1's exit tests still pass, amended only for what this specification changes, each listed in the step that makes it: the rail's empty state (7.1); `loam-new-button` in the title bar; `DEPLOYMENT_INVALID` (2.2); the assertions on `requestedBeforeFirstPaint` (E1); a journal's boot reads with apps, which `app-get` no longer opens; `session-50` regenerated in step 2; `chrome/src/router.test.ts`, as `matchRoute` and URLPattern go; `kernel.test.ts:146`'s `kernelInterface`; `deployment_version` in the fixtures and tests, and `web/src/deployment.test.ts:6` against E8's scan; the scaffold's test, as `app new` writes version 2; and `layout.test.ts:276` stays as it is, which [6.1](#61-the-shapes) keeps true |
| E14 | **No job was skipped** | The exit step | See [step 14](#16-implementation-plan). So it can be read: **every exit test's title starts `P2-E<n>:` or `P2-D<n>:`,** since phases 0 and 1 already hold titles such as `E7:` (`web/test/browser/stores.test.ts:47`); `vitest.browser.config.ts`, `vitest.conformance.config.ts` and `vitest.mounted.config.ts` set `reporters: ['verbose']`, since `test:browser` chains two runs with `&&` (`web/package.json:16`) and a flag would reach only the last; and the unit step passes `--reporter=verbose` |

## 16. Implementation plan

Each step is one pull request, merged on green. It updates its specification's status block and STATUS.md before it merges. Steps 9 to 13 are in the [documents specification](../2-documents/spec.md#15-implementation-plan), and listed here so the phase has one order.

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 0a | AFD: a lean schema path in `/define` and `/direct` | [2.3](#23-the-lean-schema-layer-d70): `defineCommandWithSchema`, the bound on `$ZodType`, the graph, the messages, the entry-point test, the skill, a changeset. **No package moves to Mini here,** so first paint gains only the 621 bytes and 330 gzip 2.3 records | `pnpm check`, `pnpm verify` |
| 0b | AFD: `ViewStateRegistry.hydrateOne`, and a stable Mock id | [7.6](#76-surfaces-on-a-scope-change); `MockAuthAdapter`'s user id from the email ([3.4](#34-the-order-of-a-call-d72)); tests, a changeset | `pnpm check` |
| 1 | Kernel on the lean layer | **Moves out.** [2.3](#23-the-lean-schema-layer-d70): view-state, auth, with `createAuthSessionGetCommand` and `createAuthMutationCommands`, and the kernel on Mini, in one pull request; classic in the `apps` closure; the literals' tests; the six boot commands in first paint and `kernel/src/late/`, with `startApps` holding only the late commands so far; `budget.mjs`'s closures and new ceilings; the acceptance of 2.3, or an amendment. #658 closed with the measurement | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 2 | Two-stage boot | **Moves out.** [2.2](#22-two-stages-d69): `deployment.v2.json`, `projection.v2.json`, boot records, generation, `base_path`'s schema; `readBoot`; `bootApps`; stages A and B; `KernelOptionsV2`, `KERNEL_INTERFACE_VERSION = 2` and `session-50` regenerated; `afterFirstFrame`; `loam-app-entry` to first paint; `measureFirstPaint`; E1 so far. #701 and #709's second half closed | `pnpm check`, `loam.yml`, `budget` |
| 3 | Manifest version 2 | [Section 8](#8-the-manifest-version-2-d76): the schema, the rule, the v1 test, the cases, `scripts/plugin-manifest.test.mjs`, the keys of this specification and the documents specification's, each refused by a rule in `loam-rules.ts` until its step removes that line: `tree`, `resource_keys` in step 4 and 6, `ui.project_summary` in 7, `ui.documents` and `ui.new` in 9 and 11; E11 | `pnpm check`, `loam.yml` |
| 4 | Scope and stores | Sections [3](#3-scope), [4](#4-the-stores), [5](#5-the-store-grant-d77), [10](#10-journal-and-replay-with-scope), [11](#11-the-kernel-and-the-sdk): the field, `scopeMiddleware`, `decideAccess`, `ProjectCache`, `src/late/`, the tables, `workspace-deployment-apply`, store scoping, `resource_keys`, `mcpOptions()`, `applyScopeChange` with its middleware callers, `scopeChanged` and `mainChanged`, `AppPortV2` and `SurfacePortV2`, `STORE_WRITE_IN_QUERY`, `resetSession`'s sign-out and `actorOf`, `diffJournals`' `context`, the SDK's additions, `createAppTestKernel`'s `scope`; E4's, E7's and E10's units, and E5; the domains. Its Chromium parts wait for step 7 | `pnpm check`, `loam.yml`, `budget` |
| 5 | The URL scheme | [Section 6](#6-the-url-scheme-d74): `parseRoute`, `formatRoute`, the router, the base, `index.html`'s rewrite and `404.html`, `loam.scope`, the scope's and the URL's rules, the harness's fallback; E8 so far: workspace, project and app shapes. Step 7 adds the projects section's, and step 11 the documents section's and a document's, which closes it | `pnpm check`, `loam.yml`, `budget` |
| 6 | The rail and the parts | [7.1 to 7.6](#71-the-bands-d75), `tasks` without its `ui.project_summary` and `ui.new`, which steps 7 and 11 add, the switcher, `loam-tooltip` with #709's first half, the dual sidebar, `tree`'s reader, breadcrumbs, the status bar, per-scope layouts, `AGENTS.md`, `design.md` and the skill, `suites.mjs` and `loam.yml`'s `lint:tokens`; E3 so far: its clauses that land in the projects section wait for step 7; E12 so far; phase 0's rail tests amended | `pnpm check`, `pnpm verify` (it selects the whole workspace), `loam.yml`, `budget`, `theme:check`, `lint:tokens` |
| 7 | The projects section | [7.7](#77-project-summary), `project-summary-get`, `ui.project_summary`, `sections` row, and `ResourceLinkV1` with `resourceLinkUrl` from the [documents specification's 9.1](../2-documents/spec.md#91-a-resource-link), which E9 needs. `session-scope.ts`, and the Chromium parts of E4, E7 and E10, since the rail and the section are now there. E3 and E9 close; E8 and E12 so far | `pnpm check`, `loam.yml`, `budget` |
| 8 | Mounted scope | [Section 9](#9-mounted-instances), `scope-server.ts`; E6. Its diff touches nothing under `endpoints/umbel/` | `pnpm check`, `test:mounted`, `git diff --exit-code origin/main -- endpoints/umbel`, `loam.yml` |
| 9 | Document records | [Documents](../2-documents/spec.md#15-implementation-plan) | |
| 10 | The editor area and `notes` | [Documents](../2-documents/spec.md#15-implementation-plan) | |
| 11 | New and the documents section | [Documents](../2-documents/spec.md#15-implementation-plan) | |
| 12 | References and embed | [Documents](../2-documents/spec.md#15-implementation-plan) | |
| 13 | The second type | [Documents](../2-documents/spec.md#15-implementation-plan) | |
| 14 | Exit | STATUS.md and both status blocks record the exit run; follow-ups filed; D69's and D70's results recorded in [2.4](#24-the-budget-and-the-rule). **E14, no job skipped:** after the last step merges, run both `loam.yml` and `ci.yml` by `workflow_dispatch` on `main`. A manual run has `AFD_SCOPE` of `all`, which opens every gate, where a push has `affected` (`ci.yml:39`). Then run `node scripts/loam-exit-check.mjs <loam run id> <ci run id>`, written in this step. It fails unless: (1) by `gh run view <id> --json jobs`, **every job of `loam.yml`, `Affected units`, `Build, unit and Chromium` and `Mounted against Umbel`, and every job of `ci.yml`, says `success`, and none `skipped` or `cancelled`;** (2) by `gh run view <loam id> --log`, each row's `P2-E<n>:` or `P2-D<n>:` title appears with a pass, in the log of each job its row names, not assumed from the job's success; (3) no such title anywhere in that log is marked skipped or todo. **`ci.yml`'s log cannot show a test's title,** since `pnpm check` runs under lefthook with `output: [summary, failure]` (`lefthook.yml:12-14`), which hides a passing test's output. So step 14 adds to `loam.yml`'s `loam` job a step named "AFD's lean path", running `pnpm -F @lushly-dev/afd-server exec vitest run src/entry-points.test.ts --reporter=verbose` and `node --test --test-reporter=spec scripts/plugin-manifest.test.mjs`, whose tests are titled `P2-E2:` and `P2-E11:`, and `ci.yml`'s dispatch proves the whole workspace. Phase 1's `mounted` job skipped silently for a whole pull request, because it read a gate output that was never set, and its pull request still went green. `scripts/repository-contract.test.mjs:315-330` holds the output key; this holds the run. The script's output goes in STATUS.md's exit line | `loam.yml` and `ci.yml` on `main`, by hand, with the script above |

Order:

- Steps 0a and 0b run in parallel, first, since D15 puts AFD first and step 1 needs 0a.
- Step 1 needs 0a. Step 2 needs 1, **because it adds first-paint code and step 1 is what moves code out.** Step 3 may run beside step 2: it touches only the manifest package and its tests.
- Step 4 needs 0b, 2 and 3. Steps 5 and 6 need 4; step 6 needs 5 for breadcrumbs, so it follows. Steps 7 and 8 need 6 and may run in parallel. Step 9 needs 6, and the rest are ordered in their specification; step 11 also needs 7.
- **An exit test named in several steps closes in the last,** and each earlier step adds its clauses under the same `P2-` title.
- Step 14 is last.

**Host capacity.** Steps 1 and later run Chromium, and 8 builds the stock `umbel`. On a shared machine: under a load of 20, `cargo -j4`, one Vitest worker, a shared `CARGO_TARGET_DIR`, which the harness honors.

## Amendments to the architecture and the decision log

This pull request adds to the [decision log](../../decisions.md):

- **D69.** A real deployment's first paint: two stages. Stage A paints from a projection the CLI validated, with boot records for display only; stage B reads and validates everything else, after the first frame. The empty shell and a deployment with apps request the same JavaScript before their first frame. Settles #701. Not a trust-model change: nothing but display comes of a boot record.
- **D70.** The shell's commands use Zod Mini and literal JSON Schemas, through `defineCommandWithSchema`, which AFD's `/define` and `/direct` gain with no run-time dependency on classic Zod or `toJSONSchema`; only the six commands boot calls stay in first paint, and the rest load in stage B. Classic's schemas move to stage B with `fromJSONSchema`. Settles #658's question; `defineCommand` is unchanged for every other caller.
- **D71.** Scope is `{ workspace, project? }`, ids, in the declared context field `scope`, `dev.loam/scope`, `journal: true`. In process, the kernel sets it per call, from `options.scope` or the active scope. Over MCP, it is the one declared field, and absent means workspace level: no connection or server holds an active scope. Revisits nothing in D31.
- **D72.** One function, `applyScopeChange`, changes the active scope, for `scope-set`, `document-open`, `project-archive` and a change of actor, and the chrome keys on the event it leaves. An owned command's order: the workspace, the access decision, the app's levels, narrowing, the resource check, an archived project, a mounted instance's rules, then the handler, all inside the journal's middleware, so each refusal is journaled. A shell command runs at any scope and checks what it names, so a person can never be locked out. Missing and refused look the same. `resource_keys` gives the kernel what it needs to name the right project; the store is what makes the crossing impossible.
- **D73.** The workspace store takes the projection's entries at each new generation, with the deployer's keys read-only to every command; what a person may change is `enabled`, `order` and `title`. Locations, credentials and `command` stay in the deployment file. Fulfils D63's consequence and keeps D55's and D56's "no command may write it".
- **D74.** The URL scheme is the architecture's, relative to a deployment's `base_path`. `deployment write` makes `index.html`'s URLs absolute and writes `404.html`; `base-uri 'none'` stays; the page computes its base from its entry's URL. A person's navigation runs commands; a command moves the URL. Back and forward are navigations. No URLPattern (revises R5's wording).
- **D75.** The rail's two bands: Projects, the switcher and Documents head the top; a project-only app is dimmed there with no project; a dual-scope app moves between the bands as one element (reads D29 as the proposal does). An empty shell's rail holds the two sections. R8 moves to phase 4.
- **D76.** Manifest version 2 is one schema and one validator reading both versions, a rule refusing a v2 key under version 1. Additions stay under `app` and `ui`, as P3 allows; `protocol` and `sdk` do not move, so a phase 1 package loads unchanged.
- **D77.** A record of the `store` grant is keyed by scope in one function, with workspace level keeping phase 1's ids, so no migration runs. `context.store` holds only the call's effective scope.
- **D78.** `dev.loam/scope` goes to a mounted instance on each command's call, as `_meta`, ids only; `projects` holds slugs, and a call outside them never reaches the network. A server that does not declare the key drops it. Supplies D55's access decision and D65's pin.
- **D79 to D82:** in the [documents specification](../2-documents/spec.md#amendments).
- **D83.** A surface has its own port: `appPort(instance).surface({ scope, readOnly })`, created by the chrome with the surface and dropped with it, so a call runs in the scope the surface was created under, whatever is active when it arrives, and an embed's read-only is enforced per surface. For a view it is a boundary, since its broker closes over it; for a native app a contract (D54).

The decision log's D4, D5, D29, D31, D63 and D68 gain notes pointing to these, and D55 a note of the phase 3 condition in [9.1](#91-an-instance-and-its-projects-d55). What D54 to D58 decided is not altered.

The architecture is amended:

- **Section 4,** surface catalog: a note that what phase 2 serves is in these two specifications. Section 5: the domains gain `workspace`, `section`, `editor` and `new`; the shell commands gain the [tables](#43-the-project-store) of this specification and the documents specification's.
- **Section 7,** URL scheme: relative to `base_path`, with the reserved segments.
- **Section 6,** libraries: Routing's URLPattern is dropped from the row, for R5's reason.
- **Section 9,** the phase 2 row and its AFD prerequisites: scope's proof over MCP runs through a test-only handler until the hosted lane; step 0a's and 0b's AFD changes join the prerequisites table, as phase 2's.

The [trajectory watch](../../trajectory.md) is amended: W1, W3 and W6 refreshed; R5 and R8 as above. The [design document](../../design.md) is amended by steps 6 and 7, not here.

## Review 2026-11-02

See the [Review](../2-documents/spec.md#review-2026-11-02) of the documents specification, which records one independent review of both.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-02 | Phase 2 specification | Classic Zod after first paint, and the core it widens in first paint. `z.fromJSONSchema` in `apps`, and the MCP client's `zod/v4` in `mount`, each hold it: replacing the first alone does not reach Mini's floor of 23,829 bytes. Measure when a deployment's time to first usable app is measured | Open; new issue at step 1 |
| 2026-11-02 | Phase 2 specification | **A condition of phase 3's specification:** restrict `project-create` for a slug a team instance lists, and changing such a project's `members`, to an owner, before any multi-member deployment, or D55's "every member" stops being the deployer's statement ([9.1](#91-an-instance-and-its-projects-d55)). Also `PROJECT_SLUG_TAKEN`'s leak, and `workspace-app-set`'s role | Open; phase 3 |
| 2026-11-02 | Second review | **Identity over MCP, for phase 3:** a server's actor is `{ kind: 'agent' }` with no id, read as `local`. Decide how `onBehalfOf` maps to a member before any client is served, so a person's agent can enter that person's project and a caller with no session cannot enter one restricted to `local` ([3.3](#33-over-mcp)) | Open; phase 3 |
| 2026-11-02 | Second review | A session a provider ends with no command, such as an expiry, takes effect at the next call ([3.4](#34-the-order-of-a-call-d72)). Until then the screen is stale, though no new read succeeds. Phase 3 may have the kernel hear `onAuthStateChange`, journaled | Open; phase 3 |
| 2026-11-02 | Phase 2 specification | A project's slug cannot change. With redirects, if a consumer asks | Open |
| 2026-11-02 | Phase 2 specification | Deleting a project, with a retention rule for what apps stored under it | Open |
| 2026-11-02 | Phase 2 specification | Keep Mod+P, or another chord, for the project switcher, with phase 4's keybindings | Open; phase 4 |
| 2026-11-02 | Step 0b | Drop `data.user.id` from `REPLAY_IGNORE` and `DIFF_IGNORE` (`kernel/src/testing.ts`) at step 1 or the next `session:record`, whichever comes first, and re-record `session-50.journal.json`, which still holds `mock-user-1793608037914`. Until then a replay cannot catch a regression in the stable id [3.4](#34-the-order-of-a-call-d72) requires. A journal recorded before step 0b would then diverge at that path. The `data.session.*` paths stay, since the session's id and expiry are still time-based | Open; step 1 or the next `session:record` |
| 2026-11-02 | Phase 2 specification | Run E1's first-paint measurement on a real low-end device, not just throttled CPU. The ratios of 2.1 are from a fast machine | Open; phase 6 |
