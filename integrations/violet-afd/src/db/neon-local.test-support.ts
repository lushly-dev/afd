/**
 * Neon leg without a Neon account. With VIOLET_NEON_LOCAL_PROXY set (and no
 * VIOLET_NEON_DATABASE_URL), this vitest setup file serves Neon's WebSocket
 * proxy protocol in-process, bridged to the VIOLET_TEST_POSTGRES_URL server
 * only, and points the Neon driver at it. NeonPostgresClient then runs its
 * real driver path (@neondatabase/serverless over WebSocket) against plain
 * Postgres. Hosted Neon itself is not exercised.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { neonConfig } from '@neondatabase/serverless';
import { WebSocketServer } from 'ws';

const target = process.env.VIOLET_TEST_POSTGRES_URL;

if (process.env.VIOLET_NEON_LOCAL_PROXY && !process.env.VIOLET_NEON_DATABASE_URL) {
	if (!target) throw new Error('VIOLET_NEON_LOCAL_PROXY needs VIOLET_TEST_POSTGRES_URL');
	const { hostname, port } = new URL(target);
	const allowed = `${hostname}:${port || 5432}`;
	const http = createServer();
	const proxy = new WebSocketServer({ server: http });
	proxy.on('connection', (socket, request) => {
		const address = new URL(request.url ?? '/', 'ws://proxy').searchParams.get('address');
		if (address !== allowed) {
			socket.close(1008, 'address not allowed');
			return;
		}
		const tcp = connect({ host: hostname, port: Number(port || 5432) });
		socket.on('message', (data: Buffer) => tcp.write(data));
		tcp.on('data', (data) => socket.send(data));
		socket.on('close', () => tcp.end());
		tcp.on('close', () => socket.close());
		tcp.on('error', () => socket.terminate());
	});
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	http.unref();
	const proxyPort = (http.address() as AddressInfo).port;
	neonConfig.wsProxy = (host, hostPort) => `127.0.0.1:${proxyPort}/v1?address=${host}:${hostPort}`;
	neonConfig.useSecureWebSocket = false;
	neonConfig.pipelineConnect = false;
	neonConfig.pipelineTLS = false;
	process.env.VIOLET_NEON_DATABASE_URL = target;
}
