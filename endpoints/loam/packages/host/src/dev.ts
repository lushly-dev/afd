/**
 * @fileoverview `loam-host dev` (phase 6 specification, 5.1): the development profile, in 5.1's order.
 *
 * 1. Takes the lock; creates the data directory 0700 with a `.gitignore` of `*`.
 * 2. Makes the certificate and the auth secret on the first run, and reuses them.
 * 3. Binds both listeners first, on the ports `dev.json` records, or free ones it then records.
 * 4. Builds the server configuration from the bound ports: `https://localhost:<port>`, the sink, and the
 *    sandbox on `https://127.0.0.1:<second port>`, another site, written in place of the file's.
 * 5. Starts, and reports `{ origin, sandboxOrigin, spki, mail }`.
 */

import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDeployment } from '@lushly-dev/loam-cli/deployment';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import {
	createMailSink,
	type DevPorts,
	ensureAuthSecret,
	ensureCertificate,
	privateDirectory,
	readDevPorts,
	writeDevPorts,
	writePrivate,
} from './dev-files.js';
import { HostError } from './errors.js';
import { createLoamHost, type LoamHost } from './host.js';
import { bindServer, createHostServer, HOST_INTERNALS } from './internal.js';
import { acquireDataLock, type DataLock } from './lock.js';
import { SERVE_STATIC_DEPLOYMENT, type TestOnlyOptions } from './testing-only.js';

/** The directory beside the deployment file that `--data` defaults to. */
export const DEV_DATA_DIRECTORY = '.loam-dev';

/** The web host's build in this workspace, which `--dist` defaults to. */
export const WORKSPACE_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface DevOptions {
	/** The path of `loam.deployment.toml`. */
	deployment: string;
	/** The data directory; `.loam-dev/` beside the deployment file by default. */
	data?: string;
	/** The shell's port: `0` picks a free one. A port other than `dev.json`'s is refused. */
	port?: number;
	/** The web host's build; the workspace's `web/dist` by default. */
	dist?: string;
}

export interface DevProfile {
	host: LoamHost;
	origin: string;
	sandboxOrigin: string | null;
	/** The base64 SHA-256 of the certificate's public key. */
	spki: string;
	/** The certificate's path, for `NODE_EXTRA_CA_CERTS`. */
	certificate: string;
	/** The mail sink's file. */
	mail: string;
	data: string;
}

function portTaken(port: number, which: string): HostError {
	return new HostError([
		{
			code: 'HOST_PORT_TAKEN',
			key: `${DEV_DATA_DIRECTORY}/dev.json`,
			message: `Port ${port}, which \`dev.json\` records for the ${which}, is in use.`,
			suggestion:
				'Free the port, or remove `dev.json` and accept a new origin, which passkeys and the provider bind to.',
		},
	]);
}

async function bindRecorded(
	server: Server,
	port: number,
	recorded: boolean,
	which: string
): Promise<number> {
	try {
		await bindServer(server, '127.0.0.1', port);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'EADDRINUSE' && (recorded || port !== 0))
			throw portTaken(port, which);
		throw cause;
	}
	return (server.address() as AddressInfo).port;
}

/** Whether the deployment needs the sandbox's origin: a view app, or a `[sandbox]` of its own. */
async function needsSandbox(deployment: string): Promise<boolean> {
	const analysis = await analyzeDeployment(deployment);
	return (
		analysis.deployment?.sandbox !== undefined ||
		analysis.instances.some(({ rawKind }) => rawKind === 'view')
	);
}

/** Runs the development profile; the returned host listens, holds the lock and owns its sockets. */
export async function runDev(options: DevOptions & TestOnlyOptions): Promise<DevProfile> {
	const deployment = resolve(options.deployment);
	const data = resolve(options.data ?? join(dirname(deployment), DEV_DATA_DIRECTORY));
	const dist = resolve(options.dist ?? WORKSPACE_DIST);
	// 1. The lock first: nothing in the directory is written by a second process.
	await privateDirectory(data);
	const lock: DataLock = acquireDataLock(data);
	const servers: Server[] = [];
	let handedOver = false;
	try {
		await writePrivate(join(data, '.gitignore'), '*\n');
		// 2. The certificate and the secret, kept across runs.
		const tls = await ensureCertificate(data);
		const secret = await ensureAuthSecret(data);
		const mail = await createMailSink(data);
		// 3. Both listeners bound before the configuration exists, so the origin is the bound port's.
		const recorded = readDevPorts(data);
		if (recorded && options.port !== undefined && options.port !== recorded.port) {
			throw new HostError([
				{
					code: 'HOST_DEV_PORT_CHANGED',
					key: '--port',
					message: `\`--port\` ${options.port} is not ${recorded.port}, the port \`dev.json\` records: the origin, which the provider and every passkey are bound to, would change.`,
					suggestion: 'Drop `--port`, or remove `dev.json` to change the origin deliberately.',
				},
			]);
		}
		const material = { cert: readFileSync(tls.certificate), key: readFileSync(tls.key) };
		const shell = createHostServer(material);
		servers.push(shell);
		const port = await bindRecorded(
			shell,
			recorded?.port ?? options.port ?? 0,
			recorded !== null,
			'shell'
		);
		let sandboxPort: number | undefined;
		let sandbox: Server | undefined;
		if (await needsSandbox(deployment)) {
			sandbox = createHostServer(material);
			servers.push(sandbox);
			// A view app added after `dev.json` was written binds a free port and leaves the origin as it is.
			sandboxPort = await bindRecorded(
				sandbox,
				recorded?.sandboxPort ?? 0,
				recorded?.sandboxPort !== undefined,
				'sandbox'
			);
		}
		const ports: DevPorts = { port, ...(sandboxPort ? { sandboxPort } : {}) };
		if (recorded?.port !== ports.port || recorded?.sandboxPort !== ports.sandboxPort)
			await writeDevPorts(data, ports);
		// 4. The configuration, in memory, from the bound ports.
		const origin = `https://localhost:${port}`;
		const sandboxOrigin = sandboxPort ? `https://127.0.0.1:${sandboxPort}` : null;
		const server: ServerConfigV1 = {
			server_version: 1,
			origin,
			listen: `127.0.0.1:${port}`,
			data,
			tls: { cert_file: tls.certificate, key_file: tls.key },
			auth: { secret_file: secret },
			mail: { transport: 'sink' },
			...(sandboxOrigin
				? { sandbox: { origin: sandboxOrigin, listen: `127.0.0.1:${sandboxPort}` } }
				: {}),
		};
		handedOver = true;
		const host = await createLoamHost({
			server,
			deployment,
			dist,
			[HOST_INTERNALS]: {
				lock,
				servers: { shell, ...(sandbox ? { sandbox } : {}) },
				...(sandboxOrigin ? { sandboxOrigin } : {}),
			},
			...(options[SERVE_STATIC_DEPLOYMENT] ? { [SERVE_STATIC_DEPLOYMENT]: true as const } : {}),
		});
		// 5. Serving.
		await host.listen();
		return {
			host,
			origin,
			sandboxOrigin,
			spki: tls.spki,
			certificate: tls.certificate,
			mail: mail.path,
			data,
		};
	} catch (cause) {
		if (!handedOver) {
			for (const server of servers) if (server.listening) server.close();
			lock.release();
		}
		throw cause;
	}
}
