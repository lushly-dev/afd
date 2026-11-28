/**
 * @fileoverview M3 rule 10 over a real mutual-TLS connection: a token bound to a client
 * certificate (`cnf["x5t#S256"]`, RFC 8705) is accepted only on a connection that presented that
 * certificate. The certificates in `test-support/mtls` are test-only and self-signed.
 */

import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, request, type ServerOptions } from 'node:https';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	startTestAuthorizationServer,
	type TestAuthorizationServer,
} from '../test-support/authorization-server.js';
import { JwtVerifier, jwksKeySource } from './mcp-auth-jwt.js';
import type { Credentials } from './mcp-auth-rules.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const RESOURCE = 'https://todo.example.com/mcp';
const fixture = (name: string) =>
	readFileSync(new URL(`../test-support/mtls/${name}.pem`, import.meta.url), 'utf8');
const server = { key: fixture('server.key'), cert: fixture('server.cert') };
const clientA = { key: fixture('client-a.key'), cert: fixture('client-a.cert') };
const clientB = { key: fixture('client-b.key'), cert: fixture('client-b.cert') };

/** RFC 8705's `x5t#S256`: the SHA-256 of the certificate's DER, base64url. */
const thumbprint = (pem: string) =>
	createHash('sha256').update(new X509Certificate(pem).raw).digest('base64url');

let as: TestAuthorizationServer;
const closers: Array<() => Promise<void>> = [];
beforeAll(async () => {
	as = await startTestAuthorizationServer({ resource: RESOURCE });
});
afterAll(async () => {
	await Promise.all(closers.splice(0).map((close) => close()));
	await as.close();
});

/**
 * A handler with MCP auth behind two HTTPS servers: `port` requires a client certificate the TLS
 * layer verifies (one of the two test clients), and `plain` asks for none.
 */
async function serve(
	requireBoundTokens: boolean
): Promise<{ port: number; plain: number; refusals: { rule: string }[] }> {
	const refusals: { rule: string }[] = [];
	const handler = createMcpHandler({
		name: 'mtls-test',
		version: '1',
		host: '127.0.0.1',
		toolStrategy: 'individual',
		commands: [
			defineCommand({
				name: 'caller-get',
				description: 'Who called',
				expose: { mcp: true },
				input: z.object({}),
				handler: async (_input, context) =>
					success({ cnf: (context?.credentials as Credentials | undefined)?.cnf }),
			}),
		],
		auth: {
			resource: RESOURCE,
			authorizationServers: [as.issuer],
			requireBoundTokens,
			verifier: new JwtVerifier({
				rules: { resource: RESOURCE, requireBoundTokens },
				issuers: [{ issuer: as.issuer, algorithms: ['RS256'], keys: jwksKeySource(as.jwks()) }],
			}),
			onRefusal: (refusal) => refusals.push({ rule: refusal.rule }),
		},
	});
	const serveWith = (handle: typeof handler) => (req: IncomingMessage, res: ServerResponse) => {
		handle(req, res).catch(() => {
			res.writeHead(599);
			res.end();
		});
	};
	const listen = async (options: ServerOptions): Promise<number> => {
		const https = createServer(options, serveWith(handler));
		await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
		closers.push(async () => {
			https.closeAllConnections();
			await new Promise<void>((resolve) => https.close(() => resolve()));
		});
		return (https.address() as AddressInfo).port;
	};
	closers.push(async () => handler.dispose());
	// The TLS layer admits only the two test clients; which one holds a token is the auth layer's.
	const port = await listen({ ...server, requestCert: true, ca: [clientA.cert, clientB.cert] });
	const plain = await listen(server);
	return { port, plain, refusals };
}

/** `caller-get` over HTTPS with `token`, presenting `client`'s certificate when given. */
function call(
	port: number,
	token: string,
	client?: { key: string; cert: string }
): Promise<{ status: number; body: string }> {
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'caller-get', params: {} });
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: '/rpc',
				method: 'POST',
				ca: server.cert,
				...(client ?? {}),
				// A fresh connection per call, so no TLS session carries one client to the next.
				agent: false,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
				);
			}
		);
		req.on('error', reject);
		req.end(body);
	});
}

describe('#2780: M3 rule 10, certificate-bound tokens over mutual TLS', () => {
	it('accepts a bound token only on a connection presenting its certificate', async () => {
		const { port, plain, refusals } = await serve(false);
		const bound = await as.issue({
			claims: { cnf: { 'x5t#S256': thumbprint(clientA.cert) } },
		});
		const own = await call(port, bound, clientA);
		expect(own.status).toBe(200);
		expect(JSON.parse(own.body).result.data.cnf).toEqual({
			'x5t#S256': thumbprint(clientA.cert),
		});
		// Another client's certificate, or none (a server that asks for none), does not hold it.
		expect((await call(port, bound, clientB)).status).toBe(401);
		expect((await call(plain, bound)).status).toBe(401);
		expect(refusals).toEqual([{ rule: 'binding' }, { rule: 'binding' }]);
		// An unbound token needs no certificate, and one does not get in its way.
		const unbound = await as.issue();
		expect((await call(plain, unbound)).status).toBe(200);
		expect((await call(port, unbound, clientB)).status).toBe(200);
	});

	it('refuses an unbound token over mutual TLS when bound tokens are required', async () => {
		const { port, refusals } = await serve(true);
		expect((await call(port, await as.issue(), clientA)).status).toBe(401);
		expect(refusals).toEqual([{ rule: 'binding' }]);
		const bound = await as.issue({
			claims: { cnf: { 'x5t#S256': thumbprint(clientA.cert) } },
		});
		expect((await call(port, bound, clientA)).status).toBe(200);
	});
});
