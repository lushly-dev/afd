/**
 * @fileoverview The deployment file's reader (phase 1 specification, 3.1): what can be said from the
 * file alone. Whatever needs a package's manifest, such as an instance's kind, is `loam deployment
 * check`'s, and whatever needs the other instances is a refusal of that instance at load.
 */

import { deploymentRefusals } from './deployment-refusals.js';
import { keyOf } from './pointers.js';
import type { DeploymentRead, DeploymentRefusal, DeploymentV1 } from './types.js';
import { validateDeployment } from './validate-host.generated.js';

type Instance = DeploymentV1['apps'][string];

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

export function readDeployment(json: unknown): DeploymentRead {
	if (!validateDeployment(json)) {
		return {
			ok: false,
			refusals: deploymentRefusals(validateDeployment.errors ?? [], 'deployment'),
			warnings: [],
		};
	}
	const deployment = json as DeploymentV1;
	const refusals = Object.entries(deployment.apps).flatMap(([id, entry]) =>
		instanceRefusals(id, entry)
	);
	return refusals.length > 0
		? { ok: false, refusals, warnings: [] }
		: { ok: true, deployment, warnings: [] };
}
