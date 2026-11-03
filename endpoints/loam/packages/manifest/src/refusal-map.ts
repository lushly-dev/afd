/**
 * @fileoverview A validator's errors as refusals (phase 1 specification, 2.5): each names the key,
 * and carries the code and a suggestion of its row.
 */

import { ADMITTED_KEYS } from './_generated/facts.js';
import { COMPOSITIONS_V1, SHELL_DOMAINS_V1, SURFACE_CATALOG_V1 } from './catalogs.js';
import { admittedAt, keyOf, shapeOf, suggestKey, valueAt } from './pointers.js';
import type { ManifestRefusal, ManifestRefusalCode } from './types.js';
import { refusesKey, reportedErrors, type ValidatorError } from './validator-errors.js';

interface Row {
	code: ManifestRefusalCode;
	message: string;
	suggestion: string;
}

const reserved = (message: string, suggestion: string): Row => ({
	code: 'MANIFEST_RESERVED_KEY',
	message,
	suggestion,
});
const umbel = (key: string): Row =>
	reserved(
		`\`${key}\` is a key of Umbel's profile, not Loam's.`,
		`Remove \`${key}\` from a Loam manifest.`
	);
const deployer = (key: string): Row =>
	reserved(
		`\`${key}\` is the deployer's, and never enters a manifest.`,
		`Remove \`${key}\`, and set it in the deployment file's instance entry.`
	);
const later = (key: string, phase: number): Row => ({
	code: 'MANIFEST_SURFACE_UNAVAILABLE',
	message: `\`${key}\` is served from phase ${phase}.`,
	suggestion: `Remove \`${key}\` until phase ${phase}.`,
});
const refused = (key: string, why: string): Row => ({
	code: 'MANIFEST_KEY_REFUSED',
	message: `Loam refuses \`${key}\`: ${why}.`,
	suggestion: `Remove \`${key}\`.`,
});
const wrongKind = (key: string, kinds: string): Row => ({
	code: 'MANIFEST_SECTION_KIND',
	message: `\`${key}\` goes with ${kinds}, and only there.`,
	suggestion: `Remove \`${key}\`, or change \`plugin.kind\` to match it.`,
});

