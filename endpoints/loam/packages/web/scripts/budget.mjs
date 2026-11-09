#!/usr/bin/env node
/**
 * budget: the bundle budget of Loam's web host (phase 0 specification, 8.1).
 *
 *   pnpm -F @lushly-dev/loam-web budget [--json]
 *
 * Builds the shell with Vite in production mode and measures what the empty shell loads before
 * first paint: `index.html`'s entry and every chunk it imports statically (a chunk imported
 * dynamically loads later). It also builds `@lushly-dev/loam-kernel` alone, minified with its
 * dependencies, as Vite bundles it for the browser. What loads later has rows of its own (phase 2
 * specification, 2.4): the kernel's late commands, its `src/apps/` with the readers and validators and
 * classic Zod, the chrome's surfaces, its view host and the console. Each is a static closure, charged
 * what a page has not loaded by then. Hello's and tally's bundles are recorded and not limited. It fails
 * when a measure is over its ceiling, when first paint holds classic Zod or `toJSONSchema`, or when it holds
 * a chunk of stage B: `late`, `apps`, the readers, `surfaces`, `url-sync` (phase 2 specification, 2.2). That first
 * paint is the same for every deployment. `dist/` is rebuilt, so run it after `build` or in its place.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { narrowZodFromJsonSchema, zodJitlessByDefault } from './narrow-zod.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The ceilings, in bytes, as phase 2's step 1 sets them (2.4): first paint lowered, the kernel's its
 * measured value plus 10% now that Zod's classic API has left it, `late` added, and `apps` its measured
 * value plus 5%, the one raise, for the bytes that left first paint. Step 3 raised `apps` once more, to
 * its new measured value plus 5%, for manifest version 2's validator (about 40 KB of generated code).
 * Step 2 changed no ceiling: first paint 273,179 and 83,564 gzip, `apps` 377,811 (2.4's table).
 * Step 4 changed none either: first paint 277,772 and 85,346 gzip, the kernel alone 110,680, `late`
 * 47,868 with the `store` chunk it shares with `apps`, and `apps` 377,547 (2.4's table). Step 5 changed
 * none and added `urlMinified`: the URL's commands and writes are a `url-sync` chunk loaded when stage B
 * ends, after `apps` and before `surfaces`, 3,719 of 5,091, its measurement plus 10% and 1,000 for steps
 * 7 and 11's shapes, unrounded (approved by the coordinator); first paint 279,728 and 86,097 gzip, the
 * kernel alone 110,790, `late` 48,425. Step 6 changed none and added two rows: `switcherMinified`, the
 * project switcher's list, measured at 10,288 against a first estimate of 30,000, so lowered by phase 0's
 * rule to its measurement plus 10%, 11,317; and `tooltipMinified`, the rail's tooltip, 2,841 of 3,126, its
 * measurement plus 10%, which left first paint to meet the step's allowance. First paint, after its
 * reviews and re-checks, 285,302 and 87,964 gzip, the kernel alone 111,055, `late` 49,890, `surfaces`
 * 83,468, `switcher` 11,316. After its reviews the coordinator
 * approved a third row, `switcherColdMinified` (2.4, 2026-11-03): what a press of the switcher downloads on
 * an empty shell, which never loads `surfaces` (7.8), 41,057 of 45,163, its measurement plus 10%, unrounded,
 * as `urlMinified`'s is. No other ceiling rose. Step 8 changed none: first paint 285,270 and 87,954 gzip,
 * the kernel alone 111,019, `late` 50,851, `apps` 378,907 (86 left) and `mount` 215,943, with 9.2's checks in
 * `apps` and the disabled gate's refusals moved to `late`, which `apps` had no room for. Step 7
 * added `sectionsMinified`, the projects section with
 * the kernel's summary rows that `project-summary-get` loads on its first call, 42,975 of 45,000, its first
 * estimate kept as the measurement is above 70% of it; and raised `appsMinified` by 833, to 379,826, for
 * `ui.project_summary`'s rule in the one validator, measured as the closure with it less without it (379,007
 * less 378,174 on step 6's base), approved by the coordinator, 2026-11-03. On step 8's base: first paint
 * 285,404 and 87,998 gzip, with `vite.config.ts`'s `events` group keeping the preload helper in first paint's
 * `events` chunk; the kernel alone 111,238, `late` 51,893, `url-sync` 4,347, `apps` 379,806 (20 left).
 * Step 9 leaves `late-documents-` out of the `late` closure, as that chunk gets a row of its own (2.4),
 * `lateDocumentsMinified`, set at its measurement plus 10% (12,016, so 13,218), over its ledger's 11,000,
 * accepted by the coordinator; and raised `appsMinified` by 4,427, to 384,253, approved by the coordinator,
 * 2026-11-03: the manifest's document rules in the one validator over untrusted input (4,185, with the
 * trust review's rule on `export_command` and `import_command`), the redaction of a call the kernel's own
 * bound refused, by its mark, in `apps.redact` (about 180: 184 and 178 by two removals), and the port's
 * `documents` row (58), each measured as the closure with it less without it, with no slack. The parts are
 * approximate, since the minifier's renaming interacts with what is removed; the total is exact. First
 * paint 285,348 and 87,990 gzip, the kernel alone 111,350, `late` 56,860, `apps` 384,233.
 * Step 10 adds `editorMinified`, the editor area's chunk, loaded on the first document opened, restored
 * or routed to, charged after the surfaces as `sections` is: first measured at 24,720 against the documents
 * specification's first estimate of 40,000 (12), at 62%, so lowered by phase 0's rule to its measurement
 * plus 10%, 27,192; 27,182 after the step's reviews, with the tabs' icons. It records `notes`' bundle, as
 * `tasks`' is. The editor's state and commands are a chunk of their own, `late-editor`, loaded inside
 * `loadLate` beside `late-documents`, with a row of its own, `lateEditorMinified`, first 13,111, so 14,423,
 * its measurement plus 10% (an amendment to 2.4 the coordinator decided, 2026-11-07), and 14,389 after the
 * reviews: `late`'s closure leaves both out. After the reviews, first paint 285,523 and 88,061 gzip, the bytes
 * 25 over step 10's allowance of 150 (the busy heading and an observable `mainBusy`), accepted by the
 * coordinator; the kernel alone 111,543; `late` 57,661; `late-documents` 12,105; `url-sync` 4,806; `apps`
 * 384,077, as the port's callable list moved to `late`; `surfaces` 83,946, with `host()`. The re-check's
 * fixes raised `lateEditorMinified` by 221, to 14,644, and `editorMinified` by 573, to 27,765, approved by the
 * coordinator, 2026-11-07, each part measured as the chunk with it less without it (2.4 has them); after it,
 * first paint 285,503 and 88,055, the kernel alone 111,521, `late` 57,956 with a server's events,
 * `late-editor` 14,610 and `editor` 27,755. The narrow re-check's raised them again by their measured
 * cost, `lateEditorMinified` by 406 to 15,050 and `editorMinified` by 13 to 27,778, approved by the
 * coordinator, 2026-11-07; after it, first paint 285,503 and 88,055, `late` 58,015, `late-documents`
 * 12,169, `late-editor` 15,016 and `editor` 27,768. The second narrow re-check's raised `editorMinified` by
 * its measured cost, 394, to 28,172, approved by the coordinator, 2026-11-07, chiefly a draft kept when its
 * save rejects after another's close; `late-editor` fell to 14,957, `late` 58,089, `late-documents` 12,125.
 * The third raised `lateEditorMinified` by 255, to 15,305, and `editorMinified` by 661, to 28,833, their
 * measured costs, approved by the coordinator, 2026-11-07: `document-open`'s `stay` and the suggestion that
 * says a rejected save's draft comes back, less what one read-and-write step saved; and a draft kept in every
 * case but those deviation 16 lists. The fourth raised `editorMinified` by 257, to 29,090, approved by the
 * coordinator, 2026-11-07: a rejected draft's tab marked before its closed tab's mark goes (83), a full group's
 * retry beside (58), and every group searched for its document's clean tab (44), with the loop that does it
 * (about 72). The fifth raised it by 210, to 29,300, approved by the coordinator, 2026-11-07: a parked editor
 * still saving taken back, with its draft, by its tab shown again; `late` rose to 58,480 with an instance
 * mutation's check, write and stamp in its document's chain. The sixth raised it by 323, to 29,623, approved
 * by the coordinator, 2026-11-07: one leave at a time for a frame taken back and parked again (195), each frame's
 * count of edits, so a leave knows of one made after its save began (82), and a tab whose parked editor is
 * still saving counted as unsaved by a rejected draft's reopen (46). The seventh raised it by 455, to 30,078,
 * approved by the coordinator, 2026-11-08: one lifecycle for every frame in place of the patches before it, a
 * life each with one place that one function moves (about 377), the getter a test's check of its invariants
 * reads (72), and a lost draft's mark cleared with it (6). The eighth raised it by 1,004, to 31,082, approved
 * by the coordinator, 2026-11-08, after the independent review of the lifecycle: a mark no editor holds
 * cleared from the person's page, also while an app shows (360), a parked editor whose tab another's call
 * closed reopened (112), a slot another frame holds refused (about 70), the person's close kept in its own
 * scope (28), and visits of a scope, timers by frame, a leaving frame taken off the page and the rest (about
 * 424), and the split of its helpers into `editor-parts.ts`, under the file-size limit (10). The re-check after it raised it by 199, to 31,281, approved by the coordinator,
 * 2026-11-08: a mark cleared when its tab's editor is ready and clean (65), a leaving editor of the scope
 * rendered keeping its tab's mark across a round trip (about 97), and the person's close disposing only a
 * frame still its tab's (37). The next raised it by 178, to 31,459, approved by the coordinator, 2026-11-08: a tab
 * whose earlier editor still saves its draft keeping its mark, whatever a newer one says (about 95), and the
 * person's Discard of an editor still leaving recorded on its life (83). The third raised it by 244, to 31,703,
 * approved by the coordinator, 2026-11-08: a newer leave of a tab keeping the mark an older leave still holds
 * (61), and the person's Discard during a reopen's open closing the new tab (127), never adopted, and reset when
 * a tab takes the frame back (56). The fourth raised it by 718, to 32,421, approved by the coordinator,
 * 2026-11-08: one rule and one reconciler for every mark in place of six sites, with the closed tabs a leave
 * still owes, the person's close asking, the Discard by count of edits and the moves to `editor-parts.ts`, net
 * of what they replaced (273); a mark the rule wants set at once, before any read (256); a Discard of a draft
 * a reopen has given to another tab (122); and the reopen's check of the tab it opened (67 over its 127). The
 * final re-check raised it by 242, to 32,663, approved by the coordinator, 2026-11-08: a closed tab a leave owed
 * kept until its mark is known gone (151), the state the immediate set trusts kept true to what was sent (46),
 * and an editor's mark only for its own document (36), with about 9 between them. The re-check after it raised
 * it by 353, to 33,016, approved by the coordinator, 2026-11-08: a draft rejected while the area is away kept
 * until it shows (161), a tab closed while an app shows leaving at once (117), and the prune they share, the
 * clear's result, a sign-in's sync and `hostOf` moved to `editor-parts.ts` (115), less 40 that settling only on
 * a read or a clear that succeeded saved. The last round's raised it by 349, to 33,365, approved by the
 * coordinator, 2026-11-08: a modal the kernel closed with no answer taken as Keep editing (228), a kept draft's
 * save tried once more when its scope goes first, and on `pagehide` (90), and the scopes out of reach (31).
 * Step 11 adds `documentsMinified`, the documents section with `loam-tree` and `violet-tree`, and
 * `newMinified`, the New menu with `violet-menu`. The documents specification's first estimates were 45,000
 * and 12,000; measured at 51,194 and 15,787, each was set at its measurement plus 10%, 56,314 and 17,366,
 * approved by the coordinator, 2026-11-09, since both load only when the section or the menu opens. Parts:
 * `documents` holds `violet-tree` and `violet-tree-item` (about 16,000), the section, its sidebar, the tree,
 * their styles and sync (about 33,000) and `cards` (1,969, shared with `sections`); `new` holds `violet-menu`
 * and its item (about 9,000) and `loam-new-menu` with `readNew` and `runNew` (about 6,800).
 * Step 11's reviews raised `appsMinified` by their measured cost, 861, to 385,114, approved by the
 * coordinator, 2026-11-09: `ui.new`'s rules as a rule of their own, run for every manifest, with the mounted
 * and levels refusals (652), "needs input" decided by the kernel's own parse of `{}` (75), bidirectional
 * formatting characters refused in Loam's display text (68), and `ui.new` titles in that rule (66).
 * Its narrow re-check raised `urlMinified` by its measured cost, 156, to 5,247, approved by the coordinator,
 * 2026-11-09: a `documents` chunk that does not load, with a tab open, says so in the sidebar and leaves main
 * to the editor, where with no tab main's landing says it (5,038 before).
 * The input-schema rule's fix raised `appsMinified` by its measured cost, 2,672, to 387,786, keeping the 159
 * bytes left before it, approved by the coordinator, 2026-11-09: the manifest's reader refuses a schema Zod
 * would accept and not honour (the documents specification's Follow-ups), measured as the closure with it
 * less without it (387,627 less 384,955). Parts: the schema walker and its table of keywords (about 2,500),
 * the suggestion's words on restructuring (86) and the check's place in the input, config and content rules
 * (about 90). First paint and the kernel alone are unchanged: "needs input" keeps its own branch recursion.
 * Its independent review raised it by that round's measured cost, 5,423, to 393,209, keeping the 159 bytes
 * left, approved by the coordinator, 2026-11-09 (393,050 less 387,627): each refusal's reason and remedy in one
 * table, used at the input, pipeline, content and config sites (about 2,950 over the messages it replaced),
 * the rules the review and its fuzz found (about 2,400: `minItems` and `maxItems` with no `items`, a tuple Zod
 * pads, a value Zod lets go missing through branches, `patternProperties` keys, `$ref`'s forms and cycles, and
 * defaults at the root and in `prefixItems`), and the sites' remedy (about 50). First paint and the kernel
 * alone are unchanged.
 * Its re-check raised it by that round's measured cost, 885, to 394,094, keeping the 159 bytes left, approved
 * by the coordinator, 2026-11-09 (393,935 less 393,050), each part the closure with it less without it: a
 * closed object a join reaches through `$ref` or nested branches (574), names `Object.prototype` holds (346),
 * and cycles through a typed node's branches with the order that says two branch keywords first (-35, as the
 * cycle walk is simpler). First paint's code is unchanged: its gzip is one byte more only for the `apps`
 * chunk's new hash in its name, and with the old name it is equal.
 */
