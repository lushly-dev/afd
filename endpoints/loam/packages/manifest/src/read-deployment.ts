/**
 * @fileoverview The deployment file's reader (phase 1 specification, 3.1): what can be said from the
 * file alone. Whatever needs a package's manifest, such as an instance's kind, is `loam deployment
 * check`'s, and whatever needs the other instances is a refusal of that instance at load.
 */

import { approvalsRefusals } from './approvals-rules.js';
import { deploymentRefusals } from './deployment-refusals.js';
import { keyOf } from './pointers.js';
import type { IdentityMethodV1, IdentityV1 } from './read-boot.js';
import { saysShellName } from './shell-name.js';
import type {
	DeploymentRead,
	DeploymentRefusal,
	DeploymentV1,
	DeploymentV2,
	DeploymentV3,
	DeploymentV4,
	DeploymentWorkspaceV2,
	HostKindV1,
} from './types.js';
import {
	validateDeployment,
	validateDeploymentV2,
	validateDeploymentV3,
	validateDeploymentV4,
} from './validate-host.generated.js';

/** Every version this reader reads. */
type AnyDeployment = DeploymentV1 | DeploymentV2 | DeploymentV3 | DeploymentV4;

/** An instance entry of any version: version 4 adds `labels`, `approvals` and `views` (phase 5 specification, 5.1, 7.2, 9.3). */
type Instance = DeploymentV1['apps'][string] &
	Pick<DeploymentV4['apps'][string], 'labels' | 'approvals' | 'views'>;

/** What a version 1 file, or a version 2 file naming none, means (phase 2 specification, 4.2). */
export const DEFAULT_WORKSPACE_V2: Readonly<DeploymentWorkspaceV2> = Object.freeze({
	id: 'personal',
	name: 'Personal',
});

/** The default name of a workspace: its id, capitalized. */
export function workspaceNameOf(id: string): string {
	return `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
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
	'labels',
	'approvals',
	'views',
	'expose',
	'commands',
] as const satisfies readonly (keyof Instance)[];

function urlAllowed(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol === 'https:') return true;
	if (parsed.protocol !== 'http:') return false;
	const host = parsed.hostname;
	return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** The characters a CSP source must not carry, such as `;`, are ones `URL` lets through in a host. */
const ORIGIN = /^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d+)?$/;

function canonicalOrigin(value: string): boolean {
	try {
		return ORIGIN.test(value) && new URL(value).origin === value;
	} catch {
		return false;
	}
}

function instanceRefusals(id: string, entry: Instance): DeploymentRefusal[] {
	const refusals: DeploymentRefusal[] = [];
	const refuse = (
		code: DeploymentRefusal['code'],
		pointer: string,
		message: string,
		suggestion: string
	): void => {
		refusals.push({ code, key: keyOf(`/apps/${id}${pointer}`), message, suggestion });
	};
	const mounted = MOUNTED_KEYS.some((key) => entry[key] !== undefined);
	if (!mounted && id !== entry.app) {
		refuse(
			'DEPLOYMENT_INSTANCE_MISMATCH',
			'',
			`Instance \`${id}\` of a native or view app must be named \`${entry.app}\`.`,
			`Rename the table \`[apps.${entry.app}]\`. A mounted instance names itself, with \`audience\`.`
		);
	}
	if (mounted && entry.audience === undefined) {
		refuse(
			'DEPLOYMENT_AUDIENCE_REQUIRED',
			'/audience',
			'A mounted instance says who it serves.',
			'Set `audience` to `team` or `person`.'
		);
	}
	if (entry.audience === 'team' && (entry.transport === 'stdio' || entry.command !== undefined)) {
		refuse(
			'DEPLOYMENT_TEAM_NEEDS_HTTP',
			'/transport',
			'A team instance is reached over `http`.',
			'Set `transport = "http"` with a `url`, or `audience = "person"`.'
		);
	}
	if (entry.bearer_file !== undefined && entry.bearer_env !== undefined) {
		refuse(
			'DEPLOYMENT_CREDENTIAL_CONFLICT',
			'/bearer_env',
			'An instance has at most one credential key.',
			'Keep `bearer_file` or `bearer_env`, not both.'
		);
	}
	if (entry.url !== undefined && !urlAllowed(entry.url)) {
		refuse(
			'DEPLOYMENT_URL_INVALID',
			'/url',
			'`url` must be `https://`, or `http://` on a loopback address.',
			'Use `https://`, or `http://127.0.0.1:<port>/mcp`.'
		);
	}
	const httpKey = (['url', 'bearer_file', 'bearer_env'] as const).find(
		(key) => entry[key] !== undefined
	);
	const stdioKey = (['command', 'cwd'] as const).find((key) => entry[key] !== undefined);
	if (httpKey && (entry.transport === 'stdio' || stdioKey)) {
		refuse(
			'DEPLOYMENT_TRANSPORT_KEYS',
			`/${httpKey}`,
			`\`${httpKey}\` is for \`http\`.`,
			'Keep the keys of one transport.'
		);
	}
	if (stdioKey && entry.transport === 'http') {
		refuse(
			'DEPLOYMENT_TRANSPORT_KEYS',
			`/${stdioKey}`,
			`\`${stdioKey}\` is for \`stdio\`.`,
			'Keep the keys of one transport.'
		);
	}
	if (entry.transport === 'http' && entry.url === undefined) {
		refuse(
			'DEPLOYMENT_TRANSPORT_KEYS',
			'/url',
			'`transport = "http"` needs a `url`.',
			'Add `url`.'
		);
	}
	if (entry.transport === 'stdio' && entry.command === undefined) {
		refuse(
			'DEPLOYMENT_TRANSPORT_KEYS',
			'/command',
			'`transport = "stdio"` needs a `command`.',
			'Add `command`, an array of strings.'
		);
	}
	// A mounted command only a person may run (phase 5 specification, 7.2): what the file can show of it.
	approvalsRefusals(entry as Parameters<typeof approvalsRefusals>[0], refuse);
	return refusals;
}

