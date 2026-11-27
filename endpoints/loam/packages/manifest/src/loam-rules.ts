/**
 * @fileoverview Loam's own rules beyond the schema (phase 1 specification, 2.4 and section 4). Each
 * has a case in `profile-cases.json`.
 */

import {
	GRANT_CATALOG_V1,
	keybindingWhenProblem,
	LAYOUT_DEFAULTS_V0,
	SERVED_GRANTS_V2,
	SHELL_RESERVED_CHORDS_V1,
} from './catalogs.js';
import { type Finding, needsInput } from './core-rules.js';
import { documentRules } from './document-rules.js';
import { experimentRules } from './experiments.js';
import { keyOf, valueAt } from './pointers.js';
import { settingRules } from './settings.js';
import type { ManifestRefusalCode, ManifestV3 } from './types.js';

type Ui = NonNullable<ManifestV3['ui']>;
type Surfaces = NonNullable<Ui['surfaces']>;

const SERVED_GRANTS = SERVED_GRANTS_V2;
/** A control character, or a bidirectional formatting one, which can reorder what a person reads. */
const CONTROL = /[\p{Cc}\p{Bidi_Control}]/u;
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
	// Phase 4's step 1: a key of version 2, as phase 4 adds no manifest version (its 12.1).
	{ pointer: '/ui/settings' },
	// Phase 4's step 6: a command's `confirm_prompt` (7.2), each command's; `*` is an index.
	{ pointer: '/commands/*/confirm_prompt' },
	// Phase 3's step 8: an app's account section (its 5.5), refused in version 1 by D76's rule.
	{ pointer: '/ui/account' },
	// Phase 4's step 9: experiments (5.1) and the gates that name one (5.3).
	{ pointer: '/ui/experiments' },
	{ pointer: '/app/requires_experiment' },
	{ pointer: '/ui/settings/*/requires_experiment' },
	{ pointer: '/ui/surfaces/sidebar/requires_experiment' },
	{ pointer: '/ui/surfaces/header/requires_experiment' },
	{ pointer: '/ui/surfaces/inspector/requires_experiment' },
	{ pointer: '/ui/surfaces/panel/requires_experiment' },
	{ pointer: '/ui/surfaces/status/requires_experiment' },
];

/**
 * The keys only a version 3 manifest may hold (phase 5 specification, 9.1): core version 2's `expose.apps`, each
 * command's. `manifest-version-keys` refuses each under `manifest_version` 1 or 2, so those versions mean what they meant.
 */
export const VERSION_THREE_KEYS: readonly VersionKey[] = [{ pointer: '/commands/*/expose/apps' }];

/** The concrete pointers of `key` a document holds: one at most, or one per item where the key has a `*`. */
const heldAt = (document: unknown, key: VersionKey): string[] => {
	const star = key.pointer.indexOf('/*/');
	const pointers =
		star < 0
			? [key.pointer]
			: (() => {
					const list = valueAt(document, key.pointer.slice(0, star));
					return Array.isArray(list)
						? list.map((_, index) => key.pointer.replace('/*/', `/${index}/`))
						: [];
				})();
	return pointers.filter((pointer) => {
		const found = valueAt(document, pointer);
		return key.value === undefined ? found !== undefined : found === key.value;
	});
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
	const version = valueAt(document, '/manifest_version');
	// Version 3's keys under version 1 or 2 (phase 5 specification, 9.1), each told the version that holds it.
	const three =
		version === 1 || version === 2
			? VERSION_THREE_KEYS.flatMap((key) =>
					heldAt(document, key).map((pointer) => ({
						code: 'MANIFEST_SURFACE_UNAVAILABLE' as const,
						pointer,
						message: `${describeKey({ ...key, pointer })} is a key of version 3, and this manifest says \`manifest_version = ${version}\`.`,
						suggestion: 'Set manifest_version = 3.',
					}))
				)
			: [];
	if (version !== 1) return three;
	// Each place a key of version 2 is held, a command's `confirm_prompt` among them (step 6), and a keybinding's
	// sequence or `when` (step 7).
	const keys = VERSION_TWO_KEYS.flatMap((key) =>
		heldAt(document, key).map((pointer) => ({ pointer, said: describeKey({ ...key, pointer }) }))
	);
	return [
		...[...keys, ...versionTwoKeybindings(document)].map(({ pointer, said }) => ({
			code: 'MANIFEST_SURFACE_UNAVAILABLE' as const,
			pointer,
			message: `${said} is a key of version 2, and this manifest says \`manifest_version = 1\`.`,
			suggestion: 'Set manifest_version = 2.',
		})),
		...three,
	];
}

