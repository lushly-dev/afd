/**
 * @fileoverview Reading a deployment file with its packages (phase 1 specification, 3.1): what stops a
 * write, what the kernel will refuse at load, and the notices. Nothing of a location, a credential or a
 * command line reaches a message.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
	type DeploymentV1,
	type DeploymentV2,
	type DeploymentV3,
	type DeploymentV4,
	type DeploymentWorkspaceV2,
	type HostKindV1,
	type IdentityV1,
	type ManifestV3,
	NOTICES_V1,
	SHELL_DOMAINS_V1,
} from '@lushly-dev/loam-manifest';
import {
	fromJsonSchema,
	keyOf,
	readDeployment,
	readManifest,
} from '@lushly-dev/loam-manifest/validate';
import { parseManifestToml } from './check.js';
import { isWithin, realish } from './tree.js';

export interface DeploymentFinding {
	code: string;
	key: string;
	message: string;
	suggestion: string;
}

export interface DeploymentNotice {
	code: string;
	/** Absent for a notice of the whole deployment, such as `LOCAL_IDENTITY`. */
	instance?: string;
	message: string;
}

/** How the relay or a host reaches an instance. Never written into what is served. */
export interface MountAccess {
	instance: string;
	url: string;
	bearer?: string;
}

/**
 * How the desktop's Rust host starts a `stdio` instance (phase 6 specification, 10.4): written only into a
 * desktop deployment's `mounts.json`, beside phase 1's entries. `command[0]` and `cwd`, when relative paths,
 * are resolved against the deployment file's directory.
 */
export interface StdioMountAccess {
	instance: string;
	transport: 'stdio';
	command: string[];
	cwd?: string;
}

/**
 * How the desktop's Rust host reaches a copilot provider (phase 5 specification, 4.2): written only into a desktop
 * deployment's `models.json`, never into what is served. A key's place, never a key: a keychain entry, or a file
 * whose path is resolved against the deployment file's directory. A `test` provider has no entry: the page answers
 * it.
 */
export interface ModelAccess {
	id: string;
	kind: 'anthropic' | 'openai' | 'openai-compatible';
	model: string;
	endpoint?: string;
	key?: { keychain: string; account: string } | { file: string };
}

/**
 * The desktop's origins on this platform (phase 6 specification, 10.2): Tauri serves a custom protocol at
 * `<scheme>://localhost` on macOS and Linux and at `http://<scheme>.localhost` on Windows.
 */
export function desktopOrigins(platform: NodeJS.Platform = process.platform): {
	shell: string;
	sandbox: string;
} {
	return platform === 'win32'
		? { shell: 'http://loam.localhost', sandbox: 'http://loam-sandbox.localhost' }
		: { shell: 'loam://localhost', sandbox: 'loam-sandbox://localhost' };
}

interface PackageState {
	/** The kind the package says, read as data even when the manifest is refused. */
	rawKind?: unknown;
	manifest?: ManifestV3;
}

export interface InstanceEffect {
	id: string;
	entry: DeploymentV1['apps'][string];
	directory: string;
	/** A package to copy: its `app-manifest.json` could be read. */
	packaged: boolean;
	mounted: boolean;
	prefix?: string;
	transport?: 'http' | 'stdio';
	rawKind?: unknown;
	/** The manifest, when `readManifest` accepted it: what its boot record is read from. */
	manifest?: ManifestV3;
}

export interface DeploymentAnalysis {
	/** What makes the file unreadable: these stop a write. */
	refusals: DeploymentFinding[];
	/** What the kernel will refuse at load: `deployment check` fails on these, a write carries them. */
	instanceRefusals: DeploymentFinding[];
	/** Warnings of the packages, which fail nothing. */
	warnings: DeploymentFinding[];
	notices: DeploymentNotice[];
	deployment?: DeploymentV1 | DeploymentV2 | DeploymentV3 | DeploymentV4;
	/** Version 4's `[host] kind`, or `--host`'s, else `static` (phase 6 specification, 3.3). */
	host?: HostKindV1;
	/** The deployment's workspace, `personal` unless it names one (phase 2 specification, 4.2). */
	workspace?: DeploymentWorkspaceV2;
	/** The deployment's identity: `[identity]`, or `local` (phase 3 specification, 2.2). */
	identity?: IdentityV1;
	/** `site.base_path`, or `/`. */
	basePath?: string;
	instances: InstanceEffect[];
	mounts: MountAccess[];
	/** A desktop deployment's `stdio` instances (10.4); empty for every other kind. */
	stdioMounts: StdioMountAccess[];
	/** A desktop deployment's copilot providers but `test` (phase 5 specification, 4.2); empty for every other kind. */
	models: ModelAccess[];
}