/** `[identity]`'s defaults (phase 3 specification, 2.2; D99). */
export const DEFAULT_IDENTITY_PATH = 'api/auth';
export const DEFAULT_IDENTITY_METHODS: readonly IdentityMethodV1[] = Object.freeze(['passkey']);

/** The first path segments a deployment's own files and routes use (phase 2 specification, 6.1). */
const SITE_SEGMENTS = [
	'apps',
	'assets',
	'mounts',
	'sandbox',
	'p',
	'~',
	'deployment.json',
	'index.html',
	'404.html',
];
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SEGMENT = /^[A-Za-z0-9._~-]+$/;
const METHOD = /^(passkey|password|oidc:[a-z0-9][a-z0-9-]{0,31})$/;

/** A version 4 `identity.path` that would shadow one of the hosted server's own routes (3.4). */
function shadowsHostRoute(path: string): boolean {
	// Compared in lower case (the final check's NIT 4): a proxy that folds a path's case would read `API/Health` as
	// `api/health`.
	const folded = path.toLowerCase();
	const first = folded.split('/')[0];
	return (
		first === 'mcp' ||
		first === '.well-known' ||
		folded === 'api' ||
		/(^|\/)api\/(kernel|health)(\/|$)/.test(folded)
	);
}

/**
 * Version 3's `[identity]` (phase 3 specification, 2.2): each refusal `DEPLOYMENT_IDENTITY_INVALID`, and a
 * `provider` deployment with a mounted `stdio` instance `DEPLOYMENT_STDIO_TEAM` (D95, the owner's decision of
 * 2026-11-09, which narrows D56). `path` is relative to `site.base_path`, so its first segment may name
 * neither a deployment's own file nor the workspace, whose routes start there.
 */
