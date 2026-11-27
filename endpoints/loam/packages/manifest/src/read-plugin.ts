/**
 * @fileoverview A plugin bundle's manifest, `loam-plugin.toml` read as JSON or the `plugin-manifest.json` a pack
 * writes (phase 5 no-terminal amendment, 4.2 and 4.4; D166). `readPluginManifest` holds what the file alone can show;
 * `pluginAppsRefusals` adds what needs the bundle's packed app manifests. What needs the file system (paths that
 * exist, regular files, hashes and bounds) is `loam plugin check`'s, and the desktop's Rust inspect holds the same
 * rules over staged bytes.
 */

import type { ManifestV2, PluginManifestV1 } from './_generated/types.js';
import { approvalsRefusals } from './approvals-rules.js';
import { SHELL_DOMAINS_V1 } from './catalogs.js';
import { keyOf, suggestKey } from './pointers.js';
import { saysShellName } from './shell-name.js';
import type { Refusal } from './types.js';
import { validatePluginManifest } from './validate-plugin.generated.js';
import { pointerOf, reportedErrors, type ValidatorError } from './validator-errors.js';

export type { PluginManifestV1 };

/** A code a plugin's manifest can be refused with (the amendment's section 11). */
export type PluginRefusalCode =
	| 'PLUGIN_MANIFEST_INVALID'
	| 'PLUGIN_PATH_ESCAPE'
	| 'DEPLOYMENT_PREVIEW_REQUIRED'
	| 'DEPLOYMENT_PREVIEW_INVALID';

export type PluginRefusal = Refusal<PluginRefusalCode>;

export type PluginManifestRead =
	| { ok: true; manifest: PluginManifestV1 }
	| { ok: false; refusals: PluginRefusal[] };

/** The platforms an engine ships for (4.2), each an `engines/<target>/` directory in the bundle. */
export const PLUGIN_TARGETS_V1 = [
	'darwin-arm64',
	'darwin-x64',
	'windows-x64',
	'windows-arm64',
	'linux-x64',
	'linux-arm64',
] as const;

export type PluginTargetV1 = (typeof PLUGIN_TARGETS_V1)[number];

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
 * Keys that would make a manifest say how to run or reach its engine, or carry a secret: none is admitted anywhere
 * (4.4, rule 1). Loam starts an engine as `<artifact> serve --port <port>` and chooses the port itself.
 */
export const PLUGIN_FORBIDDEN_KEYS_V1: readonly string[] = [
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
];

/**
 * Text that reaches the consent screen: no control character (`Cc`), no invisible format character (`Cf`: the
 * bidirectional overrides and isolates, zero-width characters and the byte-order mark among them), and no line or
 * paragraph separator (4.4, rule 2); nor a lone surrogate (`Cs`), which is no character at all and which a strict JSON reader,
 * such as Rust's, refuses.
 */
const HIDES_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u;

/**
 * Windows' reserved device names, refused as any segment's stem in every bundle so it unpacks on every system: with any
 * extension and with spaces before it (`con .txt`), the superscript digits Windows reads as ports, and the consoles.
 */
const WINDOWS_RESERVED =
	/^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]) *(\..*)?$/i;