/** What `deployment check` says of a `local` deployment (phase 3 specification, 2.1). */
export const LOCAL_IDENTITY_NOTICE =
	'`local` identity: anyone with this browser profile is its owner.';

export const appKey = (id: string, key = ''): string => keyOf(`/apps/${id}${key}`);

async function readPackage(directory: string): Promise<{ state: PackageState; found?: string }> {
	let text: string;
	try {
		text = await readFile(join(directory, 'app-manifest.json'), 'utf8');
	} catch {
		return { state: {}, found: 'it holds no `app-manifest.json`' };
	}
	try {
		const raw = JSON.parse(text) as { plugin?: { kind?: unknown } };
		return { state: { rawKind: raw?.plugin?.kind } };
	} catch {
		return { state: {}, found: 'its `app-manifest.json` is not JSON' };
	}
}

function configFindings(
	id: string,
	entry: InstanceEffect['entry'],
	manifest: ManifestV3
): DeploymentFinding[] {
	const schema = manifest.config?.schema;
	const refuse = (message: string): DeploymentFinding[] => [
		{
			code: 'APP_CONFIG_INVALID',
			key: appKey(id, '/config'),
			message,
			suggestion: "Match the manifest's `config.schema`.",
		},
	];
	if (schema === undefined) {
		return entry.config === undefined ? [] : refuse('This app declares no `config.schema`.');
	}
	const parsed = fromJsonSchema(schema).safeParse(entry.config ?? {});
	if (parsed.success) return [];
	// The paths and rules, never the values: a config may hold what a log should not.
	const issues = parsed.error.issues.map(
		(issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`
	);
	return refuse(`The config does not match its schema: ${issues.join(', ')}.`);
}

const MOUNTED_KEYS = [
	'prefix',
	'audience',
	'transport',
	'url',
	'bearer_file',
	'bearer_env',
	'command',
	'cwd',
	'projects',
	'space',
	'expose',
	'commands',
] as const;

/** Whether a package and an entry agree on what kind of instance this is. */
function kindFindings(
	id: string,
	entry: InstanceEffect['entry'],
	manifest: ManifestV3
): DeploymentFinding[] {
	const found: DeploymentFinding[] = [];
	if (manifest.plugin.id !== entry.app) {
		found.push({
			code: 'DEPLOYMENT_APP_MISMATCH',
			key: appKey(id, '/app'),
			message: `\`app\` says \`${entry.app}\`, and the package is \`${manifest.plugin.id}\`.`,
			suggestion: 'Name the app the package holds, or point `package` at the right one.',
		});
	}
	const { kind } = manifest.plugin;
	if (kind === 'mounted') {
		if (entry.audience === undefined) {
			found.push({
				code: 'DEPLOYMENT_AUDIENCE_REQUIRED',
				key: appKey(id, '/audience'),
				message: 'A mounted instance says who it serves.',
				suggestion: 'Set `audience` to `team` or `person`.',
			});
		}
		return found;
	}
	const stray = MOUNTED_KEYS.find((key) => entry[key] !== undefined);
	if (stray) {
		found.push({
			code: 'DEPLOYMENT_INSTANCE_MISMATCH',
			key: appKey(id, `/${stray}`),
			message: `\`${stray}\` is for a mounted instance, and this package is \`${kind}\`.`,
			suggestion: 'Remove the key, or point `package` at a mounted app.',
		});
	}
	return found;
}

/** What the manifest's default transport leaves to check (3.1). */
function transportFindings(
	id: string,
	entry: InstanceEffect['entry'],
	transport: 'http' | 'stdio'
): DeploymentFinding[] {
	const found: DeploymentFinding[] = [];
	const add = (
		key: string,
		message: string,
		suggestion: string,
		code = 'DEPLOYMENT_TRANSPORT_KEYS'
	) => found.push({ code, key: appKey(id, `/${key}`), message, suggestion });
	if (transport === 'http' && entry.url === undefined) {
		add('url', 'This instance is reached over `http` and has no `url`.', 'Add `url`.');
	}
	if (transport === 'http' && entry.command !== undefined) {
		add('command', '`command` is for `stdio`.', 'Keep the keys of one transport.');
	}
	if (transport === 'stdio' && entry.command === undefined) {
		add('command', 'This instance is reached over `stdio` and has no `command`.', 'Add `command`.');
	}
	if (transport === 'stdio' && entry.url !== undefined) {
		add('url', '`url` is for `http`.', 'Keep the keys of one transport.');
	}
	if (transport === 'stdio' && entry.audience === 'team') {
		add(
			'transport',
			'A team instance is reached over `http`.',
			'Set `transport = "http"` with a `url`, or `audience = "person"`.',
			'DEPLOYMENT_TEAM_NEEDS_HTTP'
		);
	}
	return found;
}