function identityRefusals(
	deployment: DeploymentV3 | DeploymentV4,
	workspace: string
): DeploymentRefusal[] {
	const identity = deployment.identity;
	if (identity === undefined) return [];
	const refusals: DeploymentRefusal[] = [];
	const refuse = (pointer: string, message: string, suggestion: string): void => {
		refusals.push({
			code: 'DEPLOYMENT_IDENTITY_INVALID',
			key: keyOf(`/identity${pointer}`),
			message,
			suggestion,
		});
	};
	const provider = identity.mode === 'provider';
	if (provider && (identity.organization === undefined || !SLUG.test(identity.organization))) {
		refuse(
			'/organization',
			'A `provider` identity names its organization by slug.',
			"Set `organization` to the organization's slug: lowercase letters, digits and `-`, at most 63."
		);
	}
	const path = identity.path;
	const segments = path?.split('/') ?? [];
	if (
		path !== undefined &&
		(segments.some((segment) => !SEGMENT.test(segment) || segment === '.' || segment === '..') ||
			SITE_SEGMENTS.includes(segments[0] as string) ||
			segments[0] === workspace)
	) {
		refuse(
			'/path',
			"`path` is relative to `site.base_path`, with no leading `/`, no `.` or `..` segment, and no first segment a deployment's own files or its workspace use.",
			`Use \`${DEFAULT_IDENTITY_PATH}\`.`
		);
	}
	// I1 of step 3's review (phase 6 specification, 3.4): in version 4 the provider's prefix never shadows the hosted
	// server's own routes, the MCP route, the origin's well-known paths, `api/kernel` and `api/health`.
	if (path !== undefined && deployment.deployment_version === 4 && shadowsHostRoute(path)) {
		refuse(
			'/path',
			'`path` would take routes the hosted server answers itself: `mcp`, `.well-known`, `api`, `api/kernel` and `api/health`.',
			`Use \`${DEFAULT_IDENTITY_PATH}\`, or another path under \`api/\`.`
		);
	}
	const methods = identity.methods;
	if (
		methods !== undefined &&
		(methods.length === 0 ||
			new Set(methods).size !== methods.length ||
			methods.some((method) => !METHOD.test(method)))
	) {
		refuse(
			'/methods',
			'`methods` names each way in once: `passkey`, `password` or `oidc:<provider-id>`.',
			'Use `["passkey"]`, the default; add `"password"` or `"oidc:<id>"` only if you need them.'
		);
	}
	if (provider) {
		for (const [id, entry] of Object.entries(deployment.apps)) {
			if (entry.transport === 'stdio' || entry.command !== undefined) {
				refusals.push({
					code: 'DEPLOYMENT_STDIO_TEAM',
					key: keyOf(`/apps/${id}/transport`),
					message: `\`${id}\` is a \`stdio\` instance, which a shared, \`provider\` workspace does not run: it would run as the server's own user for every member.`,
					suggestion: `Serve \`${id}\` over HTTP, with \`transport = "http"\` and a \`url\`.`,
				});
			}
		}
	}
	return refusals;
}

/** Providers a `[copilot]` may list, as `copilotOf` reads the projection. */
const COPILOT_PROVIDERS_MAX = 16;

/** An `openai-compatible` endpoint (phase 5 specification, 4.1): `https`, or `http` to 127.0.0.1 or ::1 only. */
export function copilotEndpointAllowed(endpoint: string): boolean {
	if (endpoint.includes('?') || endpoint.includes('#') || endpoint.includes('@')) return false;
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		return false;
	}
	if (parsed.protocol === 'https:') return parsed.hostname !== '';
	return (
		parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
	);
}

/**
 * Version 4's `[copilot]` (phase 5 specification, 4.1 and 4.2), past its schema: ids once each, a `default` naming
 * one of them, an `endpoint` for `openai-compatible` alone, a key for `anthropic` and `openai`, none for `test`,
 * and on any host but the desktop no kind but `test` (`COPILOT_PROVIDER_HOST`): only the desktop's Rust host holds
 * a key until milestone C gives the hosted server its model route.
 */
