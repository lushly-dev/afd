/**
 * P5-A6's `http` fixture (#2137): `mailfix` served by `createMcpHandler` on loopback, MCP 2026-07-28 at `/mcp` and the
 * 2025 era beside it. A request carrying the deployer's bearer is the shell's, and only the shell is an approver: as
 * a mail engine names the credential it gave Loam (its 3.5, Loam's 7.2 "How much this proves"). Every other request
 * has no credentials and is no approver.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMailfixHandler } from '../../../kernel/scenarios/mailfix.ts';

/** The shell's principal binding (M8), set only for the deployer's bearer. */
const SHELL = { issuer: 'loam-desktop-test', subject: 'person', clientId: 'loam-desktop' };

export interface MailfixHttp {
	url: string;
	/** Each request's `MCP-Protocol-Version` header, or `null` when it had none, in order. */
	versions: Array<string | null>;
	close(): Promise<void>;
}

export async function startMailfixHttp(bearer: string): Promise<MailfixHttp> {
	const versions: Array<string | null> = [];
	const handler = createMailfixHandler({
		createContext: (request) =>
			request.headers.authorization === `Bearer ${bearer}`
				? {
						credentials: SHELL,
						actor: { kind: 'agent', id: SHELL.clientId, onBehalfOf: SHELL.subject },
					}
				: {},
		approver: (context) =>
			(context.credentials as { clientId?: unknown } | undefined)?.clientId === SHELL.clientId,
	});
	const server: Server = createServer((request, response) => {
		const version = request.headers['mcp-protocol-version'];
		versions.push(typeof version === 'string' ? version : null);
		return handler(request, response);
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		versions,
		close: () =>
			new Promise((done) => {
				handler.dispose();
				server.closeAllConnections();
				server.close(() => done());
			}),
	};
}
