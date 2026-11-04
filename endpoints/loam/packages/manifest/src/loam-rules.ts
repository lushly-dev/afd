/**
 * @fileoverview Loam's own rules beyond the schema (phase 1 specification, 2.4 and section 4). Each
 * has a case in `profile-cases.json`.
 */

import {
	GRANT_CATALOG_V1,
	LAYOUT_DEFAULTS_V0,
	SERVED_GRANTS_V2,
	SHELL_RESERVED_CHORDS_V1,
} from './catalogs.js';
import type { Finding } from './core-rules.js';
import { keyOf, valueAt } from './pointers.js';
import type { ManifestRefusalCode, ManifestV2 } from './types.js';

type Ui = NonNullable<ManifestV2['ui']>;
type Surfaces = NonNullable<Ui['surfaces']>;

const SERVED_GRANTS = SERVED_GRANTS_V2;
const CONTROL = /\p{Cc}/u;
/** Reserved by the HTML standard, though each has a hyphen. */
const RESERVED_ELEMENTS = new Set([
	'annotation-xml',
	'color-profile',
	'font-face',
	'font-face-src',
	'font-face-uri',
	'font-face-format',
	'font-face-name',
	'missing-glyph',
]);
const ELEMENT = /^[a-z][a-z0-9._]*(-[a-z0-9._]*)+$/;

/** The surfaces each kind can use (4.2). A row names what the kind cannot. */
const SURFACE_KINDS: Readonly<Record<keyof Surfaces, readonly string[]>> = {
	rail: ['native', 'view', 'mounted'],
	sidebar: ['native', 'view'],
	header: ['native', 'view'],
	main: ['native', 'view'],
	inspector: ['native'],
	panel: ['native'],
	status: ['native', 'view'],
	keybindings: ['native', 'view'],
};

class Findings {
	readonly refusals: Finding[] = [];
	readonly warnings: Finding[] = [];

	refuse(code: ManifestRefusalCode, pointer: string, message: string, suggestion: string): void {
		this.refusals.push({ code, pointer, message, suggestion });
	}
}

interface VersionKey {
	readonly pointer: string;
	/** A value of a key version 1 also has. */
	readonly value?: unknown;
}

/**
 * The keys and values that only a version 2 manifest may hold (phase 2 specification, 8.3). One
 * entry each: `manifest-version-keys` refuses every one under `manifest_version = 1`, so a version 1
 * manifest means what it meant. A pointer with a `value` is a value of a key version 1 also has.
 */
export const VERSION_TWO_KEYS: readonly VersionKey[] = [
	{ pointer: '/app/resource_keys' },
	{ pointer: '/ui/surfaces/sidebar/shape', value: 'tree' },
	{ pointer: '/ui/project_summary' },
	{ pointer: '/ui/documents' },
	{ pointer: '/ui/new' },
];

/**
 * The version 2 keys no step has served yet, each refused as `MANIFEST_SURFACE_UNAVAILABLE` under
 * `manifest_version = 2`. **Delete the one line of the step that serves a key**, in the pull request
 * of that step, with the `not-yet-served-*` cases in `profile-cases.json` that name it (phase 2
 * specification, 16, step 3). The key then reads as the schema says, and its own rules arrive with
 * that step. Step 4 served `app.resource_keys` (`resourceKeyRules`), with kernel interface 2, which
 * holds a `ManifestV2`, so nothing narrows a manifest any longer. Step 6 served the `tree` sidebar, whose
 * one rule, a `command`, the schema holds.
 */
export const NOT_YET_SERVED: readonly (VersionKey & { readonly instead?: string })[] = [
	// Step 7 serves `ui.project_summary`. Its rules: `MANIFEST_SUMMARY_INVALID`, not `mounted`.
	{ pointer: '/ui/project_summary' },
	// Step 9 serves `ui.documents`. Its rules are the documents specification's 2.1, and `content_schema`'s `MANIFEST_NOT_PACKED`.
	{ pointer: '/ui/documents' },
	// Step 11 serves `ui.new`. Its rules: `MANIFEST_COMMAND_UNKNOWN`, `MANIFEST_COMMAND_NEEDS_INPUT`.
	{ pointer: '/ui/new' },
];

