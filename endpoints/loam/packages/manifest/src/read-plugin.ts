/**
 * @fileoverview A plugin bundle's manifest (Loam phase 5's no-terminal amendment, 4.2 and 4.4; D166): `loam-plugin.toml`
 * as JSON, or the `plugin-manifest.json` that `loam plugin pack` writes. The schema, then the rules between its keys
 * and, given each bundled `app-manifest.json`, the rules between the plugin and its apps. `loam plugin check` runs it,
 * and `loam-desktop`'s inspect (step 9c) holds the same rules over staged bytes. What needs the bundle's files (sizes,
 * links, collisions, hashes) is the caller's: `@lushly-dev/loam-cli`'s bundle reader.
 */

import { hidesCharacters } from '@lushly-dev/afd-core';
import type { PluginManifestV1 } from './_generated/types.js';
import { approvalsRefusals } from './approvals-rules.js';
import { SHELL_DOMAINS_V1 } from './catalogs.js';
import { keyOf, suggestKey } from './pointers.js';
import { readManifest } from './read-manifest.js';
import { saysShellName } from './shell-name.js';
import type { ManifestV2, Refusal } from './types.js';
import { validatePluginManifest } from './validate-plugin.generated.js';
import { pointerOf, reportedErrors, type ValidatorError } from './validator-errors.js';

export type { PluginManifestV1 };

/** A code `readPluginManifest` refuses with (the amendment's section 11, and phase 5's 7.2 for previews). */
export type PluginManifestRefusalCode =
	| 'PLUGIN_MANIFEST_INVALID'
	| 'PLUGIN_PATH_ESCAPE'
	| 'DEPLOYMENT_PREVIEW_REQUIRED'
	| 'DEPLOYMENT_PREVIEW_INVALID';

export type PluginManifestRefusal = Refusal<PluginManifestRefusalCode>;

export type PluginManifestRead =
	| {
			ok: true;
			manifest: PluginManifestV1;
			/** Each bundled app's manifest by `apps[].id`, read by `readManifest`; empty when no apps were given. */
			apps: Record<string, ManifestV2>;
	  }
	| { ok: false; refusals: PluginManifestRefusal[] };

/** The engine targets version 1 names (4.2). */
export const PLUGIN_TARGETS_V1 = [
	'darwin-arm64',
	'darwin-x64',
	'windows-x64',
	'windows-arm64',
	'linux-x64',
	'linux-arm64',
] as const;

export type PluginTargetV1 = (typeof PLUGIN_TARGETS_V1)[number];

/** The bounds a bundle keeps (4.4, item 3), which the bundle's readers hold it to. */
export interface PluginBundleLimitsV1 {
	/** The sum of every file's uncompressed size, in bytes. */
	totalBytes: number;
	files: number;
	/** `plugin-manifest.json`'s size, in bytes. */
	manifestBytes: number;
}

export const PLUGIN_BUNDLE_LIMITS_V1: Readonly<PluginBundleLimitsV1> = Object.freeze({
	totalBytes: 256 * 1024 * 1024,
	files: 2000,
	manifestBytes: 1024 * 1024,
});

/** The packed manifest's name at a bundle's root, and the authoring manifest's at a source's (4.1). */
export const PLUGIN_MANIFEST_FILE = 'plugin-manifest.json';
export const PLUGIN_SOURCE_FILE = 'loam-plugin.toml';

/** The keys each table admits, for a suggestion when a key is unknown; a unit holds it to the schema. */
export const PLUGIN_ADMITTED_KEYS_V1: Readonly<Record<string, readonly string[]>> = {
	'': ['plugin_manifest_version', 'plugin', 'apps', 'engine'],
	'/plugin': ['id', 'title', 'version', 'description', 'license', 'homepage'],
	'/apps/*': ['id', 'path'],
	'/engine': ['id', 'kind', 'mount_app', 'service_mode', 'artifacts', 'auth', 'mount'],
	'/engine/artifacts': PLUGIN_TARGETS_V1,
	'/engine/artifacts/*': ['path', 'sha256'],
	'/engine/auth': ['mode'],
	'/engine/mount': ['audience', 'labels', 'approvals', 'expose', 'commands'],
	'/engine/mount/expose': ['agent', 'palette'],
	'/engine/mount/commands/*': ['expose', 'effects', 'destructive', 'preview'],
	'/engine/mount/commands/*/expose': ['agent', 'palette', 'apps'],
	'/engine/mount/commands/*/preview': ['command', 'input'],
};

