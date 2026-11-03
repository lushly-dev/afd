/**
 * @fileoverview The deployment file's reader (phase 1 specification, 3.1): what can be said from the
 * file alone. Whatever needs a package's manifest, such as an instance's kind, is `loam deployment
 * check`'s, and whatever needs the other instances is a refusal of that instance at load.
 */

import { deploymentRefusals } from './deployment-refusals.js';
import { keyOf } from './pointers.js';
import type {
	DeploymentRead,
	DeploymentRefusal,
	DeploymentV1,
	DeploymentV2,
	DeploymentWorkspaceV2,
} from './types.js';
import { validateDeployment, validateDeploymentV2 } from './validate-host.generated.js';

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

/** The origin reaches the shell's CSP and a frame's address, so it must be one origin and no more. */
function sandboxRefusals({ sandbox }: DeploymentV1 | DeploymentV2): DeploymentRefusal[] {
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
function reservedInstances(deployment: DeploymentV1 | DeploymentV2): DeploymentRefusal[] {
	return Object.keys(deployment.apps)
		.filter((id) => id === 'p')
		.map((id) => ({
			code: 'DEPLOYMENT_INSTANCE_RESERVED',
			key: keyOf(`/apps/${id}`),
			message: `The instance id \`${id}\` is reserved: it would read as a URL's project segment.`,
			suggestion: 'Name the instance something else, such as `plan`.',
		}));
}

/** Reads version 1 and version 2; a version 1 file means the `personal` workspace and `/`. */
export function readDeployment(json: unknown): DeploymentRead {
	const version = (json as { deployment_version?: unknown } | null)?.deployment_version;
	const validate = version === 2 ? validateDeploymentV2 : validateDeployment;
	if (!validate(json)) {
		return {
			ok: false,
			refusals: deploymentRefusals(
				validate.errors ?? [],
				version === 2 ? 'deploymentV2' : 'deployment'
			),
			warnings: [],
		};
	}
	const deployment = json as DeploymentV1 | DeploymentV2;
	const refusals = [
		...sandboxRefusals(deployment),
		...(deployment.deployment_version === 2 ? reservedInstances(deployment) : []),
		...Object.entries(deployment.apps).flatMap(([id, entry]) => instanceRefusals(id, entry)),
	];
	if (refusals.length > 0) return { ok: false, refusals, warnings: [] };
	const named = deployment.deployment_version === 2 ? deployment.workspace : undefined;
	const id = named?.id ?? DEFAULT_WORKSPACE_V2.id;
	return {
		ok: true,
		deployment,
		workspace: named?.id
			? { id, name: named.name ?? workspaceNameOf(id) }
			: { ...DEFAULT_WORKSPACE_V2, ...(named?.name ? { name: named.name } : {}) },
		basePath: (deployment.deployment_version === 2 && deployment.site?.base_path) || '/',
		warnings: [],
	};
}
