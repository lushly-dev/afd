/**
 * @fileoverview What `loam-host check` reports and `createLoamHost` refuses on (phase 6 specification,
 * 3.2 and 3.3), without starting: the server configuration's rules, its secrets and modes, and how it
 * meets the deployment file and the web host's build.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeDeployment, type DeploymentAnalysis } from '@lushly-dev/loam-cli/deployment';
import { readServerConfig, type ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import type { HostFinding } from './errors.js';
import { metaPolicy } from './headers.js';
import { type ResolvedSecrets, resolveSecrets } from './secrets.js';

type Deployment = NonNullable<DeploymentAnalysis['deployment']>;

/** Which host serves a deployment. Versions 1 to 3 have no `[host]` and read as `static` (3.3). */
export type HostKind = 'static' | 'hosted' | 'desktop';

/** The kind a deployment file declares. No version this package reads yet has `[host]`. */
export function hostKindOf(_deployment: Deployment): HostKind {
	return 'static';
}

/** The identity mode a deployment file declares: versions 1 and 2 are `local` (phase 3's 2.1). */
export function identityModeOf(_deployment: Deployment): 'local' | 'provider' {
	return 'local';
}

/** The `oidc:<id>` sign-in methods a deployment names; versions 1 and 2 name none. */
export function oidcMethodsOf(_deployment: Deployment): string[] {
	return [];
}

/**
 * The first path segments the hosted server answers itself (3.4), which a workspace id, the first segment
 * of the shell's URLs under `<base>`, must not take. Step 3 adds them to version 4's reserved list
 * (approved by the coordinator 2026-11-09); until then the hosted server refuses them here. Already
 * refused by version 2's schema: `mounts` (in its reserved list) and `.well-known` (its pattern admits no
 * dot). `api` covers the default `identity.path`, `api/auth`, and every `HostModule`, all served under
 * `<base>api/`; a deployment with an `identity.path` of its own arrives with version 3 and adds its first
 * segment through {@link hostRouteSegments}.
 */
export const HOST_ROUTE_SEGMENTS: readonly string[] = Object.freeze([
	'api',
	'mcp',
	'mounts',
	'.well-known',
]);

/** The segments a deployment's workspace id must not take: 3.4's, and its identity path's first. */
export function hostRouteSegments(_deployment: Deployment): readonly string[] {
	return HOST_ROUTE_SEGMENTS;
}

export interface CheckHostOptions {
	server: ServerConfigV1;
	/** The path of `loam.deployment.toml`. */
	deployment: string;
	/** The web host's `vite build` output; absent for `doctor`, which takes no `--dist`. */
	dist?: string;
	/**
	 * What will run: `start` refuses a `local` deployment (3.3, `HOST_IDENTITY_LOCAL`), and `serve`, what
	 * `createLoamHost` itself does for `start` and `dev`, does not.
	 */
	purpose: 'start' | 'serve';
	/** Test-only, until step 3: a version 1 to 3 deployment, read as `static`, is served. */
	serveStatic?: boolean;
	/** The development profile's: the deployment is read as if its `[sandbox] origin` were this one (5.1). */
	sandboxOrigin?: string;
	environment?: NodeJS.ProcessEnv;
}

export interface HostCheck {
	refusals: HostFinding[];
	warnings: HostFinding[];
	analysis?: DeploymentAnalysis;
	secrets?: ResolvedSecrets;
}