/**
 * Keys a manifest never holds (4.4, item 1): Loam starts an engine with a fixed argv, chooses its port and pairs its
 * token itself, so nothing here names a command line, a location or a credential.
 */
const FORBIDDEN_KEYS = new Set([
	'command',
	'args',
	'env',
	'cwd',
	'url',
	'endpoint',
	'port',
	'bearer',
	'bearer_file',
	'bearer_env',
	'token',
	'install_dir',
]);

/** The ids the shell keeps for itself, and AFD's (4.4, item 2). */
const RESERVED_IDS = new Set(['shell', 'loam', 'p', 'afd']);

/** Windows' reserved device names, refused as a path segment's stem in any case (4.4, item 3). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const CONTROL = /\p{Cc}/u;
const WINDOWS_ARTIFACT = /^[a-z][a-z0-9._-]{0,63}\.exe$/;
const POSIX_ARTIFACT = /^[a-z][a-z0-9._-]{0,63}$/;
const POSIX_SCRIPT = /\.(bat|cmd|sh)$/;

const pointerPart = (part: string): string => part.replaceAll('~', '~0').replaceAll('/', '~1');

/** Text that would hide what a person reads on the consent screen: a control or a hidden character (4.4, item 2). */
export function hidesFromPerson(text: string): boolean {
	return CONTROL.test(text) || hidesCharacters(text);
}

/**
 * Why a relative path in a bundle is refused, or `undefined` (4.4, item 3): `/` separators and normal segments only,
 * so it names the same file on every system and never one outside the bundle.
 */
export function bundlePathProblem(path: string): string | undefined {
	if (path === '') return 'it is empty';
	if (path.startsWith('/')) return 'it starts with `/`';
	if (/[\\:\0]/.test(path)) return 'it holds `\\`, `:` or NUL';
	if (CONTROL.test(path) || hidesCharacters(path)) return 'it holds a control or hidden character';
	for (const segment of path.split('/')) {
		if (segment === '') return 'it has an empty segment';
		if (segment === '.' || segment === '..') return 'it has a `.` or `..` segment';
		if (WINDOWS_RESERVED.test(segment.split('.')[0] as string))
			return `its segment \`${segment}\` is a name Windows reserves`;
	}
	return undefined;
}

/** `a` is `b` or below it, compared without case, as macOS's and Windows' volumes compare by default. */
const within = (a: string, b: string): boolean => {
	const [x, y] = [a.toLowerCase(), b.toLowerCase()];
	return x === y || x.startsWith(`${y}/`);
};

function schemaRefusal(error: ValidatorError): PluginManifestRefusal {
	const pointer = pointerOf(error);
	const key = keyOf(pointer);
	const name = pointer.split('/').at(-1) ?? '';
	if (error.keyword === 'additionalProperties') {
		if (FORBIDDEN_KEYS.has(name)) {
			return {
				code: 'PLUGIN_MANIFEST_INVALID',
				key,
				message: `\`${key}\` names a command line, a location or a credential, which a plugin manifest never holds: Loam starts an engine as \`<artifact> serve --port <port>\`, chooses its loopback port and pairs its token itself.`,
				suggestion: `Remove \`${name}\`; declare the engine's artifacts by target and SHA-256, and its \`auth.mode\`.`,
			};
		}
		const table = error.instancePath
			.replace(/^\/apps\/\d+/, '/apps/*')
			.replace(/^\/engine\/artifacts\/[^/]+$/, '/engine/artifacts/*')
			.replace(/^\/engine\/mount\/commands\/[^/]+/, '/engine/mount/commands/*');
		return {
			code: 'PLUGIN_MANIFEST_INVALID',
			key,
			message: `\`${key}\` is not a key of \`loam-plugin.toml\`.`,
			suggestion: suggestKey(name, PLUGIN_ADMITTED_KEYS_V1[table] ?? []),
		};
	}
	if (error.keyword === 'required') {
		return {
			code: 'PLUGIN_MANIFEST_INVALID',
			key,
			message: `\`${key}\` is required.`,
			suggestion: `Add \`${key}\`.`,
		};
	}
	if (error.keyword === 'not' && /^\/(plugin|apps\/\d+)\/id$/.test(pointer)) {
		return {
			code: 'PLUGIN_MANIFEST_INVALID',
			key,
			message: `\`${key}\` is reserved: \`shell\`, \`loam\` and \`p\` are the shell's own, and \`afd\` is AFD's.`,
			suggestion: 'Name it after the plugin, such as `mail`.',
		};
	}
	if (pointer === '/plugin_manifest_version') {
		return {
			code: 'PLUGIN_MANIFEST_INVALID',
			key,
			message: '`plugin_manifest_version` must be 1.',
			suggestion: 'Set `plugin_manifest_version = 1`; Loam reads version 1 only.',
		};
	}
	return {
		code: 'PLUGIN_MANIFEST_INVALID',
		key,
		message: `\`${key}\` ${error.message ?? 'is not valid'}.`,
		suggestion:
			"Fix the value; a plugin's manifest is documented in phase 5's no-terminal amendment, 4.2.",
	};
}