/** The reserved and later-phase rows of 2.2, and each key this profile sets to `false`. */
const KEY_ROWS: Readonly<Record<string, Row>> = {
	'/connectors': reserved(
		'`connectors` is reserved for a federation connector contract.',
		"Remove `connectors`. An agent pack's servers mount as instances of kind `mounted`."
	),
	'/backends': reserved(
		'`backends` is reserved for store backends contributed by plugins.',
		'Remove `backends`.'
	),
	'/dependencies': reserved(
		'`dependencies` stays out of a manifest: plugins do not depend on each other.',
		'Remove `dependencies`.'
	),
	'/signature': reserved('`signature` is reserved for signed plugins.', 'Remove `signature`.'),
	'/scopes': reserved(
		'`scopes` is reserved for per-command authorization.',
		'Remove `scopes`. The levels an app supports are `app.scope_levels`.'
	),
	'/on_conflict': reserved(
		'`on_conflict` is reserved: a conflict across instances is always `error`.',
		'Remove `on_conflict`.'
	),
	'/commands/*/scopes': reserved(
		'`commands[].scopes` is reserved for per-command authorization.',
		'Remove `scopes` from the command.'
	),
	'/commands/*/expose/apps': reserved(
		'`expose.apps` is reserved until core version 2.',
		'Remove `apps` from `expose`.'
	),
	'/commands/*/mutation': reserved(
		'`mutation` is never declared: the host derives it from `effects`.',
		'Remove `mutation`, and declare `effects`.'
	),
	'/grants/*/allow': reserved(
		"`grants[].allow` is the deployer's, and never enters a manifest.",
		'Remove `allow` from the grant.'
	),
	'/grants/*/targets': reserved(
		'`grants[].targets` is reserved for what a plugin asks a grant to reach.',
		'Remove `targets` from the grant.'
	),
	'/mount/url': deployer('mount.url'),
	'/mount/bearer_env': deployer('mount.bearer_env'),
	'/mount/command': deployer('mount.command'),
	'/mount/cwd': deployer('mount.cwd'),
	'/mount/env': deployer('mount.env'),
	'/mount/bearer': deployer('mount.bearer'),
	'/mount/tools/*/bind_space': umbel('mount.tools[].bind_space'),
	'/component': umbel('component'),
	'/packs': umbel('packs'),
	'/commands/*/confirm': umbel('commands[].confirm'),
	'/agent': later('agent', 5),
	'/ui/documents/*/panel': {
		code: 'MANIFEST_SURFACE_UNAVAILABLE',
		message: '`ui.documents[].panel` is not served: no document type needs a panel yet.',
		suggestion: 'Remove `panel`. A later version adds it when a type asks.',
	},
	'/ui/account': later('ui.account', 3),
	'/ui/settings': later('ui.settings', 4),
	'/ui/experiments': later('ui.experiments', 4),
	'/ui/menus': later('ui.menus', 4),
	'/ui/automations': later('ui.automations', 7),
	'/commands/*/confirm_prompt': {
		code: 'MANIFEST_CONFIRM_UNAVAILABLE',
		message: '`confirm_prompt` needs the prompt overlay, which arrives in phase 4.',
		suggestion: 'Remove `confirm_prompt` until phase 4.',
	},
	'/commands/*/output_budget': {
		code: 'MANIFEST_BUDGET_UNAVAILABLE',
		message: 'TypeScript does not implement output budgets yet.',
		suggestion: 'Remove `output_budget`.',
	},
	'/commands/*/first_class': refused(
		'commands[].first_class',
		"it is a suggestion to a hybrid host, and Loam's registry has no such thing"
	),
	'/pipelines': refused(
		'pipelines',
		'phase 1 has no use for one before the agent surface in phase 5'
	),
	'/mount/tools/*/confirm_prompt': refused(
		'mount.tools[].confirm_prompt',
		'the shell has no gate to back it in phase 1'
	),
	'/mount/tools/*/approval': refused(
		'mount.tools[].approval',
		'the shell has no gate to back it in phase 1'
	),
	'/mount/tools/*/first_class': refused(
		'mount.tools[].first_class',
		'the shell has no first-class list'
	),
	'/native': wrongKind('native', '`kind = "native"`'),
	'/view': wrongKind('view', '`kind = "view"`'),
	'/ui/resources': wrongKind('ui.resources', '`kind = "view"`'),
};

function surfaceRow(name: string, table: Readonly<Record<string, readonly string[]>>): Row {
	const known = SURFACE_CATALOG_V1.find((surface) => surface.id === name);
	if (known) {
		return {
			code: 'MANIFEST_SURFACE_UNAVAILABLE',
			message: `The surface \`${name}\` is not declared under \`ui.surfaces\`: phase ${known.servedFrom} serves it.`,
			suggestion: `Declare it at \`${known.place}\` from phase ${known.servedFrom}.`,
		};
	}
	return {
		code: 'MANIFEST_UNKNOWN_SURFACE',
		message: `\`ui.surfaces.${name}\` is not a surface.`,
		suggestion: suggestKey(name, admittedAt(table, '/ui/surfaces'), 'surfaces'),
	};
}

function keyRow(pointer: string, table: Readonly<Record<string, readonly string[]>>): Row {
	const shape = shapeOf(pointer);
	const row = KEY_ROWS[shape];
	if (row) return row;
	const parts = pointer.split('/');
	const name = (parts.at(-1) as string).replaceAll('~1', '/').replaceAll('~0', '~');
	if (parts.slice(0, -1).join('/') === '/ui/surfaces') return surfaceRow(name, table);
	return {
		code: 'MANIFEST_UNKNOWN_KEY',
		message: `\`${keyOf(pointer)}\` is not a key here.`,
		suggestion: suggestKey(name, admittedAt(table, parts.slice(0, -1).join('/'))),
	};
}

