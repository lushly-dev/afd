/**
 * P6-D7's CLI half, below the desktop (phase 6 specification, 10.8): AFD's own client, the one `afd call` makes for a
 * `/mcp` URL, connects to the dispatcher over HTTP as the Rust host serves it (one JSON answer per `POST`, `202` for a
 * notification, `405` for `GET` and `DELETE`, no session), falls back from `server/discover` to `initialize`, and runs
 * `project-list` with the header `--print-connection` prints. The desktop suite runs the same against the app.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@lushly-dev/afd-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createScopedWorkspace, type ScopedWorkspace } from '../scope/fixtures.js';
import { createInboundDispatcher } from './index.js';

const TOKEN = 'per-run-token';
const open: Array<{ workspace: ScopedWorkspace; server: Server }> = [];
afterEach(async () => {
	for (const { workspace, server } of open.splice(0)) {
		await new Promise((resolve) => server.close(resolve));
		await workspace.kernel.dispose();
	}
});

/** The Rust endpoint's shape over the dispatcher, with the methods a client sees. */
async function serve(): Promise<{ url: string; methods: string[] }> {
	const workspace = await createScopedWorkspace({ agentsAct: true });
	await workspace.kernel.appsReady;
	const inbound = createInboundDispatcher({
		agent: workspace.kernel.agent,
		commands: () => workspace.inboundCommands(),
	});
	const methods: string[] = [];
	const server = createServer(async (request, response) => {
		if (request.headers.authorization !== `Bearer ${TOKEN}`) {
			response.writeHead(401).end();
			return;
		}
		if (request.method !== 'POST') {
			response.writeHead(405, { Allow: 'POST' }).end();
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		methods.push(message.method);
		const answer = await inbound.handle(message);
		if (answer === undefined) {
			response.writeHead(202).end();
			return;
		}
		response
			.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
			.end(JSON.stringify(answer));
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	open.push({ workspace, server });
	const { port } = server.address() as AddressInfo;
	return { url: `http://127.0.0.1:${port}/mcp`, methods };
}

describe('P6-D7: AFD’s client on the inbound endpoint', () => {
	it('connects with the printed header, falls back to initialize, and runs project-list', async () => {
		const { url, methods } = await serve();
		const client = createClient({
			url,
			transport: 'streamable-http',
			headers: { Authorization: `Bearer ${TOKEN}` },
			autoReconnect: false,
		});
		try {
			await client.connect();
			const listed = await client.call<{ items?: Array<{ slug: string }> } | unknown>(
				'project-list',
				{}
			);
			expect(listed.success).toBe(true);
			expect(JSON.stringify(listed.data)).toContain('atlas');
			expect(methods).toContain('initialize');
			expect(methods).toContain('tools/call');
		} finally {
			await client.disconnect();
		}
	});
});