interface Findings {
	refusals: PluginManifestRefusal[];
	refuse(
		code: PluginManifestRefusalCode,
		pointer: string,
		message: string,
		suggestion: string
	): void;
}

function findings(): Findings {
	const refusals: PluginManifestRefusal[] = [];
	return {
		refusals,
		refuse(code, pointer, message, suggestion) {
			refusals.push({ code, key: keyOf(pointer), message, suggestion });
		},
	};
}

/** What reaches the consent screen as text: no control or hidden character, and no title saying "Loam" (item 2). */
function textRules(manifest: PluginManifestV1, found: Findings): void {
	const shown: Array<[string, string | undefined]> = [
		['/plugin/id', manifest.plugin.id],
		['/plugin/title', manifest.plugin.title],
		['/plugin/description', manifest.plugin.description],
		['/plugin/license', manifest.plugin.license],
		['/plugin/homepage', manifest.plugin.homepage],
		['/engine/id', manifest.engine?.id],
	];
	manifest.apps.forEach((app, index) => {
		shown.push([`/apps/${index}/id`, app.id]);
	});
	for (const [name, command] of Object.entries(manifest.engine?.mount.commands ?? {})) {
		const at = `/engine/mount/commands/${pointerPart(name)}`;
		shown.push([at, name]);
		if (command.preview) {
			shown.push([`${at}/preview/command`, command.preview.command]);
			command.preview.input.forEach((input, index) => {
				shown.push([`${at}/preview/input/${index}`, input]);
			});
		}
	}
	for (const [pointer, text] of shown) {
		if (text !== undefined && hidesFromPerson(text)) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				pointer,
				'It holds a control or hidden character, and the consent screen shows it to a person, who must read what they install.',
				'Remove the character: bidirectional overrides, zero-width and line separators are refused too.'
			);
		}
	}
	if (saysShellName(manifest.plugin.title)) {
		found.refuse(
			'PLUGIN_MANIFEST_INVALID',
			'/plugin/title',
			`The title \`${manifest.plugin.title}\` says "Loam", which is the shell's name, so it could pass for Loam's own on the consent screen.`,
			"Title the plugin after what it does, without the shell's name."
		);
	}
}

/** Item 2's reserved app ids beyond the schema's: a shell domain would read as one of the shell's own commands. */
function reservedRules(manifest: PluginManifestV1, found: Findings): void {
	const seen = new Set<string>();
	manifest.apps.forEach((app, index) => {
		if (SHELL_DOMAINS_V1.includes(app.id) && !RESERVED_IDS.has(app.id)) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				`/apps/${index}/id`,
				`The app id \`${app.id}\` is one of the shell's own domains.`,
				'Name the app after the plugin, such as `mail`.'
			);
		}
		if (seen.has(app.id)) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				`/apps/${index}/id`,
				`Two apps are installed as \`${app.id}\`.`,
				'Give each bundled app its own id.'
			);
		}
		seen.add(app.id);
	});
}