/** Characters a Windows file name cannot hold (`:`, `\` and NUL are refused before these). */
const WINDOWS_FORBIDDEN = /[<>"|?*]/;

/** An engine's file name, by the platform family it runs on (4.4, rule 3): never a script. */
const ARTIFACT_NAME = {
	windows: /^[a-z][a-z0-9._-]{0,63}\.exe$/,
	unix: /^[a-z][a-z0-9._-]{0,63}$/,
} as const;

const SCRIPT_SUFFIX = /\.(bat|cmd|com|ps1|vbs|sh)$/i;

/** An id the shell or AFD holds: a shell domain, `afd`, `p` or `loam`, or `shell` (4.4, rule 2). */
export function isReservedPluginName(id: string): boolean {
	return (
		id === 'shell' || id === 'loam' || id === 'p' || id === 'afd' || SHELL_DOMAINS_V1.includes(id)
	);
}

function admittedFor(pointer: string): readonly string[] {
	const shape = pointer
		.replace(/^\/apps\/\d+/, '/apps/*')
		.replace(/^\/engine\/artifacts\/[^/]+/, '/engine/artifacts/*')
		.replace(/^\/engine\/mount\/commands\/[^/]+/, '/engine/mount/commands/*');
	return PLUGIN_ADMITTED_KEYS_V1[shape] ?? [];
}

function invalid(pointer: string, message: string, suggestion: string): PluginRefusal {
	return { code: 'PLUGIN_MANIFEST_INVALID', key: keyOf(pointer), message, suggestion };
}

function schemaRefusal(error: ValidatorError): PluginRefusal {
	const pointer = pointerOf(error);
	if (error.keyword === 'additionalProperties') {
		const name = pointer.split('/').at(-1) ?? '';
		if (PLUGIN_FORBIDDEN_KEYS_V1.includes(name)) {
			return invalid(
				pointer,
				`\`${keyOf(pointer)}\` is refused: a plugin's manifest names no command line, environment, location, port or token.`,
				'Remove it. Loam starts an engine as `<artifact> serve --port <port>`, chooses the loopback port at install, and pairs its token itself.'
			);
		}
		return invalid(
			pointer,
			`\`${keyOf(pointer)}\` is not a key of \`loam-plugin.toml\`.`,
			suggestKey(name, admittedFor(error.instancePath))
		);
	}
	if (error.keyword === 'required') {
		return invalid(pointer, `\`${keyOf(pointer)}\` is required.`, `Add \`${keyOf(pointer)}\`.`);
	}
	if (pointer === '/plugin_manifest_version') {
		return invalid(
			pointer,
			'`plugin_manifest_version` must be 1.',
			'Set `plugin_manifest_version = 1`; this reader reads version 1 only.'
		);
	}
	return invalid(
		pointer,
		`\`${keyOf(pointer)}\` ${error.message ?? 'is not valid'}.`,
		"Fix the value; a plugin's manifest is documented in the phase 5 no-terminal amendment, 4.2."
	);
}

/**
 * A bundle path as a case-insensitive volume compares it, so two that fold alike name one file there (4.4, rule 3):
 * Unicode NFC, then the full lower-case mapping, the full upper-case mapping and the full lower-case mapping again,
 * then NFC (ECMAScript's `String.prototype.toLowerCase` and `toUpperCase`, or Rust's `str::to_lowercase` and
 * `to_uppercase`: Unicode's default case mappings with SpecialCasing, no locale). The round trip folds what lower case
 * alone leaves apart, such as `ſ` and `s`, `ß` and `ss`, and a final `ς` and `σ`; the lower case first makes it stable
 * for `ẞ` (U+1E9E), whose upper case is itself and whose lower case is `ß`. Checked against Unicode 17.0 (Node.js 26's
 * ICU 78); a mapping a later Unicode changes may fold differently.
 */
export function foldBundlePath(path: string): string {
	return path.normalize('NFC').toLowerCase().toUpperCase().toLowerCase().normalize('NFC');
}

/** A path segment's longest name, in UTF-8 bytes: what APFS, ext4 and NTFS each hold at most (4.4, rule 3). */
export const BUNDLE_SEGMENT_MAX_BYTES = 255;

/**
 * A bundle path's longest, in UTF-8 bytes (4.4, rule 3): macOS's whole-path limit, so a bundle unpacks anywhere, and
 * the bound an archive's size allowance is reckoned from.
 */
export const BUNDLE_PATH_MAX_BYTES = 1024;

/** What is wrong with a bundle path (4.4, rule 3), or undefined. */
export function bundlePathProblem(path: string): string | undefined {
	if (new TextEncoder().encode(path).length > BUNDLE_PATH_MAX_BYTES)
		return `is longer than ${BUNDLE_PATH_MAX_BYTES} bytes of UTF-8`;
	if (path.includes('\\')) return 'uses `\\`; a bundle path uses `/` only';
	if (path.startsWith('/')) return 'is absolute';
	// A `:` is a drive or an alternate data stream on Windows; NUL ends a path in C.
	if (/[:\0]/.test(path)) return 'holds `:` or NUL';
	if (HIDES_TEXT.test(path)) return 'holds a control or invisible character';
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.' || segment === '..')
			return 'has an empty, `.` or `..` segment';
		if (WINDOWS_RESERVED.test(segment)) return `has \`${segment}\`, a name Windows reserves`;
		if (WINDOWS_FORBIDDEN.test(segment))
			return 'holds one of `<>"|?*`, which a Windows name cannot';
		// Windows drops a trailing dot or space, so `mail.` would land on `mail`.
		if (/[. ]$/.test(segment)) return 'has a segment ending in a dot or a space';
		if (new TextEncoder().encode(segment).length > BUNDLE_SEGMENT_MAX_BYTES)
			return `has a segment longer than ${BUNDLE_SEGMENT_MAX_BYTES} bytes of UTF-8`;
	}
	// macOS stores names decomposed and Linux as given: one spelling, NFC, so the digest's bytes are one.
	if (path !== path.normalize('NFC')) return 'is not in Unicode normalization form C';
	return undefined;
}