/**
 * A mounted instance and its projects (phase 2 specification, 9.1 and 4.2): warnings, which fail nothing.
 * `projects` makes an instance project-only whatever its manifest says, and a team instance with none
 * serves every member of the workspace.
 */
function projectWarnings(effect: InstanceEffect): DeploymentFinding[] {
	const { id, entry, manifest } = effect;
	if (!effect.mounted) return [];
	const found: DeploymentFinding[] = [];
	const levels = manifest?.app?.scope_levels ?? ['workspace'];
	if (entry.projects !== undefined && manifest && !levels.includes('project')) {
		found.push({
			code: 'INSTANCE_LEVELS_OVERRIDDEN',
			key: appKey(id, '/projects'),
			message:
				'The manifest serves the workspace alone, and `projects` makes this instance serve only those projects.',
			suggestion:
				'Remove `projects` to serve the workspace, or keep it to serve only those projects.',
		});
	}
	if (entry.projects === undefined && entry.audience === 'team') {
		found.push({
			code: 'TEAM_INSTANCE_WHOLE_WORKSPACE',
			key: appKey(id),
			message: 'This team instance serves every member of the workspace.',
			suggestion:
				'List the projects it serves under `projects`, if every member should not reach it.',
		});
	}
	// Phase 6 specification, 8.3: with no `projects`, the instance also serves calls at workspace level, where no pin
	// applies, so a pinned space would not keep its projects' calls to themselves.
	if (entry.projects === undefined && entry.space && Object.keys(entry.space).length > 0) {
		found.push({
			code: 'INSTANCE_SPACE_UNLISTED',
			key: appKey(id, '/space'),
			message:
				'This instance pins a space but lists no `projects`, so it also serves calls at workspace level, where no pin applies.',
			suggestion: 'List the projects it serves under `projects`, the pinned ones among them.',
		});
	}
	return found;
}

function noticesFor(effect: InstanceEffect): DeploymentNotice[] {
	if (!effect.mounted) return [];
	const instance = effect.id;
	const notices: DeploymentNotice[] = [
		{
			code: 'MOUNT_ANNOTATIONS_UNTRUSTED',
			instance,
			message: NOTICES_V1.MOUNT_ANNOTATIONS_UNTRUSTED,
		},
	];
	if (effect.entry.audience === 'team') {
		notices.push({
			code: 'TEAM_INSTANCE_SINGLE_PRINCIPAL',
			instance,
			message: NOTICES_V1.TEAM_INSTANCE_SINGLE_PRINCIPAL,
		});
	}
	if (effect.transport === 'stdio') {
		notices.push({ code: 'STDIO_TRUSTED_CODE', instance, message: NOTICES_V1.STDIO_TRUSTED_CODE });
	}
	return notices;
}

/** Deployment order decides: the later holder of a domain is the one refused (D66). */
function domainFindings(instances: readonly InstanceEffect[]): DeploymentFinding[] {
	const shell = new Set<string>(SHELL_DOMAINS_V1);
	const held = new Map<string, string>();
	const found: DeploymentFinding[] = [];
	const firstOfApp = new Set<string>();
	for (const effect of instances) {
		const { id, entry } = effect;
		if (!effect.mounted) {
			const holder = held.get(entry.app);
			if (holder) {
				found.push({
					code: 'APP_DOMAIN_CONFLICT',
					key: appKey(id),
					message: `The domain \`${entry.app}\` is already used by instance \`${holder}\`.`,
					suggestion: 'Rename the app, or set another prefix on that instance.',
				});
			} else held.set(entry.app, id);
			continue;
		}
		const named = entry.prefix !== undefined;
		if (!named && firstOfApp.has(entry.app)) {
			found.push({
				code: 'INSTANCE_PREFIX_REQUIRED',
				key: appKey(id, '/prefix'),
				message: `A further instance of \`${entry.app}\` must name its own prefix.`,
				suggestion: `Set \`prefix\` on \`${id}\`.`,
			});
			effect.prefix = undefined;
		}
		firstOfApp.add(entry.app);
		const { prefix } = effect;
		if (prefix === undefined) continue;
		const holder = held.get(prefix);
		if (holder || shell.has(prefix)) {
			found.push({
				code: 'INSTANCE_PREFIX_CONFLICT',
				key: appKey(id, '/prefix'),
				message: holder
					? `Command prefix \`${prefix}\` is already used by instance \`${holder}\`; choose another prefix for \`${id}\`.`
					: `Command prefix \`${prefix}\` is a shell domain; choose another prefix for \`${id}\`.`,
				suggestion: 'Choose another prefix.',
			});
		} else held.set(prefix, id);
	}
	return found;
}