function compositionRow(key: string, name: unknown): Row {
	const known = COMPOSITIONS_V1.find((composition) => composition.name === name);
	const served = COMPOSITIONS_V1.filter((composition) => composition.servedFrom === 1)
		.map((composition) => `\`${composition.name}\``)
		.join(', ');
	if (known) {
		return {
			code: 'MANIFEST_COMPOSITION_UNAVAILABLE',
			message: `The composition \`${String(name)}\` is not served yet.`,
			suggestion: `A later phase adds it when a first app needs it. Served now: ${served}.`,
		};
	}
	return {
		code: 'MANIFEST_COMPOSITION_UNKNOWN',
		message: `\`${key}\` names no composition.`,
		suggestion: `Compositions: ${COMPOSITIONS_V1.map((composition) => `\`${composition.name}\``).join(', ')}.`,
	};
}

/** Every other error, the table of 2.5, matched on the pointer. */
function refusalFor(pointer: string, error: ValidatorError, document: unknown): Row {
	const shape = shapeOf(pointer);
	const key = keyOf(pointer);
	const said = `\`${key}\` ${error.message ?? `fails \`${error.keyword}\``}.`;
	switch (shape) {
		case '/plugin/kind':
			return {
				code: 'MANIFEST_KIND_UNKNOWN',
				message: `\`plugin.kind\` must be one Loam loads: ${said}`,
				suggestion:
					"Use `native`, `view` or `mounted`. Umbel's kinds belong to a manifest written for Umbel's profile.",
			};
		case '/plugin/domains':
		case '/plugin/domains/*':
			return {
				code: 'MANIFEST_DOMAIN_INVALID',
				message: said,
				suggestion: 'Set `plugin.domains` to exactly `[plugin.id]`.',
			};
		case '/plugin/id':
			if (
				error.keyword === 'not' ||
				SHELL_DOMAINS_V1.includes(String(valueAt(document, pointer)))
			) {
				return {
					code: 'MANIFEST_ID_RESERVED',
					message: `\`plugin.id\` \`${String(valueAt(document, pointer))}\` is the shell's.`,
					suggestion: 'Choose another id: the shell holds that domain.',
				};
			}
			break;
		case '/manifest_version':
			return {
				code: 'MANIFEST_VERSION_UNSUPPORTED',
				message: said,
				suggestion: 'This shell reads `manifest_version = 1` or `manifest_version = 2`.',
			};
		case '/commands/*/effects/*':
		case '/mount/tools/*/effects/*':
			return {
				code: 'MANIFEST_EFFECT_REFUSED',
				message:
					valueAt(document, pointer) === 'workspace-write'
						? `\`${key}\` is refused: \`workspace-write\` needs a file system, which an app does not have.`
						: `\`${key}\` is not an effect Loam admits.`,
				suggestion: 'Declare `plugin-state`, `store-write` or `external` instead.',
			};
		case '/commands/*/approval':
			return {
				code: 'MANIFEST_APPROVAL_UNAVAILABLE',
				message: '`approval = "required"` needs an approval middleware, which arrives in phase 5.',
				suggestion: 'Set `approval = "none"` or remove the key, until phase 5.',
			};
		case '/native':
			if (error.keyword === 'required') {
				return {
					code: 'MANIFEST_SECTION_KIND',
					message: '`kind = "native"` needs a `native` section.',
					suggestion: 'Add `[native]` with `entry`.',
				};
			}
			break;
		case '/ui/compositions/*':
			return compositionRow(key, valueAt(document, pointer));
	}
	return {
		code: 'MANIFEST_INVALID',
		message: said,
		suggestion: `Correct \`${key}\`, as ${error.message ?? 'the schema says'}.`,
	};
}

/** A manifest validator's errors as refusals, each key once. */
export function refusalsFrom(
	errors: readonly ValidatorError[],
	document: unknown
): ManifestRefusal[] {
	const table = ADMITTED_KEYS.manifest as Readonly<Record<string, readonly string[]>>;
	const refusals: ManifestRefusal[] = [];
	for (const [pointer, error] of reportedErrors(errors)) {
		const row = refusesKey(error) ? keyRow(pointer, table) : refusalFor(pointer, error, document);
		refusals.push({ ...row, key: keyOf(pointer) });
	}
	return refusals;
}
