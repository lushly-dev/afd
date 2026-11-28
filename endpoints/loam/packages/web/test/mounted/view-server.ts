/**
 * P5-B3's mounted server for `shell-open`'s mounted-ui slot (phase 5 specification, 9.3, T32), shared by its Chromium
 * half (`browser/apps/mounted-view.test.ts`) and its desktop half (`desktop/test/mounted-view.test.ts`): a real
 * `createMcpHandler` with one command, which lists two `ui://` views and serves a third it does not list, recording each
 * read it is asked for.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { createMcpHandler, defineCommand, MCP_APP_MIME_TYPE } from '@lushly-dev/afd-server';
import { z } from 'zod';

/** The heading the listed view shows, which no answer or log may hold. */
export const VIEW_HEADING = 'Mounted probe';

/**
 * The view: it initializes, then waits for the test to speak for it through `window.rpc`. Its form posts to `action`,
 * which `form-action 'none'` must refuse.
 */
export function viewHtml(action = 'https://example.com/collect'): string {
	return `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8" /><title>Probe view</title></head>
	<body>
		<main><h1>${VIEW_HEADING}</h1>
		<form action="${action}" method="post"><input name="q" value="1" /></form></main>
		<script>
			const waiting = new Map();
			let next = 1;
			window.rpc = (method, params) => new Promise((resolve) => {
				const id = next++;
				waiting.set(id, resolve);
				parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
			});
			addEventListener('message', (event) => {
				const message = event.data;
				if (event.source !== parent || !waiting.has(message?.id)) return;
				waiting.get(message.id)(message);
				waiting.delete(message.id);
			});
			window.rpc('ui/initialize', {
				protocolVersion: '2026-01-26', appInfo: { name: 'probe', version: '0.1.0' }, appCapabilities: {},
			}).then(() => {
				parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
				window.ready = true;
			});
		</script>
	</body>
</html>`;
}

export const OTHER = '<!doctype html><p>Another listed view</p>';
export const SECRET = '<!doctype html><p>Served, never listed</p>';

/** A mounted AFD server with one command and `ui://` views, recording each read it is asked for. */
export interface ViewServer {
	url: string;
	reads: string[];
	close(): Promise<void>;
}

export async function startViewServer(
	prefix: string,
	options: { formAction?: string } = {}
): Promise<ViewServer> {
	const reads: string[] = [];
	const served: Record<string, string> = {
		[`ui://${prefix}/thread`]: viewHtml(options.formAction),
		[`ui://${prefix}/other`]: OTHER,
		[`ui://${prefix}/secret`]: SECRET,
	};
	const handler = createMcpHandler({
		name: 'loam-view-fixture',
		version: '0.0.0',
		commands: [
			defineCommand({
				name: `${prefix}-ping`,
				description: 'Answers pong, so a refused view call that reached it would show',
				mutation: false,
				expose: { mcp: true, palette: true, agent: true },
				input: z.object({}),
				handler: async () => success({ pong: true }),
			}),
		] as never,
		host: '127.0.0.1',
		toolStrategy: 'hybrid',
		firstClassTools: [`${prefix}-ping`],
		bootstrap: true,
		resources: {
			list: () =>
				['thread', 'other'].map((name) => ({
					uri: `ui://${prefix}/${name}`,
					name,
					mimeType: MCP_APP_MIME_TYPE,
				})),
			read(uri) {
				reads.push(uri);
				const content = served[uri];
				return content === undefined ? undefined : { content, mimeType: MCP_APP_MIME_TYPE };
			},
		},
	});
	const server: Server = createServer((incoming, outgoing) => handler(incoming, outgoing));
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		reads,
		close: () =>
			new Promise((done) => {
				handler.dispose();
				server.closeAllConnections();
				server.close(() => done());
			}),
	};
}