function pathRefusal(pointer: string, problem: string): PluginRefusal {
	return {
		code: 'PLUGIN_PATH_ESCAPE',
		key: keyOf(pointer),
		message: `The path ${problem}.`,
		suggestion:
			"Name a file or directory inside the plugin's root with `/` separators and normal segments, such as `apps/mail`.",
	};
}

/** An `https:` URL with a host and no credentials, as a URL parser reads it. */
function isDisplayUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
		);
	} catch {
		return false;
	}
}

function textRefusals(manifest: PluginManifestV1): PluginRefusal[] {
	const refusals: PluginRefusal[] = [];
	const { plugin } = manifest;
	for (const [key, value] of [
		['title', plugin.title],
		['description', plugin.description],
		['license', plugin.license],
		['homepage', plugin.homepage],
	] as const) {
		if (value !== undefined && HIDES_TEXT.test(value)) {
			refusals.push(
				invalid(
					`/plugin/${key}`,
					'It holds a control, invisible or line-separating character, and the consent screen shows it.',
					'Remove the character; write the text on one line.'
				)
			);
		}
	}
	if (plugin.homepage !== undefined && !isDisplayUrl(plugin.homepage)) {
		refusals.push(
			invalid(
				'/plugin/homepage',
				'`homepage` is not an `https:` address with a host, or it carries a user name or password.',
				"Give the plain address of the plugin's page, such as `https://example.com/plugins/mail`."
			)
		);
	}
	if (saysShellName(plugin.title)) {
		refusals.push(
			invalid(
				'/plugin/title',
				`The title \`${plugin.title}\` says "Loam", which is the shell's name.`,
				"Title the plugin after what it does, without the shell's name."
			)
		);
	}
	return refusals;
}

function nameRefusals(manifest: PluginManifestV1): PluginRefusal[] {
	const refusals: PluginRefusal[] = [];
	if (isReservedPluginName(manifest.plugin.id)) {
		refusals.push(
			invalid(
				'/plugin/id',
				`The id \`${manifest.plugin.id}\` is reserved: it names the shell's own or AFD's.`,
				'Name the plugin after what it does, such as `mail`.'
			)
		);
	}
	const seen = new Map<string, number>();
	const paths = new Map<string, number>();
	manifest.apps.forEach((app, index) => {
		if (isReservedPluginName(app.id)) {
			refusals.push(
				invalid(
					`/apps/${index}/id`,
					`The app id \`${app.id}\` is reserved: it names the shell's own or AFD's.`,
					'Name the app after what it does, such as `mailapp`.'
				)
			);
		}
		if (seen.has(app.id)) {
			refusals.push(
				invalid(
					`/apps/${index}/id`,
					`The app id \`${app.id}\` is also \`apps[${seen.get(app.id)}]\`'s; each is an instance's id.`,
					'Give each app its own id.'
				)
			);
		} else seen.set(app.id, index);
		const problem = bundlePathProblem(app.path);
		if (problem) refusals.push(pathRefusal(`/apps/${index}/path`, problem));
		else if (paths.has(foldBundlePath(app.path))) {
			refusals.push(
				invalid(
					`/apps/${index}/path`,
					`The path is also \`apps[${paths.get(foldBundlePath(app.path))}]\`'s, ignoring case.`,
					'Pack each app into a directory of its own, such as `apps/<id>`.'
				)
			);
		} else paths.set(foldBundlePath(app.path), index);
	});
	return refusals;
}

