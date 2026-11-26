/**
 * @fileoverview `loam-host bootstrap` (phase 6 specification, 3.7; phase 3's 5.6 and 10.2 item 2): the only way the
 * first organization, its binding and its first owner come to exist. Both forms run phase 3's `bootstrapOrganization`
 * against the data directory's provider, holding the data directory's lock, so neither runs beside a server:
 *
 * - `--server <file>`, the production profile's, with the server stopped;
 * - `--dev`, the development profile's: the origin from `dev.json`, its generated secret and its mail sink; on an
 *   empty directory it makes the certificate, the secret and the ports itself, as `dev` would.
 *
 * Run again while the bound organization has no member, it sends the first owner a new link and ends the earlier one
 * (phase 3's step 4 review, I5, which amended 10.2 item 2): the deployer's way back when that link lapsed unused. Once
 * the organization has a member it refuses, `HOST_ALREADY_BOOTSTRAPPED`. Nothing serves it over HTTP.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { bootstrapOrganization } from '@lushly-dev/loam-identity';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import { checkHost, environmentFindings } from './check.js';
import { ensureDataDirectory } from './data.js';
import { DEV_DATA_DIRECTORY, devServerConfig, needsSandbox } from './dev.js';
import {
	claimDataDirectory,
	createMailSink,
	DEV_GITIGNORE,
	type DevPorts,
	ensureAuthSecret,
	ensureCertificate,
	readDevPorts,
	writeDevPorts,
	writePrivate,
} from './dev-files.js';
import { HostError } from './errors.js';
import { bindServer, createHostServer } from './internal.js';
import { acquireDataLock } from './lock.js';
import { createMail, type HostProvider, openProvider, type TestOAuthV1 } from './provider.js';

export interface BootstrapInput {
	/** The path of `loam.deployment.toml`. */
	deployment: string;
	slug: string;
	name: string;
	ownerEmail: string;
}

export type BootstrapOptions = BootstrapInput &
	(
		| { form: 'server'; server: ServerConfigV1 }
		| { form: 'dev' /** `.loam-dev/` beside the deployment file by default. */; data?: string }
	);

export interface BootstrapReport {
	organization: { id: string; slug: string };
	/** The first owner's address, which the join link was sent to. */
	invited: string;
	/** True when the organization was bound already and had no member: a new link, the earlier one ended. */
	reissued: boolean;
	expiresAt: string;
}

/** A port the system picks, freed again: `dev` binds it next and keeps it in `dev.json`. */
async function freePort(): Promise<number> {
	const server: Server = createHostServer();
	await bindServer(server, '127.0.0.1', 0);
	const { port } = server.address() as AddressInfo;
	await new Promise<void>((done) => server.close(() => done()));
	return port;
}

/**
 * The development profile's configuration for a bootstrap, from `dev.json`'s ports, or ports it picks and records on
 * an empty directory, with the certificate and secret `dev` would make. The caller holds the lock.
 */
async function devConfiguration(
	data: string,
	deployment: string
): Promise<{ server: ServerConfigV1; sandboxOrigin: string | null }> {
	await writePrivate(join(data, '.gitignore'), DEV_GITIGNORE);
	const tls = await ensureCertificate(data);
	const secret = await ensureAuthSecret(data);
	await createMailSink(data);
	let ports: DevPorts | null = readDevPorts(data);
	const sandbox = await needsSandbox(deployment);
	if (!ports || (sandbox && ports.sandboxPort === undefined)) {
		ports = {
			port: ports?.port ?? (await freePort()),
			...(sandbox || ports?.sandboxPort !== undefined
				? { sandboxPort: ports?.sandboxPort ?? (await freePort()) }
				: {}),
		};
		await writeDevPorts(data, ports);
	}
	const { server, sandboxOrigin } = devServerConfig({
		data,
		ports: sandbox ? ports : { port: ports.port },
		certificate: tls.certificate,
		key: tls.key,
		secret,
	});
	return { server, sandboxOrigin };
}

/** What a bootstrap's provider sees: the provider, and what the deployment names. */
export interface BootstrapProvider {
	provider: HostProvider;
	/** `[identity] organization`. */
	organization: string;
	data: string;
}