function deploymentFindings(
	server: ServerConfigV1,
	analysis: DeploymentAnalysis,
	options: CheckHostOptions
): { refusals: HostFinding[]; warnings: HostFinding[] } {
	const refusals: HostFinding[] = [];
	const warnings: HostFinding[] = [];
	const deployment = analysis.deployment as Deployment;
	const kind = hostKindOf(deployment);
	if (kind !== 'hosted' && !options.serveStatic) {
		refusals.push({
			code: 'HOST_DEPLOYMENT_KIND',
			key: options.deployment,
			message: `This deployment is for a \`${kind}\` host, not the hosted server.`,
			suggestion:
				'Use a version 4 deployment file with `[host] kind = "hosted"`; a static deployment is served by any static host.',
		});
	}
	if (options.purpose === 'start' && identityModeOf(deployment) === 'local') {
		refusals.push({
			code: 'HOST_IDENTITY_LOCAL',
			key: options.deployment,
			message:
				'A `local` deployment makes every actor an owner, so the hosted server does not start one.',
			suggestion:
				'Use `[identity] mode = "provider"`, or serve a personal shell from a static host or the desktop.',
		});
	}
	const workspace = analysis.workspace?.id;
	const segments = hostRouteSegments(deployment);
	if (workspace !== undefined && segments.includes(workspace)) {
		refusals.push({
			code: 'DEPLOYMENT_WORKSPACE_INVALID',
			key: 'workspace.id',
			message: `The workspace id \`${workspace}\` is a path the hosted server answers itself, so the shell's URLs under it would never reach the shell.`,
			suggestion: `Choose another id, such as \`acme\`: ${segments.map((id) => `\`${id}\``).join(', ')} are the hosted server's.`,
		});
	}
	const declared = deployment.sandbox?.origin;
	const configured = server.sandbox?.origin;
	if (configured !== undefined && declared !== configured) {
		refusals.push({
			code: 'HOST_SANDBOX_INVALID',
			key: 'sandbox.origin',
			message:
				declared === undefined
					? 'The deployment file names no `[sandbox] origin`, and the server configuration does.'
					: "`sandbox.origin` is not the deployment file's `[sandbox] origin`.",
			suggestion: 'Name the same origin in both files.',
		});
	} else if (configured === undefined && declared !== undefined) {
		refusals.push({
			code: 'HOST_SANDBOX_INVALID',
			key: 'sandbox',
			message: 'The deployment file names a `[sandbox] origin`, and the server serves none.',
			suggestion:
				"Add `[sandbox] origin` to the server configuration, the same origin as the deployment file's.",
		});
	} else if (
		configured === undefined &&
		analysis.instances.some(({ rawKind }) => rawKind === 'view')
	) {
		refusals.push({
			code: 'HOST_SANDBOX_INVALID',
			key: 'sandbox',
			message: 'The deployment has a view app, and the server serves no sandbox (D62).',
			suggestion:
				'Add `[sandbox] origin` to both files: another site, such as `https://loam-sandbox.example.net`.',
		});
	}
	const methods = new Set(oidcMethodsOf(deployment));
	const tables = new Set(Object.keys(server.oidc ?? {}));
	for (const id of methods) {
		if (!tables.has(id)) {
			refusals.push({
				code: 'HOST_OIDC_INVALID',
				key: `oidc.${id}`,
				message: `The deployment's method \`oidc:${id}\` has no \`[oidc.${id}]\`.`,
				suggestion: `Add \`[oidc.${id}]\` with its issuer, client id and secret.`,
			});
		}
	}
	for (const id of tables) {
		if (!methods.has(id)) {
			refusals.push({
				code: 'HOST_OIDC_INVALID',
				key: `oidc.${id}`,
				message: `No sign-in method of the deployment names \`[oidc.${id}]\`.`,
				suggestion: `Remove \`[oidc.${id}]\`, or add \`oidc:${id}\` to the deployment's \`[identity] methods\`.`,
			});
		}
	}
	if ((analysis.basePath ?? '/') !== '/') {
		warnings.push({
			code: 'HOST_ORIGIN_SHARED',
			key: 'site.base_path',
			message:
				'One deployment per origin: the session cookie and the root `/.well-known/oauth-*` paths belong to the origin, so `base_path` serves a proxy that maps a path, never an origin shared with another application.',
			suggestion: 'Serve the deployment on an origin of its own, or keep the path a mapping only.',
		});
	}
	return { refusals, warnings };
}

function distFindings(dist: string): HostFinding[] {
	const index = join(dist, 'index.html');
	if (!existsSync(index)) {
		return [
			{
				code: 'DEPLOYMENT_PATH_INVALID',
				key: '--dist',
				message: '`--dist` holds no `index.html`.',
				suggestion: "Run the web host's `vite build`.",
			},
		];
	}
	const policy = metaPolicy(readFileSync(index, 'utf8'));
	return policy.ok
		? []
		: [
				{
					code: 'DEPLOYMENT_PATH_INVALID',
					key: '--dist',
					message: `\`--dist\`'s \`index.html\` cannot carry its policy as a header: ${policy.reason}.`,
					suggestion: "Run the web host's `vite build`; its page holds phase 0's one policy.",
				},
			];
}

/** Every refusal and warning of 3.2 and 3.3 that step 1 builds, without starting or writing. */
export async function checkHost(options: CheckHostOptions): Promise<HostCheck> {
	const read = readServerConfig(options.server);
	if (!read.ok) return { refusals: read.refusals, warnings: read.warnings };
	const { server } = read;
	const refusals: HostFinding[] = [];
	const warnings: HostFinding[] = [...read.warnings];
	const resolved = resolveSecrets(server, options.environment);
	refusals.push(...resolved.refusals);
	const analysis = await analyzeDeployment(
		options.deployment,
		options.sandboxOrigin === undefined ? {} : { sandboxOrigin: options.sandboxOrigin }
	);
	if (analysis.refusals.length > 0 || !analysis.deployment) {
		refusals.push(...analysis.refusals);
	} else {
		const found = deploymentFindings(server, analysis, options);
		refusals.push(...found.refusals);
		warnings.push(...found.warnings);
		// What the kernel will refuse at load; a write carries these, as `deployment write` does.
		warnings.push(...analysis.instanceRefusals, ...analysis.warnings);
	}
	if (options.dist !== undefined) refusals.push(...distFindings(options.dist));
	return {
		refusals,
		warnings,
		analysis,
		...(resolved.secrets ? { secrets: resolved.secrets } : {}),
	};
}