function copilotRefusals(deployment: DeploymentV4, host: HostKindV1): DeploymentRefusal[] {
	const copilot = deployment.copilot;
	if (copilot === undefined) return [];
	const refusals: DeploymentRefusal[] = [];
	const refuse = (pointer: string, message: string, suggestion: string): void => {
		refusals.push({
			code: 'DEPLOYMENT_COPILOT_INVALID',
			key: keyOf(`/copilot${pointer}`),
			message,
			suggestion,
		});
	};
	const providers = copilot.providers ?? [];
	const seen = new Set<string>();
	providers.forEach((provider, index) => {
		const at = `/providers/${index}`;
		if (seen.has(provider.id))
			refuse(
				`${at}/id`,
				`The provider \`${provider.id}\` is named twice.`,
				'Give each provider its own id.'
			);
		seen.add(provider.id);
		const compatible = provider.kind === 'openai-compatible';
		if (compatible && provider.endpoint === undefined)
			refuse(
				`${at}/endpoint`,
				'An `openai-compatible` provider names its `endpoint`.',
				"Set `endpoint` to the server's base URL, such as `http://127.0.0.1:11434/v1`."
			);
		if (provider.endpoint !== undefined && !compatible)
			refuse(
				`${at}/endpoint`,
				`A \`${provider.kind}\` provider has its kind's fixed endpoint.`,
				'Remove `endpoint`, or use `kind = "openai-compatible"`.'
			);
		if (compatible && provider.endpoint !== undefined && !copilotEndpointAllowed(provider.endpoint))
			refuse(
				`${at}/endpoint`,
				'`endpoint` is `https`, or `http` to 127.0.0.1 or ::1 only, with no user, query or fragment.',
				'Use `https://…`, or `http://127.0.0.1:<port>/…` for a model server on this computer.'
			);
		if (provider.kind === 'test' && provider.key !== undefined)
			refuse(`${at}/key`, 'The test provider takes no key.', 'Remove `key`.');
		if ((provider.kind === 'anthropic' || provider.kind === 'openai') && provider.key === undefined)
			refuse(
				`${at}/key`,
				`A \`${provider.kind}\` provider names where its key is kept.`,
				`Add \`key = { keychain = "loam-copilot", account = "${provider.id}" }\`, then run \`loam copilot key set ${provider.id}\`.`
			);
		if (host !== 'desktop' && provider.kind !== 'test')
			refusals.push({
				code: 'COPILOT_PROVIDER_HOST',
				key: keyOf(`/copilot${at}/kind`),
				message: `Only the desktop's host holds a model's key: a ${host} deployment can use only \`kind = "test"\`.`,
				suggestion:
					'A static deployment can use only `kind = "test"`; use the desktop, or a hosted deployment once its model route exists.',
			});
	});
	if (copilot.default !== undefined && !seen.has(copilot.default))
		refuse(
			'/default',
			'`default` names no provider listed here.',
			"Set `default` to one of the providers' ids, or remove it to use the first."
		);
	if (providers.length === 0)
		refuse(
			'',
			'`[copilot]` lists no provider.',
			'Add a `[[copilot.providers]]` table, or remove `[copilot]`.'
		);
	if (providers.length > COPILOT_PROVIDERS_MAX)
		refuse(
			'/providers',
			`\`[copilot]\` lists more than ${COPILOT_PROVIDERS_MAX} providers.`,
			'Keep the providers you use.'
		);
	return refusals;
}

/** The identity a read deployment carries: `[identity]` with its defaults, or `local`. */
function identityOf(deployment: AnyDeployment): IdentityV1 {
	const identity =
		deployment.deployment_version === 3 || deployment.deployment_version === 4
			? deployment.identity
			: undefined;
	if (identity?.mode !== 'provider') return { mode: 'local' };
	return {
		mode: 'provider',
		organization: identity.organization as string,
		path: identity.path ?? DEFAULT_IDENTITY_PATH,
		methods: (identity.methods as IdentityMethodV1[] | undefined) ?? [...DEFAULT_IDENTITY_METHODS],
	};
}

/**
 * The desktop's sandbox scheme on macOS and Linux: a custom protocol's origin, which no URL parser outside a
 * webview reads as one (phase 6 specification, 10.2). Only a desktop deployment may name it.
 */
const DESKTOP_SANDBOX_SCHEME_ORIGIN = 'loam-sandbox://localhost';

