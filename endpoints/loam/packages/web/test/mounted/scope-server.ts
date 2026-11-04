/**
 * P2-E6's fixture AFD server (phase 2 specification, 9.2): a real `createMcpHandler` from
 * `@lushly-dev/afd-server`, in the suite's process and reached through the same test-only relay, that
 * declares `dev.loam/scope` as a context field, as any AFD server may. Its two tools answer the scope their
 * context holds: `scope-echo` is first-class, and `scope-whisper` is reached through `afd-call`. So it shows
 * what a server that declares the field receives, and validates; a stock `umbel`, which does not, drops it.
 * It proves nothing of a hosted server, its auth or its limits.
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