const holds = (document: unknown, key: VersionKey): boolean => {
	const found = valueAt(document, key.pointer);
	return key.value === undefined ? found !== undefined : found === key.value;
};

const describeKey = (key: VersionKey): string =>
	key.value === undefined
		? `\`${keyOf(key.pointer)}\``
		: `\`${keyOf(key.pointer)} = ${JSON.stringify(key.value)}\``;

/**
 * The version 2 keys a version 1 document holds, each refused with the version. It reads the raw
 * document, so a key is told the version whatever its shape: phase 1 refused these keys before it
 * looked inside them, and a version 1 manifest keeps that.
 */
export function versionKeyFindings(document: unknown): Finding[] {
	if (valueAt(document, '/manifest_version') !== 1) return [];
	return VERSION_TWO_KEYS.filter((key) => holds(document, key)).map((key) => ({
		code: 'MANIFEST_SURFACE_UNAVAILABLE',
		pointer: key.pointer,
		message: `${describeKey(key)} is a key of version 2, and this manifest says \`manifest_version = 1\`.`,
		suggestion: 'Set manifest_version = 2.',
	}));
}

function versionRules(manifest: ManifestV2, found: Findings): void {
	found.refusals.push(...versionKeyFindings(manifest));
	// A version 1 manifest is told one thing at a time: the version first.
	if (manifest.manifest_version === 1) return;
	for (const key of NOT_YET_SERVED) {
		if (holds(manifest, key)) {
			found.refuse(
				'MANIFEST_SURFACE_UNAVAILABLE',
				key.pointer,
				`${describeKey(key)} is part of phase 2, and no build serves it yet.`,
				key.instead ?? `Remove ${describeKey(key)} until phase 2 serves it.`
			);
		}
	}
}

function packedRules(manifest: ManifestV2, found: Findings): void {
	const refuse = (pointer: string): void => {
		found.refuse(
			'MANIFEST_NOT_PACKED',
			pointer,
			'This manifest still holds a schema path, which the kernel cannot read.',
			'Run `loam app pack`, which inlines each schema into `app-manifest.json`.'
		);
	};
	(manifest.commands ?? []).forEach((command, index) => {
		if (typeof command.input_schema === 'string') refuse(`/commands/${index}/input_schema`);
		if (typeof command.returns === 'string') refuse(`/commands/${index}/returns`);
	});
	if (typeof manifest.config?.schema === 'string') refuse('/config/schema');
}

function identityRules(manifest: ManifestV2, found: Findings): void {
	const { id, domains } = manifest.plugin;
	if (domains.length !== 1 || domains[0] !== id) {
		found.refuse(
			'MANIFEST_DOMAIN_INVALID',
			'/plugin/domains',
			'An app has one domain, its id.',
			`Set \`plugin.domains\` to \`["${id}"]\`.`
		);
	}
	const { kind } = manifest.plugin;
	if (kind === 'view' && (manifest.commands?.length ?? 0) > 0 && !manifest.view?.handlers) {
		found.refuse(
			'MANIFEST_SECTION_KIND',
			'/view/handlers',
			"A view app's commands run in a handler frame, which `view.handlers` declares.",
			'Add `[view]` with `handlers`, or remove the commands.'
		);
	}
}