/** The origin reaches the shell's CSP and a frame's address, so it must be one origin and no more. */
function sandboxRefusals(deployment: AnyDeployment): DeploymentRefusal[] {
	const { sandbox } = deployment;
	if (sandbox === undefined || canonicalOrigin(sandbox.origin)) return [];
	if (sandbox.origin === DESKTOP_SANDBOX_SCHEME_ORIGIN && hostKindOf(deployment) === 'desktop')
		return [];
	return [
		{
			code: 'DEPLOYMENT_INVALID',
			key: keyOf('/sandbox/origin'),
			message: '`sandbox.origin` is not an origin in its canonical form.',
			suggestion: 'Use a lowercase scheme and host, such as `https://sandbox.example.com`.',
		},
	];
}

/**
 * `p` would read as a URL's project segment (phase 2 specification, 6.1), from version 2; `shell` and `loam` as the
 * shell's own, an overlay's owner among them (phase 4 specification, 6.6), in every version.
 */
function reservedInstances(deployment: AnyDeployment): DeploymentRefusal[] {
	return Object.keys(deployment.apps).flatMap((id): DeploymentRefusal[] => {
		if (id === 'shell' || id === 'loam') {
			return [
				{
					code: 'DEPLOYMENT_INSTANCE_RESERVED',
					key: keyOf(`/apps/${id}`),
					message: `The instance id \`${id}\` is reserved: it names the shell's own.`,
					suggestion: 'Name the instance after the app, such as `notes`.',
				},
			];
		}
		if (id !== 'p' || deployment.deployment_version === 1) return [];
		return [
			{
				code: 'DEPLOYMENT_INSTANCE_RESERVED',
				key: keyOf(`/apps/${id}`),
				message: `The instance id \`${id}\` is reserved: it would read as a URL's project segment.`,
				suggestion: 'Name the instance something else, such as `plan`.',
			},
		];
	});
}

/** An instance's `title` is the rail's label and its overlays' owner line: never "Loam" as a word (phase 4's 6.6). */
function reservedTitles(deployment: AnyDeployment): DeploymentRefusal[] {
	return Object.entries(deployment.apps).flatMap(([id, entry]): DeploymentRefusal[] => {
		const { title } = entry as { title?: unknown };
		if (typeof title !== 'string' || !saysShellName(title)) return [];
		return [
			{
				code: 'DEPLOYMENT_TITLE_RESERVED',
				key: keyOf(`/apps/${id}/title`),
				message: `The title \`${title}\` says "Loam", which is the shell's name.`,
				suggestion: "Title the instance after the app, without the shell's name.",
			},
		];
	});
}

/** The host a file names: version 4's `[host] kind`, else `static`, as versions 1 to 3 read (phase 6 specification, 3.3). */
export function hostKindOf(deployment: AnyDeployment): HostKindV1 {
	return (deployment.deployment_version === 4 ? deployment.host?.kind : undefined) ?? 'static';
}

/**
 * 3.3's rules between the host and the identity (phase 6 specification): a `provider` deployment for a static
 * host is a warning, since a static host serves no provider (phase 3's test-only auth host still serves one in
 * tests), and for the desktop a refusal, since the desktop joins no hosted workspace (10.1).
 */
function hostFindings(
	host: HostKindV1,
	identity: IdentityV1
): { refusals: DeploymentRefusal[]; warnings: DeploymentRefusal[] } {
	if (identity.mode !== 'provider') return { refusals: [], warnings: [] };
	if (host === 'desktop') {
		return {
			refusals: [
				{
					code: 'DEPLOYMENT_DESKTOP_PROVIDER',
					key: 'host.kind',
					message:
						'A `provider` deployment is served by the hosted server; the desktop runs a personal shell.',
					suggestion:
						'Use `[host] kind = "hosted"` for a team, or `[identity] mode = "local"` on the desktop.',
				},
			],
			warnings: [],
		};
	}
	return host === 'static'
		? {
				refusals: [],
				warnings: [
					{
						code: 'DEPLOYMENT_PROVIDER_NEEDS_HOST',
						key: 'host.kind',
						message:
							'A provider deployment needs the hosted server; a static host serves no provider.',
						suggestion:
							'Serve it with `loam-host`: `deployment_version = 4` with `[host] kind = "hosted"`.',
					},
				],
			}
		: { refusals: [], warnings: [] };
}