/**
 * A keybinding's version 2 parts (phase 4 specification, 12.1, step 7): a sequence of two chords, and `when`. Phase 4
 * adds no manifest version, so a version 1 manifest holding one is told the version, as for `VERSION_TWO_KEYS`.
 */
export function versionTwoKeybindings(document: unknown): Array<{ pointer: string; said: string }> {
	const bindings = valueAt(document, '/ui/surfaces/keybindings');
	if (!Array.isArray(bindings)) return [];
	return bindings.flatMap((binding: unknown, index) => {
		if (typeof binding !== 'object' || binding === null) return [];
		const { chord, when } = binding as { chord?: unknown; when?: unknown };
		const at = `/ui/surfaces/keybindings/${index}`;
		return [
			...(typeof chord === 'string' && chord.includes(' ')
				? [{ pointer: `${at}/chord`, said: `A sequence of two chords (\`${chord}\`)` }]
				: []),
			...(when !== undefined ? [{ pointer: `${at}/when`, said: '`when`' }] : []),
		];
	});
}

/**
 * A version 1 manifest's version 2 keys. Each version 2 key was refused as `MANIFEST_SURFACE_UNAVAILABLE`
 * until the step that served it (phase 2 specification, 16, step 3); step 11 served the last, `ui.new`, and
 * took that list and its loop away with it, so a later key arrives with a manifest version of its own.
 */
function versionRules(manifest: ManifestV3, found: Findings): void {
	found.refusals.push(...versionKeyFindings(manifest));
}

function packedRules(manifest: ManifestV3, found: Findings): void {
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
	(manifest.ui?.documents ?? []).forEach((type, index) => {
		if (typeof type.content_schema === 'string') refuse(`/ui/documents/${index}/content_schema`);
	});
}