function grantRules(manifest: ManifestV2, found: Findings): void {
	const grants = manifest.grants ?? [];
	if (manifest.plugin.kind === 'mounted') {
		grants.forEach((grant, index) => {
			found.refuse(
				'GRANT_NOT_APPLICABLE',
				`/grants/${index}`,
				`A mounted app declares no grants: \`${grant.name}\` would grant it nothing.`,
				'Remove the grant. A mounted server keeps its own services.'
			);
		});
		return;
	}
	const declared = new Set(grants.map((grant) => grant.name));
	const names = GRANT_CATALOG_V1.map((grant) => grant.name).join(', ');
	grants.forEach((grant, index) => {
		const entry = GRANT_CATALOG_V1.find((known) => known.name === grant.name);
		if (!entry) {
			found.refuse(
				'GRANT_UNKNOWN',
				`/grants/${index}/name`,
				`\`${grant.name}\` is not a grant.`,
				`The grant catalog: ${names}.`
			);
		} else if (grant.required !== false && !SERVED_GRANTS.includes(grant.name)) {
			const when =
				entry.servedFrom === 'collaboration'
					? 'the collaboration specification'
					: `phase ${entry.servedFrom}`;
			found.refuse(
				'GRANT_UNAVAILABLE',
				`/grants/${index}/name`,
				`The grant \`${grant.name}\` is served from ${when}.`,
				`Set \`required = false\` to load without it, or wait for ${when}.`
			);
		}
	});
	(manifest.commands ?? []).forEach((command, index) => {
		const needs = (effect: string, grant: string): void => {
			if ((command.effects as readonly string[]).includes(effect) && !declared.has(grant)) {
				found.refuse(
					'GRANT_REQUIRED',
					`/commands/${index}/effects`,
					`\`${effect}\` needs the \`${grant}\` grant.`,
					`Declare \`[[grants]] name = "${grant}"\`.`
				);
			}
		};
		needs('store-write', 'store');
		needs('external', 'http');
	});
}

function toolMetaRules(manifest: ManifestV2, found: Findings): void {
	const resources = new Set((manifest.ui?.resources ?? []).map((resource) => resource.uri));
	(manifest.commands ?? []).forEach((command, index) => {
		const meta = (command.tool_meta ?? {}) as Record<string, unknown>;
		for (const key of Object.keys(meta)) {
			if (key.toLowerCase().startsWith('dev.loam/')) {
				found.refuse(
					'MANIFEST_TOOL_META_INVALID',
					`/commands/${index}/tool_meta/${key.replaceAll('/', '~1')}`,
					"`dev.loam/` keys are the host's own: the kernel sets them.",
					'Use a prefix of your own.'
				);
			}
		}
		const ui = meta.ui as { resourceUri?: unknown } | undefined;
		if (typeof ui?.resourceUri === 'string' && !resources.has(ui.resourceUri)) {
			found.refuse(
				'MANIFEST_RESOURCE_UNKNOWN',
				`/commands/${index}/tool_meta/ui`,
				`\`ui.resourceUri\` \`${ui.resourceUri}\` is not in \`ui.resources\`.`,
				'Declare it in `ui.resources`.'
			);
		}
	});
}

function resourceRules(manifest: ManifestV2, found: Findings): void {
	const resources = manifest.ui?.resources ?? [];
	const prefix = `ui://${manifest.plugin.id}/`;
	const seen = new Set<string>();
	resources.forEach((resource, index) => {
		if (!resource.uri.startsWith(prefix) || resource.uri.length === prefix.length) {
			found.refuse(
				'MANIFEST_RESOURCE_UNKNOWN',
				`/ui/resources/${index}/uri`,
				`\`${resource.uri}\` is outside \`${prefix}\`.`,
				`Name it \`${prefix}<name>\`.`
			);
		}
		if (seen.has(resource.uri)) {
			found.refuse(
				'MANIFEST_DUPLICATE',
				`/ui/resources/${index}/uri`,
				`The resource \`${resource.uri}\` is repeated.`,
				'Give each resource its own URI.'
			);
		}
		seen.add(resource.uri);
		if (resource.csp) {
			found.warnings.push({
				code: 'VIEW_CSP_IGNORED',
				pointer: `/ui/resources/${index}/csp`,
				message: 'Phase 1 serves no `_meta.ui.csp`: a view runs under the default policy.',
				suggestion: 'Keep `csp` only for hosts that read it.',
			});
		}
		if (resource.permissions) {
			found.warnings.push({
				code: 'VIEW_CSP_IGNORED',
				pointer: `/ui/resources/${index}/permissions`,
				message: 'Phase 1 grants a view no permission.',
				suggestion: 'Keep `permissions` only for hosts that read it.',
			});
		}
	});
}

