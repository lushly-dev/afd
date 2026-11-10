/**
 * @fileoverview The deployment file's reader (phase 1 specification, 3.1): what can be said from the
 * file alone. Whatever needs a package's manifest, such as an instance's kind, is `loam deployment
 * check`'s, and whatever needs the other instances is a refusal of that instance at load.
 */

import { deploymentRefusals } from './deployment-refusals.js';
import { keyOf } from './pointers.js';
import type { IdentityMethodV1, IdentityV1 } from './read-boot.js';
import type {
	DeploymentRead,
	DeploymentRefusal,
	DeploymentV1,
	DeploymentV2,
	DeploymentV3,
	DeploymentWorkspaceV2,
} from './types.js';
import {
	validateDeployment,
	validateDeploymentV2,
	validateDeploymentV3,
} from './validate-host.generated.js';

type Instance = DeploymentV1['apps'][string];

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

/**
 * Version 3's `[identity]` (phase 3 specification, 2.2): each refusal `DEPLOYMENT_IDENTITY_INVALID`, and a
 * `provider` deployment with a mounted `stdio` instance `DEPLOYMENT_STDIO_TEAM` (D95, the owner's decision of
 * 2026-11-09, which narrows D56). `path` is relative to `site.base_path`, so its first segment may name
 * neither a deployment's own file nor the workspace, whose routes start there.
 */
function identityRefusals(deployment: DeploymentV3, workspace: string): DeploymentRefusal[] {
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

/** The identity a read deployment carries: `[identity]` with its defaults, or `local`. */
function identityOf(deployment: DeploymentV1 | DeploymentV2 | DeploymentV3): IdentityV1 {
	const identity = deployment.deployment_version === 3 ? deployment.identity : undefined;
	if (identity?.mode !== 'provider') return { mode: 'local' };
	return {
		mode: 'provider',
		organization: identity.organization as string,
		path: identity.path ?? DEFAULT_IDENTITY_PATH,
		methods: (identity.methods as IdentityMethodV1[] | undefined) ?? [...DEFAULT_IDENTITY_METHODS],
	};
}

/** The origin reaches the shell's CSP and a frame's address, so it must be one origin and no more. */
function sandboxRefusals({
	sandbox,
}: DeploymentV1 | DeploymentV2 | DeploymentV3): DeploymentRefusal[] {
	if (sandbox === undefined || canonicalOrigin(sandbox.origin)) return [];
	return [
		{
			code: 'DEPLOYMENT_INVALID',
			key: keyOf('/sandbox/origin'),
			message: '`sandbox.origin` is not an origin in its canonical form.',
			suggestion: 'Use a lowercase scheme and host, such as `https://sandbox.example.com`.',
		},
	];
}

/** `p` would read as a URL's project segment (phase 2 specification, 6.1). */
function reservedInstances(
	deployment: DeploymentV1 | DeploymentV2 | DeploymentV3
): DeploymentRefusal[] {
	return Object.keys(deployment.apps)
		.filter((id) => id === 'p')
		.map((id) => ({
			code: 'DEPLOYMENT_INSTANCE_RESERVED',
			key: keyOf(`/apps/${id}`),
			message: `The instance id \`${id}\` is reserved: it would read as a URL's project segment.`,
			suggestion: 'Name the instance something else, such as `plan`.',
		}));
}

/**
 * Reads versions 1 to 3; a version 1 file means the `personal` workspace and `/`, and a file before 3, or
 * one with no `[identity]`, the `local` identity (phase 3 specification, 2.2).
 */
export function readDeployment(json: unknown): DeploymentRead {
	const version = (json as { deployment_version?: unknown } | null)?.deployment_version;
	const [validate, schema] =
		version === 3
			? ([validateDeploymentV3, 'deploymentV3'] as const)
			: version === 2
				? ([validateDeploymentV2, 'deploymentV2'] as const)
				: ([validateDeployment, 'deployment'] as const);
	if (!validate(json)) {
		return {
			ok: false,
			refusals: deploymentRefusals(validate.errors ?? [], schema),
			warnings: [],
		};
	}
	const deployment = json as DeploymentV1 | DeploymentV2 | DeploymentV3;
	const named = deployment.deployment_version !== 1 ? deployment.workspace : undefined;
	const id = named?.id ?? DEFAULT_WORKSPACE_V2.id;
	const refusals = [
		...sandboxRefusals(deployment),
		...(deployment.deployment_version !== 1 ? reservedInstances(deployment) : []),
		...Object.entries(deployment.apps).flatMap(([id, entry]) => instanceRefusals(id, entry)),
		...(deployment.deployment_version === 3 ? identityRefusals(deployment, id) : []),
	];
	if (refusals.length > 0) return { ok: false, refusals, warnings: [] };
	return {
		ok: true,
		deployment,
		workspace: named?.id
			? { id, name: named.name ?? workspaceNameOf(id) }
			: { ...DEFAULT_WORKSPACE_V2, ...(named?.name ? { name: named.name } : {}) },
		basePath: (deployment.deployment_version !== 1 && deployment.site?.base_path) || '/',
		identity: identityOf(deployment),
		warnings: [],
	};
}