export const CEILINGS = Object.freeze({
	jsMinified: 300_000,
	jsGzip: 91_000,
	cssMinified: 8_496,
	kernelMinified: 113_401,
	lateMinified: 75_000,
	lateDocumentsMinified: 13_218,
	lateEditorMinified: 15_305,
	urlMinified: 5_247,
	appsMinified: 394_094,
	surfacesMinified: 85_000,
	viewMinified: 25_080,
	consoleMinified: 91_222,
	mountMinified: 238_268,
	switcherMinified: 11_317,
	switcherColdMinified: 45_163,
	tooltipMinified: 3_126,
	sectionsMinified: 45_000,
	editorMinified: 33_365,
	documentsMinified: 56_314,
	newMinified: 17_366,
});

/** Group a module id by the package it belongs to. */
function packageOf(id) {
	const path = id.replace(/\\/g, '/').replace(/\?.*$/, '');
	const store = path.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (store) return store[1];
	const nested = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (nested) return nested[1];
	for (const [pattern, name] of [
		[/endpoints\/loam\/packages\/([^/]+)\//, (m) => `@lushly-dev/loam-${m[1]}`],
		[/foundations\/fast-af\/packages\/violet-elements\//, () => '@lushly-dev/violet-elements'],
		[
			/foundations\/fast-af\/packages\/element\/packages\/fast-element\//,
			() => '@lushly-dev/fast-element',
		],
		[
			/\/packages\/(core|server|auth|view-state|local-db)\//,
			(m) => (m[1] === 'local-db' ? '@lushly-dev/local-db' : `@lushly-dev/afd-${m[1]}`),
		],
	]) {
		const match = path.match(pattern);
		if (match) return name(match);
	}
	return path;
}

/** Bytes per package of the chunks given, from Rolldown's rendered lengths. */
function breakdown(chunks) {
	const sizes = new Map();
	for (const chunk of chunks)
		for (const [id, info] of Object.entries(chunk.modules ?? {}))
			sizes.set(packageOf(id), (sizes.get(packageOf(id)) ?? 0) + info.renderedLength);
	return [...sizes.entries()].sort((a, b) => b[1] - a[1]);
}

async function measurePage() {
	const result = await build({ root: ROOT, logLevel: 'warn', build: { write: true } });
	const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
	const chunks = new Map(
		output.filter((item) => item.type === 'chunk').map((c) => [c.fileName, c])
	);
	const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
	const initial = new Set();
	const visit = (fileName) => {
		if (initial.has(fileName)) return;
		initial.add(fileName);
		for (const imported of chunks.get(fileName)?.imports ?? []) visit(imported);
	};
	for (const match of html.matchAll(/<script[^>]+src="\.?\/?([^"]+)"/g)) visit(match[1]);
	const css = [];
	for (const match of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.?\/?([^"]+)"/g))
		css.push(match[1]);
	if (![...chunks.keys()].some((name) => /^assets\/surfaces-/.test(name))) {
		throw new Error('budget: the build has no `surfaces` chunk to measure');
	}
	if (![...chunks.keys()].some((name) => /^assets\/console-/.test(name))) {
		throw new Error('budget: the build has no `console` chunk to measure');
	}
	const initialChunks = [...initial].map((name) => chunks.get(name)).filter(Boolean);
	const classic = initialChunks
		.flatMap((chunk) => Object.keys(chunk.modules ?? {}))
		.filter((id) => /zod[\\/]v4[\\/](classic[\\/]|core[\\/]to-json-schema)/.test(id));
	if (classic.length > 0) {
		throw new Error(`budget: first paint holds what belongs to \`apps\`: ${classic.join(', ')}`);
	}
	// One first paint for every deployment: nothing stage B reads is in it (phase 2 specification, 2.2).
	const stageB = [...initial].filter((name) =>
		/^assets\/(apps|validate\.generated|deployment|surfaces|late|url-sync|switcher|tooltip|sections|project-summary-rows|editor)-/.test(
			name
		)
	);
	if (stageB.length > 0) {
		throw new Error(`budget: first paint holds a chunk of stage B: ${stageB.join(', ')}`);
	}
	// First paint's chunks, by name without their hash: a chunk split off, or merged, by any cause, fails here
	// (step 9's review): a lazy chunk that statically imports what first paint shares parts first paint's
	// chunks, each an import line and its gzip overhead. A deliberate change edits this list in its own step.
	const FIRST_PAINT_CHUNKS = [
		'api',
		'events',
		'focus',
		'icon-registry',
		'index',
		'layout',
		'shell-state',
		'system-close',
		'system-folder',
		'template',
		'types',
		'violet-icon',
		'violet-token-defaults',
		'when',
	];
	const held = [...initial]
		.map((name) => name.replace(/^assets\//, '').replace(/-[\w-]{8}\.js$/, ''))
		.sort();
	if (held.join() !== FIRST_PAINT_CHUNKS.join()) {
		throw new Error(
			`budget: first paint's chunks changed: ${held.join(', ')}, not ${FIRST_PAINT_CHUNKS.join(', ')}`
		);
	}
	// `vite.config.ts`'s `events` group keeps Vite's preload helper in first paint's `events` chunk (step 7):
	// a chunk of its own would cost first paint an import line and its gzip overhead.
	if ([...initial].some((name) => /^assets\/preload-helper-/.test(name))) {
		throw new Error(
			'budget: first paint holds a `preload-helper-` chunk: check the `events` group'
		);
	}
	// Exactly one `events-` chunk, holding the helper and the group's four chrome modules: a module renamed
	// or moved out of the group's pattern fails here, not silently in a larger first paint.
	const events = [...initial].filter((name) => /^assets\/events-/.test(name));
	if (events.length !== 1) {
		throw new Error(
			`budget: first paint holds ${events.length} \`events-\` chunks, not 1: check the \`events\` group`
		);
	}
	const inEvents = Object.keys(chunks.get(events[0]).modules ?? {}).map((id) =>
		id.replace(/\\/g, '/')
	);
	for (const module of [
		'vite/preload-helper',
		'chrome/dist/elements/events.js',
		'chrome/dist/elements/entry-styles.js',
		'chrome/dist/elements/app-entry.js',
		'chrome/dist/elements/notice-loader.js',
	]) {
		if (!inEvents.some((id) => id.includes(module))) {
			throw new Error(
				`budget: first paint's \`events\` chunk does not hold ${module}: check the \`events\` group`
			);
		}
	}
	// With what it imports statically and what loaded before it has not, such as the listbox.
	const closure = (pattern, loaded) => {
		const found = new Set();
		const visitChunk = (fileName) => {
			if (loaded.has(fileName) || found.has(fileName)) return;
			found.add(fileName);
			for (const imported of chunks.get(fileName)?.imports ?? []) visitChunk(imported);
		};
		for (const name of chunks.keys()) if (pattern.test(name)) visitChunk(name);
		return found;
	};
	// In the order a page loads them, so a shared chunk, classic Zod's among them, is charged to the first.
	// `late-documents` is a chunk of its own, with a row of its own, so `late` leaves it out (2.4, step 9).
	// `late-editor` too, step 10's, with a row of its own (2.4, amended 2026-11-07).
	const late = closure(/^assets\/late-(?!documents-|editor-)/, initial);
	if (late.size === 0) throw new Error('budget: the build has no `late` chunk to measure');
	// `loadLate` awaits it before stage B's last `setAppCommands`, so it loads after `late` and before `apps`.
	const lateDocuments = closure(/^assets\/late-documents-/, new Set([...initial, ...late]));
	if (lateDocuments.size === 0) {
		throw new Error('budget: the build has no `late-documents` chunk to measure');
	}
	// Awaited beside it in `loadLate`, so charged after `late` and `late-documents`, before `apps`.
	const lateEditor = closure(
		/^assets\/late-editor-/,
		new Set([...initial, ...late, ...lateDocuments])
	);
	if (lateEditor.size === 0) {
		throw new Error('budget: the build has no `late-editor` chunk to measure');
	}
	const afterLate = new Set([...initial, ...late, ...lateDocuments, ...lateEditor]);
	// The bundler parts the kernel's `src/apps/` from the validators, because the host reads with them too.
	const apps = closure(/^assets\/(apps|validate\.generated|deployment)-/, afterLate);
	if (apps.size < 3) throw new Error('budget: the build has no `apps` chunks to measure');
	const afterApps = new Set([...afterLate, ...apps]);
	// The URL's chunk loads when stage B ends, after `apps` and before the surfaces start (6.3).
	const url = closure(/^assets\/url-sync-/, afterApps);
	if (url.size === 0) throw new Error('budget: the build has no `url-sync` chunk to measure');
	const afterUrl = new Set([...afterApps, ...url]);
	const surfaces = closure(/^assets\/surfaces-/, afterUrl);
	// What a view app or a console adds when it opens: the surfaces have loaded by then.
	const afterSurfaces = new Set([...afterUrl, ...surfaces]);
	const view = closure(/^assets\/view-/, afterSurfaces);
	if (view.size === 0) throw new Error('budget: the build has no `view` chunk to measure');
	const consoleFiles = closure(/^assets\/console-/, afterSurfaces);
	const mount = closure(/^assets\/mount-/, afterSurfaces);
	if (mount.size === 0) throw new Error('budget: the build has no `mount` chunk to measure');
	// The project switcher's list, loaded on its first press (phase 2 specification, 7.2): in "the rest" of
	// 2.4's load order, so charged after the surfaces.
	const switcher = closure(/^assets\/switcher-/, afterSurfaces);
	if (switcher.size === 0) throw new Error('budget: the build has no `switcher` chunk to measure');
	// The same press on an empty shell, which loads no `apps` and never `surfaces` (7.8): what it downloads
	// after first paint, `late` and `url-sync`, the kit's listbox and option among it (2.4,
	// `switcherColdMinified`, approved by the coordinator on 2026-11-03).
	const cold = new Set([...afterLate, ...closure(/^assets\/url-sync-/, afterLate)]);
	const switcherCold = closure(/^assets\/switcher-/, cold);
	// The rail's tooltip, loaded on its first hover, focus or press, which can come before `late` (7.5).
	const tooltip = closure(/^assets\/tooltip-/, initial);
	if (tooltip.size === 0) throw new Error('budget: the build has no `tooltip` chunk to measure');
	// The projects section (phase 2 specification, 7.7), loaded when main first shows it, in "the rest" of
	// 2.4's order, so after the surfaces; with the kernel's summary rows, which `project-summary-get` loads on
	// its first call, from the section's home: what showing the section costs.
	const sections = closure(/^assets\/(sections|project-summary-rows)-/, afterSurfaces);
	if (closure(/^assets\/sections-/, afterSurfaces).size === 0) {
		throw new Error('budget: the build has no `sections` chunk to measure');
	}
	// The editor area (documents specification, 5 and 12), loaded by the URL's chunk on the first document
	// opened, restored or routed to: in "the rest" of 2.4's order, after the surfaces, which hold the app
	// surfaces' `host()` its frames mount through.
	const editor = closure(/^assets\/editor-/, afterSurfaces);
	if (editor.size === 0) throw new Error('budget: the build has no `editor` chunk to measure');
	// The documents section (documents specification, 8 and 12), loaded by the URL's chunk beside the editor
	// area's, with `loam-tree` and `violet-tree`, which an app's tree sidebar loads this chunk for: in "the
	// rest" of 2.4's order, after the surfaces.
	const documents = closure(/^assets\/documents-/, afterSurfaces);
	if (documents.size === 0)
		throw new Error('budget: the build has no `documents` chunk to measure');
	// The New menu with `violet-menu` (documents specification, 7 and 12), loaded on the New button's first
	// press or the palette's first `new` query, after the surfaces as the rest are.
	const newMenu = closure(/^assets\/new-menu-/, afterSurfaces);
	if (newMenu.size === 0) throw new Error('budget: the build has no `new` chunk to measure');
	const sizeOf = (files) =>
		[...files].reduce((sum, name) => sum + Buffer.byteLength(chunks.get(name).code), 0);
	const js = initialChunks.map((chunk) => Buffer.from(chunk.code));
	const gzipOf = (code) => gzipSync(code, { level: 9 }).length;
	const cssAssets = output.filter((item) => item.type === 'asset' && css.includes(item.fileName));
	// loam-theme.css is adopted through a constructable stylesheet, so it ships inside the entry.
	let inlineCss = 0;
	for (const chunk of initialChunks)
		for (const [id, info] of Object.entries(chunk.modules ?? {}))
			if (/\.css\?inline$/.test(id)) inlineCss += info.renderedLength;
	return {
		files: initialChunks.map((chunk) => ({
			file: chunk.fileName,
			bytes: Buffer.byteLength(chunk.code),
			gzip: gzipOf(Buffer.from(chunk.code)),
		})),
		lazy: [...chunks.keys()].filter((name) => !initial.has(name)),
		lateMinified: sizeOf(late),
		lateDocumentsMinified: sizeOf(lateDocuments),
		lateEditorMinified: sizeOf(lateEditor),
		urlMinified: sizeOf(url),
		appsMinified: sizeOf(apps),
		surfacesMinified: sizeOf(surfaces),
		viewMinified: sizeOf(view),
		consoleMinified: sizeOf(consoleFiles),
		mountMinified: sizeOf(mount),
		switcherMinified: sizeOf(switcher),
		switcherColdMinified: sizeOf(switcherCold),
		tooltipMinified: sizeOf(tooltip),
		sectionsMinified: sizeOf(sections),
		editorMinified: sizeOf(editor),
		documentsMinified: sizeOf(documents),
		newMinified: sizeOf(newMenu),
		jsMinified: js.reduce((sum, code) => sum + code.length, 0),
		jsGzip: js.reduce((sum, code) => sum + gzipOf(code), 0),
		cssMinified:
			cssAssets.reduce((sum, asset) => sum + Buffer.byteLength(asset.source), 0) + inlineCss,
		packages: breakdown(initialChunks),
	};
}

async function measureKernel() {
	const outDir = await mkdtemp(join(tmpdir(), 'loam-kernel-budget-'));
	try {
		const entry = fileURLToPath(import.meta.resolve('@lushly-dev/loam-kernel'));
		const result = await build({
			configFile: false,
			root: ROOT,
			logLevel: 'warn',
			plugins: [zodJitlessByDefault(), narrowZodFromJsonSchema()],
			build: {
				outDir,
				emptyOutDir: true,
				write: false,
				target: 'es2022',
				minify: true,
				lib: { entry, formats: ['es'], fileName: 'kernel' },
				// Without `src/apps/` and `src/late/`, which load after first paint. What they widen in the
				// shared Zod is counted on the page's row (9.5).
				rolldownOptions: {
					external: (id) => /[\\/](apps|late)[\\/]index\.js$/.test(id),
					output: { codeSplitting: false },
				},
			},
		});
		const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
		const chunks = output.filter((item) => item.type === 'chunk');
		return {
			kernelMinified: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
			packages: breakdown(chunks),
		};
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}
}

/** An app's own bundle, as its build left it: `recorded, not limited` (9.2). */
function appBundle(app) {
	const dist = resolve(ROOT, `../../apps/${app}/dist`);
	if (!existsSync(dist)) return null;
	const files = readdirSync(dist).filter((name) => name.endsWith('.js'));
	const sources = files.map((name) => readFileSync(join(dist, name)));
	return {
		app,
		minified: sources.reduce((sum, source) => sum + source.length, 0),
		gzip: sources.reduce((sum, source) => sum + gzipSync(source, { level: 9 }).length, 0),
	};
}

const ROWS = [
	['jsMinified', 'JavaScript, minified'],
	['jsGzip', 'JavaScript, gzip'],
	['cssMinified', 'CSS, minified, including loam-theme.css'],
	['kernelMinified', '@lushly-dev/loam-kernel alone, minified with Zod Mini'],
	['lateMinified', "The kernel's `late` chunk and its imports, minified"],
	['lateDocumentsMinified', "The kernel's `late-documents` chunk and its imports, minified"],
	['lateEditorMinified', "The kernel's `late-editor` chunk and its imports, minified"],
	['urlMinified', "The chrome's `url-sync` chunk and its imports, minified"],
	['appsMinified', "The kernel's `apps` chunks and imports, with classic Zod"],
	['surfacesMinified', "The chrome's `surfaces` chunk and its imports, minified"],
	['viewMinified', "The chrome's `view` chunk and its imports, minified"],
	['consoleMinified', 'The `console` chunk and its imports, minified'],
	['mountMinified', 'The `mount` chunk and its imports, minified: the MCP client'],
	['switcherMinified', "The chrome's `switcher` chunk and its imports, minified"],
	['switcherColdMinified', 'The `switcher` chunk on an empty shell, with the listbox, minified'],
	['tooltipMinified', "The chrome's `tooltip` chunk and its imports, minified"],
	['sectionsMinified', "The `sections` chunk, with the kernel's summary rows, minified"],
	['editorMinified', "The chrome's `editor` chunk and its imports, minified"],
	['documentsMinified', 'The `documents` chunk, with `loam-tree` and `violet-tree`, minified'],
	['newMinified', 'The `new` chunk, with `violet-menu`, minified'],
];

export async function measure() {
	const page = await measurePage();
	const kernel = await measureKernel();
	const values = { ...page, kernelMinified: kernel.kernelMinified };
	const rows = ROWS.map(([key, label]) => ({
		key,
		label,
		bytes: values[key],
		ceiling: CEILINGS[key],
		over: values[key] > CEILINGS[key],
	}));
	return {
		rows,
		page,
		kernel,
		apps: ['hello', 'tally', 'tasks', 'notes'].map(appBundle).filter(Boolean),
	};
}

async function main() {
	const { rows, page, kernel, apps } = await measure();
	if (process.argv.includes('--json')) {
		console.log(JSON.stringify({ rows, page, kernel, apps }, null, '\t'));
	} else {
		const pad = (text, width) => String(text).padEnd(width);
		console.log('Loaded before first paint:');
		for (const { file, bytes, gzip } of page.files)
			console.log(
				`  ${pad(file, 44)} ${pad(bytes.toLocaleString('en-US'), 8)} gzip ${gzip.toLocaleString('en-US')}`
			);
		if (page.lazy.length) console.log(`Loaded later: ${page.lazy.join(', ')}`);
		for (const row of rows)
			console.log(
				`${pad(row.label, 52)} ${pad(row.bytes.toLocaleString('en-US'), 10)} of ${pad(row.ceiling.toLocaleString('en-US'), 10)} ${row.over ? 'OVER' : `${Math.round((row.bytes / row.ceiling) * 100)}%`}`
			);
		for (const { app, minified, gzip } of apps)
			console.log(
				`${pad(`${app}'s native bundle, recorded`, 52)} ${minified.toLocaleString('en-US')}, gzip ${gzip.toLocaleString('en-US')}`
			);
		console.log('\nThe page by package (rendered bytes, before minification of names):');
		for (const [name, bytes] of page.packages.slice(0, 15))
			console.log(`  ${pad(name, 40)} ${bytes.toLocaleString('en-US')}`);
		console.log('\nThe kernel alone by package:');
		for (const [name, bytes] of kernel.packages.slice(0, 8))
			console.log(`  ${pad(name, 40)} ${bytes.toLocaleString('en-US')}`);
	}
	const over = rows.filter((row) => row.over);
	if (over.length) {
		console.error(`\nbudget: over the ceiling: ${over.map((row) => row.label).join('; ')}`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