/** Item 3's rules a manifest can show: each path's shape, apps apart from each other and from `engines/`. */
function pathRules(manifest: PluginManifestV1, found: Findings): void {
	const escapeRefusal = (pointer: string, problem: string): void => {
		found.refuse(
			'PLUGIN_PATH_ESCAPE',
			pointer,
			`The path is refused: ${problem}.`,
			'Name a path inside the plugin root with `/` separators and normal segments, such as `apps/mail`.'
		);
	};
	const appPaths: Array<[number, string]> = [];
	manifest.apps.forEach((app, index) => {
		const problem = bundlePathProblem(app.path);
		if (problem) escapeRefusal(`/apps/${index}/path`, problem);
		else appPaths.push([index, app.path]);
	});
	for (const [index, path] of appPaths) {
		if (within(path, 'engines') || within('engines', path)) {
			escapeRefusal(
				`/apps/${index}/path`,
				'an app package is never inside `engines/`, nor holds it'
			);
		} else if (appPaths.some(([other, otherPath]) => other !== index && within(path, otherPath))) {
			escapeRefusal(
				`/apps/${index}/path`,
				"it is another app's package, or inside one, compared without case"
			);
		}
	}
	for (const [target, artifact] of Object.entries(manifest.engine?.artifacts ?? {})) {
		const pointer = `/engine/artifacts/${target}/path`;
		const problem = bundlePathProblem(artifact.path);
		if (problem) {
			escapeRefusal(pointer, problem);
			continue;
		}
		const file = artifact.path.split('/').at(-1) as string;
		const windows = target.startsWith('windows-');
		if (!artifact.path.startsWith(`engines/${target}/`)) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				pointer,
				`The artifact for \`${target}\` is not under \`engines/${target}/\`, so it could be another target's.`,
				`Put it at \`engines/${target}/<name>\`.`
			);
		} else if (
			windows ? !WINDOWS_ARTIFACT.test(file) : !POSIX_ARTIFACT.test(file) || POSIX_SCRIPT.test(file)
		) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				pointer,
				windows
					? 'A Windows engine is a native `.exe`: a `.bat`, `.cmd`, `.com`, `.ps1` or `.vbs` would run through a shell, and Loam never starts one.'
					: 'An engine is a native executable named in lowercase letters, digits, `.`, `_` and `-`, never a `.bat`, `.cmd` or `.sh` script.',
				windows
					? 'Name the engine `<name>.exe`, such as `loam-mail.exe`, in lowercase.'
					: 'Name the engine in lowercase with no script suffix, such as `loam-mail`.'
			);
		}
	}
}

/** Item 5's rules a manifest can show: the mounted app named, approvals that come with an approver, the previews. */
function engineRules(manifest: PluginManifestV1, found: Findings): void {
	const engine = manifest.engine;
	if (!engine) return;
	if (!manifest.apps.some((app) => app.id === engine.mount_app)) {
		found.refuse(
			'PLUGIN_MANIFEST_INVALID',
			'/engine/mount_app',
			`\`engine.mount_app\` names \`${engine.mount_app}\`, which is not one of the plugin's apps.`,
			"Name the `[[apps]]` entry whose manifest is the engine's mounted app."
		);
	}
	const approvals = engine.mount.approvals ?? 'none';
	const approver = engine.auth.mode === 'approver';
	if ((approvals === 'shell') !== approver) {
		found.refuse(
			'PLUGIN_MANIFEST_INVALID',
			approver ? '/engine/mount/approvals' : '/engine/auth/mode',
			approver
				? '`auth.mode = "approver"` pairs a token that approves on the person\'s behalf, which only the shell\'s approvals, with a preview for each command and the consent notice, may use.'
				: '`approvals = "shell"` releases commands with an approver token, and only `auth.mode = "approver"` pairs one.',
			approver
				? 'Set `engine.mount.approvals = "shell"` and give each command the engine holds a preview, or use `auth.mode = "agent"`.'
				: 'Set `engine.auth.mode = "approver"`, or `engine.mount.approvals = "none"`.'
		);
	}
	approvalsRefusals(
		{ approvals, commands: engine.mount.commands },
		(code, pointer, message, suggestion) => {
			found.refuse(code, `/engine/mount${pointer}`, message, suggestion);
		}
	);
}