function surfaceRules(manifest: ManifestV2, found: Findings): void {
	const surfaces = manifest.ui?.surfaces;
	if (!surfaces) return;
	const { kind } = manifest.plugin;
	for (const surface of Object.keys(surfaces) as (keyof Surfaces)[]) {
		if (!SURFACE_KINDS[surface].includes(kind)) {
			found.refuse(
				'MANIFEST_SURFACE_KIND',
				`/ui/surfaces/${surface}`,
				`A \`${kind}\` app cannot use the surface \`${surface}\`.`,
				kind === 'mounted'
					? 'A mounted manifest admits only `ui.surfaces.rail`: its commands are unknown until discovery.'
					: `Remove \`ui.surfaces.${surface}\`, or use kind \`native\`.`
			);
		}
	}
	const { sidebar, main } = surfaces;
	if (kind === 'view' && sidebar && sidebar.shape === 'custom') {
		found.refuse(
			'MANIFEST_SURFACE_KIND',
			'/ui/surfaces/sidebar/shape',
			"A view app's sidebar is a `list` or a `tree`: no element of it runs in the shell's page.",
			'Set `shape = "list"`, or `"tree"` from version 2.'
		);
	}
	if (main && kind === 'native' && (main.resource !== undefined || main.command !== undefined)) {
		found.refuse(
			'MANIFEST_SURFACE_KIND',
			'/ui/surfaces/main',
			'A native main is an `element`.',
			'Remove `resource` and `command`.'
		);
	}
	if (main && kind === 'native' && main.element === undefined) {
		found.refuse(
			'MANIFEST_SURFACE_KIND',
			'/ui/surfaces/main/element',
			'A native main needs an `element`.',
			'Name the element, or remove `ui.surfaces.main` for the console.'
		);
	}
	if (main && kind === 'view' && (main.element !== undefined || main.resource === undefined)) {
		found.refuse(
			'MANIFEST_SURFACE_KIND',
			'/ui/surfaces/main',
			'A view main is a `resource`, with an optional `command`.',
			'Name one of `ui.resources` in `resource`, and remove `element`.'
		);
	}
	elementRules(surfaces, found);
	commandRules(manifest, surfaces, found);
	const resources = new Set((manifest.ui?.resources ?? []).map((resource) => resource.uri));
	if (main?.resource !== undefined && !resources.has(main.resource)) {
		found.refuse(
			'MANIFEST_RESOURCE_UNKNOWN',
			'/ui/surfaces/main/resource',
			`\`${main.resource}\` is not in \`ui.resources\`.`,
			'Declare it in `ui.resources`.'
		);
	}
	chordRules(surfaces, found);
	const repeated = (
		values: readonly string[],
		at: (index: number) => string,
		what: string
	): void => {
		const seen = new Set<string>();
		values.forEach((value, index) => {
			if (seen.has(value)) {
				found.refuse(
					'MANIFEST_DUPLICATE',
					at(index),
					`${what} \`${value}\` is repeated.`,
					'Give each its own id.'
				);
			}
			seen.add(value);
		});
	};
	repeated(
		(surfaces.panel?.views ?? []).map((view) => view.id),
		(index) => `/ui/surfaces/panel/views/${index}/id`,
		'The panel view'
	);
	repeated(
		(surfaces.status?.items ?? []).map((item) => item.id),
		(index) => `/ui/surfaces/status/items/${index}/id`,
		'The status item'
	);
	repeated(
		(surfaces.keybindings ?? []).map((binding) => binding.chord),
		(index) => `/ui/surfaces/keybindings/${index}/chord`,
		'The chord'
	);
}