/** Reads a credential. A message may name where it is looked for, and never what it holds. */
async function readCredential(
	id: string,
	entry: InstanceEffect['entry'],
	base: string
): Promise<{ bearer?: string; finding?: DeploymentFinding }> {
	const unreadable = (key: string, message: string): { finding: DeploymentFinding } => ({
		finding: {
			code: 'DEPLOYMENT_CREDENTIAL_UNREADABLE',
			key: appKey(id, `/${key}`),
			message,
			suggestion: 'Fix the credential reference: the token itself is never shown.',
		},
	});
	if (entry.bearer_file !== undefined) {
		try {
			const bearer = (await readFile(resolve(base, entry.bearer_file), 'utf8')).trim();
			return bearer ? { bearer } : unreadable('bearer_file', '`bearer_file` is empty.');
		} catch {
			return unreadable('bearer_file', '`bearer_file` cannot be read.');
		}
	}
	if (entry.bearer_env !== undefined) {
		const bearer = process.env[entry.bearer_env]?.trim();
		return bearer ? { bearer } : unreadable('bearer_env', `\`${entry.bearer_env}\` is not set.`);
	}
	return {};
}

/** The deployment file and each credential file: what must never be served or replaced. */
export async function secretPaths(
	config: string,
	deployment: DeploymentV1 | DeploymentV2 | DeploymentV3 | DeploymentV4
): Promise<string[]> {
	const base = dirname(resolve(config));
	const bearers = Object.values(deployment.apps).flatMap(({ bearer_file }) =>
		bearer_file === undefined ? [] : [resolve(base, bearer_file)]
	);
	// A copilot provider's key file (phase 5 specification, 4.1): a credential like a bearer's.
	const keys =
		deployment.deployment_version === 4
			? (deployment.copilot?.providers ?? []).flatMap(({ key }) =>
					key !== undefined && 'file' in key ? [resolve(base, key.file)] : []
				)
			: [];
	return Promise.all([config, ...bearers, ...keys].map(realish));
}

/** A package is served whole, so nothing secret may sit inside one. */
async function secretsServed(
	config: string,
	deployment: DeploymentV1 | DeploymentV2 | DeploymentV3 | DeploymentV4,
	instances: readonly InstanceEffect[]
): Promise<DeploymentFinding[]> {
	const secrets = await secretPaths(config, deployment);
	const found: DeploymentFinding[] = [];
	for (const { id, directory } of instances) {
		const root = await realish(directory);
		if (secrets.some((secret) => isWithin(secret, root))) {
			found.push({
				code: 'DEPLOYMENT_PATH_INVALID',
				key: appKey(id, '/package'),
				message: 'This package holds the deployment file or a credential, and it is served whole.',
				suggestion: 'Keep them outside every package; `loam app pack` writes a package of its own.',
			});
		}
	}
	return found;
}

export interface AnalyzeDeploymentOptions {
	/**
	 * Read the file as if its `[sandbox] origin` were this one: the hosted development profile binds its
	 * sandbox's port first and writes the site with that origin (phase 6 specification, 5.1). It passes the
	 * reader's checks as the file's own would.
	 */
	sandboxOrigin?: string;
	/**
	 * `deployment write --host` (phase 6 specification, 3.3): the kind, set when a version 4 file has no `[host]`,
	 * and `DEPLOYMENT_HOST_MISMATCH` when the file names another. A file before version 4 reads as `static`, so
	 * only `static` matches it.
	 */
	host?: HostKindV1;
	/**
	 * Read a desktop file with its sandbox on the desktop's own scheme for `platform` (default: this one),
	 * whatever its `[sandbox]` says (phase 6 specification, 10.2), as `deployment write` and `deployment check`
	 * do. The hosted server reads a file as written.
	 */
	desktop?: { platform?: NodeJS.Platform };
}