/** Items 4 and 5 against each bundled app's manifest. */
function appRules(
	manifest: PluginManifestV1,
	given: Readonly<Record<string, unknown>>,
	found: Findings
): Record<string, ManifestV2> {
	const apps: Record<string, ManifestV2> = {};
	manifest.apps.forEach((app, index) => {
		const at = `/apps/${index}`;
		const json = given[app.id];
		if (json === undefined) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				`${at}/path`,
				`\`${app.path}\` holds no \`app-manifest.json\`.`,
				'Point `path` at a package `loam app pack` wrote.'
			);
			return;
		}
		const read = readManifest(json);
		if (!read.ok) {
			for (const refusal of read.refusals) {
				found.refuse(
					'PLUGIN_MANIFEST_INVALID',
					`${at}/path`,
					`Its \`app-manifest.json\` is refused (${refusal.code} at \`${refusal.key}\`): ${refusal.message}`,
					refusal.suggestion
				);
			}
			return;
		}
		const { plugin } = read.manifest;
		apps[app.id] = read.manifest;
		if (plugin.kind !== 'mounted' && plugin.id !== app.id) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				`${at}/id`,
				`A ${plugin.kind} app is installed under its own id, and this package's is \`${plugin.id}\`.`,
				`Set \`id = "${plugin.id}"\`.`
			);
		}
		if (plugin.kind === 'mounted' && manifest.engine?.mount_app !== app.id) {
			found.refuse(
				'PLUGIN_MANIFEST_INVALID',
				`${at}/id`,
				"A mounted app is reached only through the plugin's engine, and this one is not `engine.mount_app`.",
				manifest.engine
					? `Set \`engine.mount_app = "${app.id}"\`, or bundle the mounted app in a plugin of its own.`
					: 'Add the `[engine]` that serves it, or bundle only native and view apps.'
			);
		}
	});
	const engine = manifest.engine;
	const mounted = engine ? apps[engine.mount_app] : undefined;
	if (!engine || !mounted) return apps;
	const index = manifest.apps.findIndex((app) => app.id === engine.mount_app);
	const { mount, plugin } = mounted;
	if (plugin.kind !== 'mounted' || !mount) {
		found.refuse(
			'PLUGIN_MANIFEST_INVALID',
			'/engine/mount_app',
			`\`${engine.mount_app}\`'s package is a ${plugin.kind} app, and an engine is mounted.`,
			'Name the app whose manifest says `kind = "mounted"`.'
		);
		return apps;
	}
	if (mount.transport !== 'http' || !plugin.domains.includes(mount.prefix)) {
		found.refuse(
			'PLUGIN_MANIFEST_INVALID',
			`/apps/${index}/path`,
			"An `http-service` engine's app is mounted over `http`, under a prefix its manifest lists in `plugin.domains`.",
			'Set `mount.transport = "http"` and list `mount.prefix` in `plugin.domains`, then pack the app again.'
		);
	}
	for (const [name, command] of Object.entries(engine.mount.commands ?? {})) {
		const at = `/engine/mount/commands/${pointerPart(name)}`;
		const names: Array<[string, string]> = [[at, name]];
		if (command.preview) names.push([`${at}/preview/command`, command.preview.command]);
		for (const [pointer, value] of names) {
			if (!value.startsWith(`${mount.prefix}-`)) {
				found.refuse(
					'PLUGIN_MANIFEST_INVALID',
					pointer,
					`\`${value}\` is not one of the mounted app's commands: each starts with its prefix, \`${mount.prefix}-\`.`,
					`Name a command of \`${engine.mount_app}\`, such as \`${mount.prefix}-…\`.`
				);
			}
		}
	}
	return apps;
}

/**
 * Reads a plugin's manifest (4.4). Given `apps`, each bundled `app-manifest.json` as parsed JSON by `apps[].id` (an
 * absent one is refused), it also checks the plugin against them; a bundle's reader passes them, after a first read
 * without them has made its paths safe to open.
 */
export function readPluginManifest(
	json: unknown,
	apps?: Readonly<Record<string, unknown>>
): PluginManifestRead {
	if (!validatePluginManifest(json)) {
		const errors = [...reportedErrors(validatePluginManifest.errors ?? []).values()];
		return { ok: false, refusals: errors.map(schemaRefusal) };
	}
	const manifest = json as PluginManifestV1;
	const found = findings();
	textRules(manifest, found);
	reservedRules(manifest, found);
	pathRules(manifest, found);
	engineRules(manifest, found);
	if (found.refusals.length > 0 || apps === undefined)
		return found.refusals.length > 0
			? { ok: false, refusals: found.refusals }
			: { ok: true, manifest, apps: {} };
	const read = appRules(manifest, apps, found);
	return found.refusals.length > 0
		? { ok: false, refusals: found.refusals }
		: { ok: true, manifest, apps: read };
}