function artifactRefusals(engine: NonNullable<PluginManifestV1['engine']>): PluginRefusal[] {
	const refusals: PluginRefusal[] = [];
	for (const target of PLUGIN_TARGETS_V1) {
		const artifact = engine.artifacts[target];
		if (!artifact) continue;
		const pointer = `/engine/artifacts/${target}/path`;
		const problem = bundlePathProblem(artifact.path);
		if (problem) {
			refusals.push(pathRefusal(pointer, problem));
			continue;
		}
		const prefix = `engines/${target}/`;
		const name = artifact.path.slice(prefix.length);
		const family = target.startsWith('windows-') ? 'windows' : 'unix';
		if (!artifact.path.startsWith(prefix) || name.includes('/')) {
			refusals.push(
				invalid(
					pointer,
					`An engine for \`${target}\` sits directly in \`${prefix}\`.`,
					`Put the artifact at \`${prefix}<name>\`.`
				)
			);
		} else if (
			!ARTIFACT_NAME[family].test(name) ||
			(family === 'unix' && SCRIPT_SUFFIX.test(name))
		) {
			refusals.push(
				invalid(
					pointer,
					family === 'windows'
						? 'A Windows engine is a native `.exe`, named in lowercase: never a script Windows would hand to `cmd.exe`.'
						: 'An engine is a native program named in lowercase, with no script suffix.',
					family === 'windows'
						? 'Name it like `loam-mail.exe`.'
						: 'Name it like `loam-mail`, and build it as a native binary.'
				)
			);
		}
	}
	return refusals;
}

function engineRefusals(manifest: PluginManifestV1): PluginRefusal[] {
	const { engine } = manifest;
	if (!engine) return [];
	const refusals = artifactRefusals(engine);
	if (!manifest.apps.some((app) => app.id === engine.mount_app)) {
		refusals.push(
			invalid(
				'/engine/mount_app',
				`\`engine.mount_app\` names \`${engine.mount_app}\`, which is no app of this plugin.`,
				"Name the `[[apps]]` entry whose package is the engine's mounted app."
			)
		);
	}
	const mount = engine.mount ?? {};
	const approver = engine.auth.mode === 'approver';
	const shell = mount.approvals === 'shell';
	if (approver !== shell) {
		refusals.push(
			invalid(
				shell ? '/engine/mount/approvals' : '/engine/auth/mode',
				approver
					? 'An approver token carries a person\'s authority, so it is paired only for `approvals = "shell"`, which shows its consent notice and previews.'
					: '`approvals = "shell"` presents an approver token, and this engine pairs none.',
				'Set both `engine.auth.mode = "approver"` and `engine.mount.approvals = "shell"`, or neither.'
			)
		);
	}
	approvalsRefusals(mount, (code, pointer, message, suggestion) => {
		refusals.push({ code, key: keyOf(`/engine/mount${pointer}`), message, suggestion });
	});
	return refusals;
}

/**
 * Reads version 1 of a plugin's manifest, parsed as JSON. It refuses what the file alone says is wrong (4.4's
 * rules 1, 2 and 3, and rule 5's parts that need no app manifest).
 */
export function readPluginManifest(json: unknown): PluginManifestRead {
	if (!validatePluginManifest(json)) {
		return {
			ok: false,
			refusals: [...reportedErrors(validatePluginManifest.errors ?? []).values()].map(
				schemaRefusal
			),
		};
	}
	const manifest = json as PluginManifestV1;
	const refusals = [
		...textRefusals(manifest),
		...nameRefusals(manifest),
		...engineRefusals(manifest),
	];
	return refusals.length > 0 ? { ok: false, refusals } : { ok: true, manifest };
}