/**
 * Reads versions 1 to 4; a version 1 file means the `personal` workspace and `/`, a file before 3, or one
 * with no `[identity]`, the `local` identity (phase 3 specification, 2.2), and a file before 4, or one with no
 * `[host]`, the `static` host (phase 6 specification, 3.3).
 */
export function readDeployment(json: unknown): DeploymentRead {
	const version = (json as { deployment_version?: unknown } | null)?.deployment_version;
	const [validate, schema] =
		version === 4
			? ([validateDeploymentV4, 'deploymentV4'] as const)
			: version === 3
				? ([validateDeploymentV3, 'deploymentV3'] as const)
				: version === 2
					? ([validateDeploymentV2, 'deploymentV2'] as const)
					: ([validateDeployment, 'deployment'] as const);
	if (!validate(json)) {
		// Any `[identity]` key out of shape is its own code (2.2), and version 4's workspace ids name the hosted
		// server's segments too (phase 6 specification, 3.3), here and not in the page's shared rows.
		const refusals = deploymentRefusals(validate.errors ?? [], schema).map((refusal) =>
			schema === 'deploymentV4' && refusal.key === 'workspace.id'
				? {
						...refusal,
						message:
							"`workspace.id` must be lowercase letters, digits and `-`, at most 63, and not a name a deployment's own files or the hosted server's routes use.",
						suggestion: `${refusal.suggestion.replace(/ and `404\.html` are reserved\.$/, ', `404.html`')}, \`api\`, \`mcp\` and \`.well-known\` are reserved.`,
					}
				: schema === 'deploymentV4' && refusal.key.startsWith('copilot')
					? {
							...refusal,
							code: 'DEPLOYMENT_COPILOT_INVALID' as const,
							message: `\`${refusal.key}\` is not a copilot setting this shell reads.`,
							suggestion:
								'Write `[copilot]` with `default` and `[[copilot.providers]]` tables of `id`, `kind` and `model`, with `endpoint` and `key` where the kind takes them.',
						}
					: (schema === 'deploymentV3' || schema === 'deploymentV4') &&
							refusal.key.startsWith('identity')
						? {
								...refusal,
								code: 'DEPLOYMENT_IDENTITY_INVALID' as const,
								message: `\`${refusal.key}\` is not an identity this shell reads.`,
								suggestion:
									'Write `[identity]` with `mode`, `provider = "better-auth"`, `organization`, `path` and `methods`, and nothing else.',
							}
						: refusal
		);
		return { ok: false, refusals, warnings: [] };
	}
	const deployment = json as AnyDeployment;
	const named = deployment.deployment_version !== 1 ? deployment.workspace : undefined;
	const id = named?.id ?? DEFAULT_WORKSPACE_V2.id;
	const refusals = [
		...sandboxRefusals(deployment),
		...reservedInstances(deployment),
		...reservedTitles(deployment),
		...Object.entries(deployment.apps).flatMap(([id, entry]) => instanceRefusals(id, entry)),
		...(deployment.deployment_version === 3 || deployment.deployment_version === 4
			? identityRefusals(deployment, id)
			: []),
	];
	if (refusals.length > 0) return { ok: false, refusals, warnings: [] };
	const identity = identityOf(deployment);
	const host = hostKindOf(deployment);
	if (deployment.deployment_version === 4) {
		const copilot = copilotRefusals(deployment, host);
		if (copilot.length > 0) return { ok: false, refusals: copilot, warnings: [] };
	}
	const found = hostFindings(host, identity);
	if (found.refusals.length > 0) return { ok: false, refusals: found.refusals, warnings: [] };
	return {
		ok: true,
		deployment,
		workspace: named?.id
			? { id, name: named.name ?? workspaceNameOf(id) }
			: { ...DEFAULT_WORKSPACE_V2, ...(named?.name ? { name: named.name } : {}) },
		basePath: (deployment.deployment_version !== 1 && deployment.site?.base_path) || '/',
		identity,
		host,
		warnings: found.warnings,
	};
}