/** `--host` against the file's own kind (3.3): a finding, or the file with the kind set, or as it was. */
function withHost(parsed: unknown, host: HostKindV1 | undefined): DeploymentFinding | undefined {
	if (host === undefined || typeof parsed !== 'object' || parsed === null) return undefined;
	const file = parsed as { deployment_version?: unknown; host?: unknown };
	const version = file.deployment_version;
	// A version this reader does not read, or a `[host]` out of shape, is the reader's to refuse.
	if (version !== 1 && version !== 2 && version !== 3 && version !== 4) return undefined;
	if (file.host !== undefined && (typeof file.host !== 'object' || file.host === null))
		return undefined;
	const table = file.host as { kind?: unknown } | undefined;
	const declared = version === 4 ? table?.kind : 'static';
	if (declared === undefined) {
		file.host = { ...table, kind: host };
		return undefined;
	}
	if (declared === host) return undefined;
	return {
		code: 'DEPLOYMENT_HOST_MISMATCH',
		key: 'host.kind',
		message:
			file.deployment_version === 4
				? `The deployment file names \`[host] kind = "${String(declared)}"\`, and \`--host\` names \`${host}\`.`
				: `A file before version 4 is for a static host, and \`--host\` names \`${host}\`.`,
		suggestion:
			file.deployment_version === 4
				? 'Drop `--host`, or name the same kind in both.'
				: `Use \`deployment_version = 4\` with \`[host] kind = "${host}"\`, or drop \`--host\`.`,
	};
}