function elementRules(surfaces: Surfaces, found: Findings): void {
	const check = (element: string | undefined, pointer: string): void => {
		if (element === undefined) return;
		if (
			!ELEMENT.test(element) ||
			RESERVED_ELEMENTS.has(element) ||
			element.startsWith('loam-') ||
			element.startsWith('violet-')
		) {
			found.refuse(
				'MANIFEST_ELEMENT_INVALID',
				pointer,
				`\`${element}\` is not a custom element name an app may use.`,
				'Use lowercase with a hyphen, not starting `loam-` or `violet-`: `hello-main`.'
			);
		}
	};
	check(surfaces.sidebar?.element, '/ui/surfaces/sidebar/element');
	check(surfaces.main?.element, '/ui/surfaces/main/element');
	check(surfaces.inspector?.element, '/ui/surfaces/inspector/element');
	(surfaces.panel?.views ?? []).forEach((view, index) => {
		check(view.element, `/ui/surfaces/panel/views/${index}/element`);
	});
}

function commandRules(manifest: ManifestV2, surfaces: Surfaces, found: Findings): void {
	const declared = new Set((manifest.commands ?? []).map((command) => command.name));
	const check = (command: string | undefined, pointer: string): void => {
		if (command !== undefined && !declared.has(command)) {
			found.refuse(
				'MANIFEST_COMMAND_UNKNOWN',
				pointer,
				`\`${command}\` is not a command this manifest declares.`,
				'Declare it in `commands`, or name one that is.'
			);
		}
	};
	check(surfaces.sidebar?.command, '/ui/surfaces/sidebar/command');
	check(surfaces.main?.command, '/ui/surfaces/main/command');
	(surfaces.header?.actions ?? []).forEach((action, index) => {
		check(action.command, `/ui/surfaces/header/actions/${index}/command`);
	});
	(surfaces.status?.items ?? []).forEach((item, index) => {
		check(item.command, `/ui/surfaces/status/items/${index}/command`);
	});
	(surfaces.keybindings ?? []).forEach((binding, index) => {
		check(binding.command, `/ui/surfaces/keybindings/${index}/command`);
	});
}

function chordRules(surfaces: Surfaces, found: Findings): void {
	(surfaces.keybindings ?? []).forEach((binding, index) => {
		if (SHELL_RESERVED_CHORDS_V1.includes(binding.chord)) {
			found.refuse(
				'KEYBINDING_RESERVED',
				`/ui/surfaces/keybindings/${index}/chord`,
				`The shell keeps \`${binding.chord}\`.`,
				'Choose another chord.'
			);
		}
	});
}

function layoutRules(manifest: ManifestV2, found: Findings): void {
	const layout = manifest.ui?.layout;
	if (!layout) return;
	const bound = (
		value: number | undefined,
		pointer: string,
		min: number,
		max = Number.POSITIVE_INFINITY
	): void => {
		if (value !== undefined && (value < min || value > max)) {
			found.refuse(
				'MANIFEST_LAYOUT_INVALID',
				pointer,
				`${value} is outside the bounds of this part.`,
				max === Number.POSITIVE_INFINITY ? `Use at least ${min}.` : `Use ${min} to ${max}.`
			);
		}
	};
	const { sidebar, inspector, panel } = LAYOUT_DEFAULTS_V0;
	bound(layout.sidebar?.width, '/ui/layout/sidebar/width', sidebar.min, sidebar.max);
	bound(layout.inspector?.width, '/ui/layout/inspector/width', inspector.min, inspector.max);
	bound(layout.panel?.height, '/ui/layout/panel/height', panel.min);
}

function compositionRules(manifest: ManifestV2, found: Findings): void {
	(manifest.ui?.compositions ?? []).forEach((name, index) => {
		if (name !== 'list-detail') return;
		const surfaces = manifest.ui?.surfaces;
		if (surfaces?.sidebar?.shape !== 'list' || !surfaces.main) {
			found.refuse(
				'MANIFEST_COMPOSITION_INCOMPLETE',
				`/ui/compositions/${index}`,
				'`list-detail` needs a `list` sidebar and a main.',
				'Declare `ui.surfaces.sidebar` with `shape = "list"`, and `ui.surfaces.main`.'
			);
		}
	});
}