/**
 * Runs `use` against the deployment's provider on its data directory, holding the lock: the configuration as the
 * form gives it, every refusal `check` gives for `start` (a `local` deployment among them), then the provider opened
 * on `auth.sqlite` and closed again. Throws `HOST_DATA_LOCKED` while a server holds the directory.
 */
export async function withBootstrapProvider<T>(
	options: { deployment: string } & (
		| { form: 'server'; server: ServerConfigV1 }
		| {
				form: 'dev';
				data?: string;
				/** Tests only, from `startDevHost`: the provider's options for phase 3's step 10 (`TestOAuthV1`). */
				testOAuth?: TestOAuthV1;
		  }
	),
	use: (opened: BootstrapProvider) => Promise<T>
): Promise<T> {
	const deployment = resolve(options.deployment);
	const data =
		options.form === 'dev'
			? resolve(options.data ?? join(dirname(deployment), DEV_DATA_DIRECTORY))
			: options.server.data;
	// An environment that would override the provider's trust refuses the run before anything is written (B1).
	const overrides = environmentFindings(process.env);
	if (overrides.length > 0) throw new HostError(overrides);
	if (options.form === 'dev') await claimDataDirectory(data);
	else await ensureDataDirectory(data);
	const lock = acquireDataLock(data);
	try {
		const { server, sandboxOrigin } =
			options.form === 'dev'
				? await devConfiguration(data, deployment)
				: { server: options.server, sandboxOrigin: null };
		const checked = await checkHost({
			server,
			deployment,
			purpose: 'start',
			...(sandboxOrigin ? { sandboxOrigin } : {}),
		});
		if (checked.refusals.length > 0) throw new HostError(checked.refusals);
		const identity = checked.analysis?.identity;
		if (identity?.mode !== 'provider') throw new Error('The check refuses a `local` deployment.');
		const provider = await openProvider({
			server,
			secrets: checked.secrets ?? { oidc: {} },
			identity,
			workspace: checked.analysis?.workspace?.id as string,
			basePath: checked.analysis?.basePath ?? '/',
			mail: await createMail(server),
			...(options.form === 'dev' && options.testOAuth ? { testOAuth: options.testOAuth } : {}),
		});
		try {
			return await use({ provider, organization: identity.organization, data });
		} finally {
			provider.close();
		}
	} finally {
		lock.release();
	}
}

/**
 * Bootstraps the deployment's organization (3.7). Throws a `HostError`: `HOST_DATA_LOCKED` while a server holds the
 * directory, `DEPLOYMENT_IDENTITY_INVALID` for a `--slug` other than `[identity] organization`, and
 * `HOST_ALREADY_BOOTSTRAPPED` once the organization has a member; and every refusal `check` would give.
 */
export function runBootstrap(options: BootstrapOptions): Promise<BootstrapReport> {
	return withBootstrapProvider(options, async ({ provider, organization, data }) => {
		if (options.slug !== organization) {
			throw new HostError([
				{
					code: 'DEPLOYMENT_IDENTITY_INVALID',
					key: '--slug',
					message: `\`--slug\` ${options.slug} is not the deployment's \`[identity] organization\`, ${organization}.`,
					suggestion: `Use \`--slug ${organization}\`, the deployment's slug.`,
				},
			]);
		}
		if (await provider.hasMembers()) {
			throw new HostError([
				{
					code: 'HOST_ALREADY_BOOTSTRAPPED',
					key: data,
					message: 'The organization is bound and has a member: the bootstrap is done.',
					suggestion: 'Nothing to do: an owner invites people from the account section.',
				},
			]);
		}
		const reissued = await provider.bootstrapped();
		let result: Awaited<ReturnType<typeof bootstrapOrganization>>;
		try {
			result = await bootstrapOrganization(provider.auth, {
				slug: options.slug,
				name: options.name,
				ownerEmail: options.ownerEmail,
			});
		} catch (cause) {
			// The provider's own refusals of the input (a name or an address out of shape), with its words.
			throw new HostError([
				{
					code: 'HOST_CONFIG_INVALID',
					key: '--name, --owner-email',
					message: cause instanceof Error ? cause.message : String(cause),
					suggestion: "A name of 1 to 80 characters, and the first owner's email address.",
				},
			]);
		}
		return {
			organization: { id: result.organizationId, slug: options.slug },
			invited: options.ownerEmail.trim().toLowerCase(),
			reissued,
			expiresAt: result.expiresAt.toISOString(),
		};
	});
}