/** Reads the file and every package it lists, as `deployment check` and a write both must. */
export async function analyzeDeployment(
	config: string,
	options: AnalyzeDeploymentOptions = {}
): Promise<DeploymentAnalysis> {
	const empty = {
		instanceRefusals: [],
		warnings: [],
		notices: [],
		instances: [],
		mounts: [],
		stdioMounts: [],
		models: [],
	};
	const unreadable = (message: string, suggestion: string): DeploymentAnalysis => ({
		...empty,
		refusals: [{ code: 'DEPLOYMENT_INVALID', key: config, message, suggestion }],
	});
	let text: string;
	try {
		text = await readFile(config, 'utf8');
	} catch {
		return unreadable('The deployment file cannot be read.', 'Check the path.');
	}
	let parsed: unknown;
	try {
		parsed = parseManifestToml(text);
	} catch (cause) {
		// The parser's message quotes the source, and this file holds `url` and `command`.
		const { line, column } = cause as { line?: number; column?: number };
		return unreadable(
			`The deployment file is not valid TOML, at line ${line}, column ${column}.`,
			'Fix the TOML at that line.'
		);
	}
	if (options.sandboxOrigin !== undefined && typeof parsed === 'object' && parsed !== null)
		(parsed as Record<string, unknown>).sandbox = { origin: options.sandboxOrigin };
	const mismatch = withHost(parsed, options.host);
	if (mismatch) return { ...empty, refusals: [mismatch] };
	// The desktop's sandbox is its own scheme on this platform, whatever the file names (10.2).
	if (options.desktop && desktopFile(parsed))
		(parsed as Record<string, unknown>).sandbox = {
			origin: desktopOrigins(options.desktop.platform).sandbox,
		};
	const read = readDeployment(parsed);
	if (!read.ok) return { ...empty, refusals: read.refusals };
	const { deployment } = read;
	const base = dirname(resolve(config));

	const refusals: DeploymentFinding[] = [];
	const instanceRefusals: DeploymentFinding[] = [];
	// The reader's own warnings: `DEPLOYMENT_PROVIDER_NEEDS_HOST` (phase 6 specification, 3.3).
	const warnings: DeploymentFinding[] = [...read.warnings];
	const instances: InstanceEffect[] = [];
	const mounts: MountAccess[] = [];
	const stdioMounts: StdioMountAccess[] = [];
	const desktop = read.host === 'desktop';
	const fromBase = (path: string) => (isAbsolute(path) ? path : resolve(base, path));
	for (const [id, entry] of Object.entries(deployment.apps)) {
		const directory = resolve(base, entry.package);
		const { state, found } = await readPackage(directory);
		if (found) {
			instanceRefusals.push({
				code: 'APP_PACKAGE_UNAVAILABLE',
				key: appKey(id, '/package'),
				message: `The package cannot be read: ${found}.`,
				suggestion: 'Run `loam app pack`, and check `package`, which is relative to this file.',
			});
		} else {
			const packageRead = readManifest(
				JSON.parse(await readFile(join(directory, 'app-manifest.json'), 'utf8'))
			);
			warnings.push(
				...packageRead.warnings.map((warning) => ({
					...warning,
					key: `${appKey(id)}: ${warning.key}`,
				}))
			);
			if (packageRead.ok) state.manifest = packageRead.manifest;
			else {
				instanceRefusals.push(
					...packageRead.refusals.map((refusal) => ({
						...refusal,
						key: `${appKey(id)}: ${refusal.key}`,
					}))
				);
			}
		}
		const { manifest } = state;
		const hasMountedKey = MOUNTED_KEYS.some((key) => entry[key] !== undefined);
		const mounted = manifest ? manifest.plugin.kind === 'mounted' : hasMountedKey;
		const effect: InstanceEffect = {
			id,
			entry,
			directory,
			packaged: !found,
			mounted,
			rawKind: state.rawKind,
			...(manifest ? { manifest } : {}),
			...((entry.prefix ?? manifest?.mount?.prefix)
				? { prefix: entry.prefix ?? manifest?.mount?.prefix }
				: {}),
			...((entry.transport ?? manifest?.mount?.transport)
				? { transport: entry.transport ?? manifest?.mount?.transport }
				: {}),
		};
		instances.push(effect);
		if (manifest) {
			instanceRefusals.push(
				...kindFindings(id, entry, manifest),
				...configFindings(id, entry, manifest)
			);
			if (manifest.plugin.kind === 'view' && deployment.sandbox === undefined) {
				instanceRefusals.push({
					code: 'VIEW_SANDBOX_ORIGIN_INVALID',
					key: appKey(id),
					message: 'A view app needs a sandbox on a second origin.',
					suggestion: 'Deploy `dist/sandbox/` on a second origin and set `[sandbox] origin`.',
				});
			}
			if (mounted && effect.transport) {
				instanceRefusals.push(...transportFindings(id, entry, effect.transport));
			}
		}
		if (desktop && mounted && effect.transport === 'stdio' && entry.command !== undefined) {
			const [program, ...args] = entry.command as [string, ...string[]];
			stdioMounts.push({
				instance: id,
				transport: 'stdio',
				command: [/[\\/]/.test(program) ? fromBase(program) : program, ...args],
				...(entry.cwd !== undefined ? { cwd: fromBase(entry.cwd) } : {}),
			});
		}
		if (mounted && effect.transport !== 'stdio') {
			const credential = await readCredential(id, entry, base);
			if (credential.finding) refusals.push(credential.finding);
			if (entry.url !== undefined) {
				mounts.push({
					instance: id,
					url: entry.url,
					...(credential.bearer ? { bearer: credential.bearer } : {}),
				});
			}
		}
	}
	const models: ModelAccess[] = [];
	if (desktop && deployment.deployment_version === 4) {
		for (const { id, kind, model, endpoint, key } of deployment.copilot?.providers ?? []) {
			if (kind === 'test') continue;
			models.push({
				id,
				kind,
				model,
				// The reader allowed it; stored without a trailing `/`, so the host appends the kind's path once.
				...(endpoint !== undefined ? { endpoint: endpoint.replace(/\/+$/, '') } : {}),
				...(key === undefined
					? {}
					: 'file' in key
						? { key: { file: fromBase(key.file) } }
						: { key: { keychain: key.keychain, account: key.account } }),
			});
		}
	}
	instanceRefusals.push(...domainFindings(instances));
	warnings.push(...instances.flatMap(projectWarnings));
	refusals.push(...(await secretsServed(config, deployment, instances)));
	return {
		refusals,
		instanceRefusals,
		warnings,
		notices: [
			...(read.identity.mode === 'local'
				? [{ code: 'LOCAL_IDENTITY', message: LOCAL_IDENTITY_NOTICE }]
				: []),
			...instances.flatMap(noticesFor),
		],
		deployment,
		host: read.host,
		workspace: read.workspace,
		identity: read.identity,
		basePath: read.basePath,
		instances,
		mounts,
		stdioMounts,
		models,
	};
}

/** A file this reader will read as a desktop deployment, once `--host` is applied. */
function desktopFile(parsed: unknown): boolean {
	if (typeof parsed !== 'object' || parsed === null) return false;
	const file = parsed as { deployment_version?: unknown; host?: unknown };
	return (
		file.deployment_version === 4 &&
		typeof file.host === 'object' &&
		file.host !== null &&
		(file.host as { kind?: unknown }).kind === 'desktop'
	);
}
