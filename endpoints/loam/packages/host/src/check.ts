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

/** The kind a deployment file declares: version 4's `[host] kind`, else `static` (3.3). */
export function hostKindOf(analysis: DeploymentAnalysis): HostKind {
	return analysis.host ?? 'static';
}

/** The identity mode a deployment file declares: version 3's `[identity] mode`, or `local` (phase 3's 2.1). */
export function identityModeOf(analysis: DeploymentAnalysis): 'local' | 'provider' {
	return analysis.identity?.mode ?? 'local';
}

/** The `oidc:<id>` sign-in methods a deployment names (version 3's `[identity] methods`). */
export function oidcMethodsOf(analysis: DeploymentAnalysis): string[] {
	const identity = analysis.identity;
	if (identity?.mode !== 'provider') return [];
	return identity.methods
		.filter((method) => method.startsWith('oidc:'))
		.map((method) => method.slice('oidc:'.length));
}

/**
 * Better Auth 1.7.26's environment variables that would change what Loam trusts (B1 of step 3's review; the
 * coordinator's decision of 2026-11-16): each widens or replaces a rule Loam sets from its own files, so the hosted
 * server does not run while one is set. `BETTER_AUTH_TRUSTED_ORIGINS` is always added to the trusted origins,
 * `BETTER_AUTH_SECRETS` replaces the `[auth]` secret, and `BETTER_AUTH_TELEMETRY` turns telemetry on whatever the
 * options say. The other variables Better Auth reads are pinned by `createLoamAuthOptions` (phase 3's 5.8).
 */
export const BETTER_AUTH_OVERRIDES: readonly string[] = Object.freeze([
	'BETTER_AUTH_TRUSTED_ORIGINS',
	'BETTER_AUTH_SECRETS',
	'BETTER_AUTH_TELEMETRY',
]);

/**
 * Whether Better Auth acts on a variable's value: any non-empty value, but for `BETTER_AUTH_TELEMETRY` only one it
 * reads as on, which is anything but `""`, `"0"` or `"false"` in any case (its `getBooleanEnvVar`; the final check's
 * NIT 1), since `=0` is the usual way to opt out of telemetry.
 */
function overrides(name: string, value: string | undefined): boolean {
	const set = value ?? '';
	if (name === 'BETTER_AUTH_TELEMETRY')
		return set !== '' && set !== '0' && set.toLowerCase() !== 'false';
	return set !== '';
}

/** One `HOST_ENV_OVERRIDE` per override variable set to a value Better Auth acts on. */
export function environmentFindings(environment: NodeJS.ProcessEnv): HostFinding[] {
	return BETTER_AUTH_OVERRIDES.filter((name) => overrides(name, environment[name])).map((name) => ({
		code: 'HOST_ENV_OVERRIDE',
		key: name,
		message: `\`${name}\` is set: Better Auth would take it over what the deployment and server configuration say.`,
		suggestion: `Unset ${name}: Loam takes its origins and secret only from the deployment and server configuration.`,
	}));
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
	const kind = hostKindOf(analysis);
	const mode = identityModeOf(analysis);
	// Only a version 4 file with `[host] kind = "hosted"`: a static deployment is never served by accident (3.3).
	if (kind !== 'hosted') {
		refusals.push({
			code: 'HOST_DEPLOYMENT_KIND',
			key: options.deployment,
			message: `This deployment is for a \`${kind}\` host, not the hosted server.`,
			suggestion:
				'Use a version 4 deployment file with `[host] kind = "hosted"`; a static deployment is served by any static host.',
		});
	}
	if (options.purpose === 'start' && mode === 'local') {
		refusals.push({
			code: 'HOST_IDENTITY_LOCAL',
			key: options.deployment,
			message:
				'A `local` deployment makes every actor an owner, so the hosted server does not start one.',
			suggestion:
				'Use `[identity] mode = "provider"`, or serve a personal shell from a static host or the desktop.',
		});
	}
	// A workspace id the hosted server answers at the top level (`api`, `mcp`, `mounts`, `.well-known`, the identity
	// path's first segment) is version 4's reader's `DEPLOYMENT_WORKSPACE_INVALID` or `DEPLOYMENT_IDENTITY_INVALID`
	// since step 3, so the analysis has refused it before here (step 1's obligation; its deviation 2).
	if (kind === 'hosted' && mode === 'provider') {
		// The provider's secret and its mail (step 1's deviation 5: both are optional for a `local` deployment).
		if (server.auth === undefined) {
			refusals.push({
				code: 'HOST_SECRET_UNAVAILABLE',
				key: 'auth',
				message:
					"A `provider` deployment needs the provider's secret, and the configuration has no `[auth]`.",
				suggestion:
					'Add `[auth]` with `secret_file` (mode 0600) or `secret_env`, at least 32 bytes.',
			});
		}
		if (server.mail === undefined) {
			refusals.push({
				code: 'HOST_CONFIG_INVALID',
				key: 'mail',
				message:
					'A `provider` deployment sends invitations and recovery links, and the configuration has no `[mail]`.',
				suggestion: 'Add `[mail]`: `transport = "sink"` on `localhost`.',
			});
		} else if (server.mail.transport === 'smtp') {
			// Section 9's SMTP is the production profile's (step 8); until then, refused rather than silently unsent.
			refusals.push({
				code: 'HOST_CONFIG_INVALID',
				key: 'mail.transport',
				message:
					"`smtp` mail is the production profile's, built with milestone M2; until then the server sends only to the development profile's sink.",
				suggestion:
					'Use `loam-host dev`, whose mail goes to its sink, until the production profile is built.',
			});
		}
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
	const methods = new Set(oidcMethodsOf(analysis));
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
	// Before anything else: an environment that would override the provider's trust (B1).
	const refusals: HostFinding[] = [...environmentFindings(options.environment ?? process.env)];
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
