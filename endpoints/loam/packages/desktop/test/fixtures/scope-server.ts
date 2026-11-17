/**
 * P6-D2's `http` fixture: phase 2's scope server (`web/test/mounted/scope-server.ts`), a real
 * `createMcpHandler` that declares `dev.loam/scope` as a context field and answers the scope it receives,
 * here reached by the desktop's Rust host with the deployer's bearer, which it ignores.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { createMcpHandler, defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';

/** `ScopeV1`, as the kernel declares it: ids alone. */
const SCOPE = z.strictObject({
	workspace: z.string().min(1).max(128),
	project: z.string().min(1).max(128).optional(),
});

/** What one call's handler saw. */
export interface ScopeSeen {
	tool: string;
	scope: unknown;
}

export interface ScopeServer {
	url: string;
	seen: ScopeSeen[];
	close(): Promise<void>;
}

const echo = (name: string, seen: ScopeSeen[]) =>
	defineCommand({
		name,
		description: `Answers the scope its context holds (${name})`,
		mutation: false,
		expose: { mcp: true, palette: true, agent: true },
		input: z.object({ space: z.string().optional() }),
		async handler(input, context) {
			const scope = (context as { scope?: unknown }).scope ?? null;
			seen.push({ tool: name, scope });
			return success({ scope, space: input.space ?? null });
		},
	});

export async function startScopeServer(): Promise<ScopeServer> {
	const seen: ScopeSeen[] = [];
	const handler = createMcpHandler({
		name: 'loam-scope-fixture',
		version: '0.0.0',
		commands: [echo('scope-echo', seen), echo('scope-whisper', seen)] as never,
		contextFields: [{ name: 'scope', meta: 'dev.loam/scope', schema: SCOPE }],
		host: '127.0.0.1',
		toolStrategy: 'hybrid',
		firstClassTools: ['scope-echo'],
		bootstrap: true,
	});
	const server: Server = createServer(handler);
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		seen,
		close: () =>
			new Promise((done) => {
				handler.dispose();
				server.closeAllConnections();
				server.close(() => done());
			}),
	};
}