/** `text` over Loam's own display keys, which reach a person's screen as the core's do. */
function textRules(manifest: ManifestV2, found: Findings): void {
	const add = (pointer: string, value: string | undefined): void => {
		if (value !== undefined && CONTROL.test(value)) {
			found.refuse(
				'MANIFEST_TEXT_INVALID',
				pointer,
				"It holds a control character, and it reaches a person's screen.",
				'Remove the control character.'
			);
		}
	};
	const surfaces = manifest.ui?.surfaces;
	add('/ui/surfaces/rail/label', surfaces?.rail?.label);
	add('/ui/surfaces/sidebar/title', surfaces?.sidebar?.title);
	add('/ui/surfaces/header/title', surfaces?.header?.title);
	add('/ui/surfaces/inspector/title', surfaces?.inspector?.title);
	(surfaces?.header?.actions ?? []).forEach((action, index) => {
		add(`/ui/surfaces/header/actions/${index}/label`, action.label);
	});
	(surfaces?.panel?.views ?? []).forEach((view, index) => {
		add(`/ui/surfaces/panel/views/${index}/title`, view.title);
	});
	(surfaces?.status?.items ?? []).forEach((item, index) => {
		add(`/ui/surfaces/status/items/${index}/label`, item.label);
	});
	(manifest.ui?.resources ?? []).forEach((resource, index) => {
		add(`/ui/resources/${index}/title`, resource.title);
	});
}

/**
 * `app.resource_keys` (phase 2 specification, 8.3): each names a declared command and a property of its
 * input schema; the app needs the `store` grant, whose keys they are; a mounted app has no store.
 */
function resourceKeyRules(manifest: ManifestV2, found: Findings): void {
	const keys = manifest.app?.resource_keys;
	if (keys === undefined) return;
	const pointer = '/app/resource_keys';
	const refuse = (at: string, message: string, suggestion: string): void =>
		found.refuse('MANIFEST_RESOURCE_KEY_INVALID', at, message, suggestion);
	if (manifest.plugin.kind === 'mounted') {
		refuse(
			pointer,
			'A mounted app has no store, so it names no store keys.',
			'Remove `app.resource_keys`; the instance pins its own space.'
		);
		return;
	}
	if (!(manifest.grants ?? []).some((grant) => grant.name === 'store')) {
		refuse(
			pointer,
			'`app.resource_keys` names keys of the `store` grant, which this app does not declare.',
			'Declare the `store` grant, or remove `app.resource_keys`.'
		);
	}
	for (const [name, property] of Object.entries(keys)) {
		const command = (manifest.commands ?? []).find((candidate) => candidate.name === name);
		const schema = command?.input_schema;
		const properties =
			typeof schema === 'object' && schema !== null
				? (schema as { properties?: Record<string, unknown> }).properties
				: undefined;
		if (command === undefined) {
			refuse(
				`${pointer}/${name}`,
				`\`${name}\` is not a command of this app.`,
				'Name a command the manifest declares.'
			);
		} else if (typeof schema !== 'string' && !Object.hasOwn(properties ?? {}, property)) {
			refuse(
				`${pointer}/${name}`,
				`The input of \`${name}\` has no property \`${property}\`.`,
				'Name the property of its input schema that holds a store key.'
			);
		}
	}
}

/** Loam's rules, for a manifest that passed the schema. */
export function loamRules(manifest: ManifestV2): { refusals: Finding[]; warnings: Finding[] } {
	const found = new Findings();
	versionRules(manifest, found);
	packedRules(manifest, found);
	identityRules(manifest, found);
	grantRules(manifest, found);
	toolMetaRules(manifest, found);
	resourceRules(manifest, found);
	surfaceRules(manifest, found);
	layoutRules(manifest, found);
	compositionRules(manifest, found);
	resourceKeyRules(manifest, found);
	textRules(manifest, found);
	return found;
}