function identityRules(manifest: ManifestV3, found: Findings): void {
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

function grantRules(manifest: ManifestV3, found: Findings): void {
	const grants = manifest.grants ?? [];
	const calls = manifest.calls ?? [];
	if (manifest.plugin.kind === 'mounted') {
		calls.forEach((_call, index) => {
			found.refuse(
				'GRANT_NOT_APPLICABLE',
				`/calls/${index}`,
				'A mounted app calls no other app: `[[calls]]` would grant it nothing.',
				'Remove `[[calls]]`. A mounted server keeps its own services.'
			);
		});
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
	// What a `calls` grant reaches is named in `[[calls]]` (phase 5 specification, 7.5): the one without the other is refused.
	if (calls.length > 0 && !declared.has('calls')) {
		found.refuse(
			'GRANT_REQUIRED',
			'/calls',
			'`[[calls]]` needs the `calls` grant.',
			'Declare `[[grants]] name = "calls"`, with the reason this app calls another.'
		);
	}
	calls.forEach((call, index) => {
		if (call.app === manifest.plugin.id) {
			found.refuse(
				'GRANT_NOT_APPLICABLE',
				`/calls/${index}/app`,
				'An app calls its own commands without a grant.',
				'Name another app in `[[calls]]`, or remove the entry.'
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

function toolMetaRules(manifest: ManifestV3, found: Findings): void {
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

function resourceRules(manifest: ManifestV3, found: Findings): void {
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

function surfaceRules(manifest: ManifestV3, found: Findings): void {
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

/** A custom element name an app may use, or `MANIFEST_ELEMENT_INVALID`. */
const elementCheck =
	(found: Findings) =>
	(element: string | undefined, pointer: string): void => {
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

function elementRules(surfaces: Surfaces, found: Findings): void {
	const check = elementCheck(found);
	check(surfaces.sidebar?.element, '/ui/surfaces/sidebar/element');
	check(surfaces.main?.element, '/ui/surfaces/main/element');
	check(surfaces.inspector?.element, '/ui/surfaces/inspector/element');
	(surfaces.panel?.views ?? []).forEach((view, index) => {
		check(view.element, `/ui/surfaces/panel/views/${index}/element`);
	});
}

function commandRules(manifest: ManifestV3, surfaces: Surfaces, found: Findings): void {
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
		const at = `/ui/surfaces/keybindings/${index}`;
		const [first, second] = binding.chord.split(' ') as [string, string | undefined];
		if (SHELL_RESERVED_CHORDS_V1.includes(first)) {
			// Phase 4 specification, 8.1: a sequence never begins on a reserved chord either, which it would delay.
			found.refuse(
				'KEYBINDING_RESERVED',
				`${at}/chord`,
				second === undefined
					? `The shell keeps \`${first}\`.`
					: `A sequence never begins on \`${first}\`, which the shell keeps.`,
				second === undefined
					? 'Choose another chord.'
					: 'Choose another chord to begin the sequence.'
			);
		} else if (second === 'F6' || second === 'Shift+F6') {
			// F6 and Shift+F6 move focus between the parts, never a sequence's end either (8.3; step 7's reviews, 5).
			found.refuse(
				'KEYBINDING_RESERVED',
				`${at}/chord`,
				`The shell keeps \`${second}\`, which moves focus between the parts.`,
				'Choose another chord to end the sequence.'
			);
		} else if (second !== undefined && !first.split('+').includes('Mod')) {
			found.refuse(
				'MANIFEST_KEYBINDING_KEYS',
				`${at}/chord`,
				`A sequence's first chord has Mod, and \`${first}\` has not.`,
				'Begin the sequence with a Mod chord, such as `Mod+G P`.'
			);
		}
		const when = (binding as { when?: string }).when;
		const problem = when === undefined ? undefined : keybindingWhenProblem(when);
		if (problem !== undefined) {
			found.refuse(
				'MANIFEST_KEYBINDING_WHEN',
				`${at}/when`,
				`The \`when\` ${problem}.`,
				'Use editor, sidebar, main, project, !project or documentType == <type>, joined by " && ".'
			);
		}
	});
}

function layoutRules(manifest: ManifestV3, found: Findings): void {
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

function compositionRules(manifest: ManifestV3, found: Findings): void {
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
function textRules(manifest: ManifestV3, found: Findings): void {
	const add = (pointer: string, value: string | undefined): void => {
		if (value !== undefined && CONTROL.test(value)) {
			found.refuse(
				'MANIFEST_TEXT_INVALID',
				pointer,
				"It holds a control or bidirectional formatting character, and it reaches a person's screen.",
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
	(manifest.ui?.new ?? []).forEach((entry, index) => {
		add(`/ui/new/${index}/title`, entry.title);
	});
	(manifest.ui?.account ?? []).forEach((section, index) => {
		add(`/ui/account/${index}/title`, section.title);
	});
	(manifest.ui?.documents ?? []).forEach((type, index) => {
		add(`/ui/documents/${index}/title`, type.title);
		type.templates.forEach((template, at) => {
			add(`/ui/documents/${index}/templates/${at}/title`, template.title);
		});
	});
}

/**
 * `app.resource_keys` (phase 2 specification, 8.3): each names a declared command and a property of its
 * input schema; the app needs the `store` grant, whose keys they are; a mounted app has no store.
 */
function resourceKeyRules(manifest: ManifestV3, found: Findings): void {
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

/**
 * `ui.project_summary` (phase 2 specification, 7.7 and 8.3): a declared command with `effects =
 * ["inspect"]` that needs no input and is linked to no view's resource, for a native or view app whose
 * levels include `project`, since it runs at a project's scope with `{}` and outside any surface. A mounted
 * app's commands are unknown until discovery, so it has none. One refusal, the first that applies.
 */
function summaryRules(manifest: ManifestV3, found: Findings): void {
	const command = manifest.ui?.project_summary?.command;
	if (command === undefined) return;
	const declared = manifest.commands?.find((candidate) => candidate.name === command);
	const required = (declared?.input_schema as { required?: unknown[] } | undefined)?.required;
	const why =
		manifest.plugin.kind === 'mounted'
			? 'A mounted app has no project summary'
			: !manifest.app?.scope_levels?.includes('project')
				? 'A project summary runs in a project, and this app takes none'
				: !declared
					? `\`${command}\` is not a command this manifest declares`
					: (declared.effects as readonly string[]).join() !== 'inspect'
						? `\`${command}\` must have \`effects = ["inspect"]\``
						: required?.length
							? `\`${command}\` needs input, and a summary is called with \`{}\``
							: (declared.tool_meta?.ui as { resourceUri?: unknown } | undefined)?.resourceUri !==
									undefined
								? `\`${command}\` is linked to a view's resource, and a summary runs outside any view`
								: '';
	if (why) {
		found.refuse(
			'MANIFEST_SUMMARY_INVALID',
			'/ui/project_summary',
			`${why}.`,
			'Name a command of this app that only reads, needs no input and names no resource, in an app whose levels include project.'
		);
	}
}

/**
 * What an account section's `surface` shows (phase 3 specification, 5.5): a native app's `main`, `inspector` or custom
 * `sidebar` element, or a view app's `main` resource. Anything else, and every mounted app's, is undefined.
 */
export function accountSurfaceOf(
	manifest: ManifestV3,
	surface: string
): { element: string } | { resource: string } | undefined {
	const surfaces = manifest.ui?.surfaces;
	const { kind } = manifest.plugin;
	if (kind === 'view') {
		const resource = surface === 'main' ? surfaces?.main?.resource : undefined;
		return resource === undefined ? undefined : { resource };
	}
	if (kind !== 'native') return undefined;
	const element =
		surface === 'main'
			? surfaces?.main?.element
			: surface === 'inspector'
				? surfaces?.inspector?.element
				: surface === 'sidebar' && surfaces?.sidebar?.shape === 'custom'
					? surfaces.sidebar.element
					: undefined;
	return element === undefined ? undefined : { element };
}

/**
 * `ui.account` (phase 3 specification, 5.5): none for a mounted app; an app that runs at workspace level, since the
 * section does; each `surface` one the app declares that shows something; each id once. The limit of two is the
 * schema's `maxItems`, which `refusal-map.ts` refuses as `MANIFEST_ACCOUNT_LIMIT`; titles are `textRules`'.
 */
function accountRules(manifest: ManifestV3, found: Findings): void {
	const sections = manifest.ui?.account;
	if (sections === undefined) return;
	// The key itself, empty or not: a mounted manifest has no account section to declare.
	if (manifest.plugin.kind === 'mounted') {
		found.refuse(
			'MANIFEST_ACCOUNT_MOUNTED',
			'/ui/account',
			"A mounted app declares no account section: its surfaces are the server's, unknown until discovery.",
			'Remove `ui.account`.'
		);
		return;
	}
	if (sections.length === 0) return;
	if (!(manifest.app?.scope_levels ?? ['workspace']).includes('workspace')) {
		found.refuse(
			'MANIFEST_ACCOUNT_LEVEL',
			'/ui/account',
			'An account section runs at workspace level, and this app takes only projects.',
			'Add `workspace` to `app.scope_levels`, or remove `ui.account`.'
		);
	}
	const seen = new Set<string>();
	sections.forEach((section, index) => {
		const at = `/ui/account/${index}`;
		if (seen.has(section.id)) {
			found.refuse(
				'MANIFEST_DUPLICATE',
				`${at}/id`,
				`The account section \`${section.id}\` is repeated.`,
				'Give each account section its own id.'
			);
		}
		seen.add(section.id);
		if (!accountSurfaceOf(manifest, section.surface)) {
			found.refuse(
				'MANIFEST_ACCOUNT_SURFACE_UNKNOWN',
				`${at}/surface`,
				`\`${section.surface}\` is not a surface this app declares that an account section can show.`,
				manifest.plugin.kind === 'view'
					? 'Name `main`, with `ui.surfaces.main.resource` declared.'
					: 'Name `main`, `inspector` or a custom `sidebar`, with its `element` declared under `ui.surfaces`.'
			);
		}
	});
}

/**
 * `ui.new` (documents specification, 2.1), for every manifest, with surfaces or none: each creator names a
 * command of this manifest that needs no input, since New calls it with `{}` as the person, in levels the app
 * takes. A mounted manifest declares none: its commands are unknown until discovery, as for its types.
 */
function newRules(manifest: ManifestV3, found: Findings): void {
	const entries = manifest.ui?.new ?? [];
	if (entries.length === 0) return;
	if (manifest.plugin.kind === 'mounted') {
		found.refuse(
			'MANIFEST_SURFACE_KIND',
			'/ui/new',
			'A mounted app declares no creator: its commands are unknown until discovery.',
			'Remove `ui.new`.'
		);
		return;
	}
	const levels = manifest.app?.scope_levels ?? ['workspace'];
	entries.forEach(({ command, scope_levels }, index) => {
		const pointer = `/ui/new/${index}/command`;
		const declared = manifest.commands?.find((candidate) => candidate.name === command);
		if (!declared) {
			found.refuse(
				'MANIFEST_COMMAND_UNKNOWN',
				pointer,
				`\`${command}\` is not a command this manifest declares.`,
				'Declare it in `commands`, or name one that is.'
			);
		} else if (needsInput(declared.input_schema)) {
			found.refuse(
				'MANIFEST_COMMAND_NEEDS_INPUT',
				pointer,
				`\`${command}\` needs input.`,
				'Name a command whose input schema accepts `{}`.'
			);
		}
		if (scope_levels?.some((level) => !levels.includes(level))) {
			found.refuse(
				'MANIFEST_INVALID',
				`/ui/new/${index}/scope_levels`,
				"A creator's levels are a subset of `app.scope_levels`.",
				`Use only ${levels.join(' and ')}, or widen \`app.scope_levels\`.`
			);
		}
	});
}

/**
 * `confirm` is the shell's word (phase 4 specification, 7.2): a command that declares a `confirm_prompt` may not take an
 * input of that name, so `confirm: true` is always refused naming `confirmation-get`, and never reads as an answer.
 */
function confirmRules(manifest: ManifestV3, found: Findings): void {
	(manifest.commands ?? []).forEach((command, index) => {
		if ((command as { confirm_prompt?: unknown }).confirm_prompt === undefined) return;
		const properties =
			(command.input_schema as { properties?: unknown } | string | undefined) ?? {};
		if (typeof properties === 'string') return;
		const declared = (properties as { properties?: Record<string, unknown> }).properties ?? {};
		if (!Object.hasOwn(declared, 'confirm')) return;
		found.refuse(
			'MANIFEST_CONFIRM_UNAVAILABLE',
			`/commands/${index}/input_schema/properties/confirm`,
			'A command with a `confirm_prompt` may not take an input named `confirm`: the shell confirms it, and `confirm: true` never does.',
			'Name the input something else.'
		);
	});
}

/** Loam's rules, for a manifest that passed the schema. */
export function loamRules(manifest: ManifestV3): { refusals: Finding[]; warnings: Finding[] } {
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
	summaryRules(manifest, found);
	accountRules(manifest, found);
	newRules(manifest, found);
	settingRules(manifest, found.refuse.bind(found), found.warnings);
	experimentRules(manifest, found.refuse.bind(found), found.warnings);
	documentRules(manifest, found.refuse.bind(found), elementCheck(found));
	textRules(manifest, found);
	confirmRules(manifest, found);
	return found;
}