/** What `pluginAppsRefusals` reads of a packed app's manifest. */
type AppView = Pick<ManifestV2, 'plugin' | 'mount'>;

/**
 * The rules that need each app's packed manifest (4.4's rules 4 and 5): a native or view app's id is its manifest's
 * `plugin.id`; the one mounted app is the engine's, over `http`; and every command the mount names, and each preview,
 * is of its prefix. `apps` holds each `[[apps]]` entry's manifest by its id, already read by `readManifest`.
 */
export function pluginAppsRefusals(
	manifest: PluginManifestV1,
	apps: ReadonlyMap<string, AppView>
): PluginRefusal[] {
	const refusals: PluginRefusal[] = [];
	const mountApp = manifest.engine?.mount_app;
	manifest.apps.forEach((entry, index) => {
		const app = apps.get(entry.id);
		if (!app) return;
		const { kind, id } = app.plugin;
		if ((kind === 'native' || kind === 'view') && id !== entry.id) {
			refusals.push(
				invalid(
					`/apps/${index}/id`,
					`A ${kind} app's instance is its manifest's \`plugin.id\`, \`${id}\`, not \`${entry.id}\`.`,
					`Set \`id = "${id}"\`.`
				)
			);
		}
		if (kind === 'mounted' && entry.id !== mountApp) {
			refusals.push(
				invalid(
					`/apps/${index}/id`,
					'A mounted app in a plugin is reached only through its engine, and this one is not `engine.mount_app`.',
					manifest.engine
						? 'A plugin mounts one engine: name this app in `engine.mount_app`, or remove it.'
						: 'Add an `[engine]` whose `mount_app` is this app, or remove it.'
				)
			);
		}
	});
	// One domain per instance (D66): a native or view app's is its id, a mounted one's its prefix, and no two share one.
	const domains = new Map<string, number>();
	manifest.apps.forEach((entry, index) => {
		const app = apps.get(entry.id);
		if (!app) return;
		const domain = app.plugin.kind === 'mounted' ? app.mount?.prefix : app.plugin.id;
		if (domain === undefined) return;
		const holder = domains.get(domain);
		if (holder === undefined) {
			domains.set(domain, index);
			return;
		}
		refusals.push(
			invalid(
				`/apps/${index}/id`,
				`This app's commands would be in the domain \`${domain}\`, which \`apps[${holder}]\` holds already.`,
				"Give each app a domain of its own: a native or view app's is its id, a mounted app's its `mount.prefix`."
			)
		);
	});
	if (!manifest.engine || mountApp === undefined) return refusals;
	const app = apps.get(mountApp);
	if (!app) return refusals;
	if (app.plugin.kind !== 'mounted' || app.mount?.transport !== 'http') {
		refusals.push(
			invalid(
				'/engine/mount_app',
				`\`${mountApp}\`'s package is not a mounted app over \`http\`, which an \`http-service\` engine serves.`,
				'Name an app whose manifest says `kind = "mounted"` and `mount = { prefix = "…", transport = "http" }`.'
			)
		);
		return refusals;
	}
	const prefix = `${app.mount.prefix}-`;
	for (const [name, override] of Object.entries(manifest.engine.mount?.commands ?? {})) {
		const pointer = `/engine/mount/commands/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
		if (!name.startsWith(prefix)) {
			refusals.push(
				invalid(
					pointer,
					`\`${name}\` is not a command of the mount, whose names start \`${prefix}\`.`,
					`Name the mount's own command, such as \`${prefix}…\`.`
				)
			);
		}
		const preview = override?.preview?.command;
		if (preview !== undefined && !preview.startsWith(prefix)) {
			refusals.push({
				code: 'DEPLOYMENT_PREVIEW_INVALID',
				key: keyOf(`${pointer}/preview/command`),
				message: `A preview is a read of the same instance, and \`${preview}\` is not one of \`${prefix}…\`.`,
				suggestion: `Name a read of the mount, such as \`${prefix}…-show\`.`,
			});
		}
	}
	return refusals;
}
