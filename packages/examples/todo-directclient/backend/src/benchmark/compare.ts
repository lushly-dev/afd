/**
 * @fileoverview Measure one command both ways on this machine: through DirectClient in this
 * process, and over MCP (Streamable HTTP on loopback) to a server in this process with the same
 * commands, middleware and store. Both run the full engine (validation, approvals middleware,
 * history, logging), so the difference is the transport.
 *
 * The numbers depend on the machine and its load; the README states none for that reason.
 *
 * Run: pnpm benchmark [iterations]
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTodoServerOptions } from '@afd/example-todo-ts/server-options';
import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { createDirectClient } from '@lushly-dev/afd-client';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import { createMcpHandler } from '@lushly-dev/afd-server';
import { createCopilotRegistry } from '../registry.js';

const env = {};
const iterations = Number.parseInt(process.argv[2] ?? '500', 10);
const warmup = Math.min(100, iterations);

/** Run `fn` `iterations` times after a warm-up; the median and 95th percentile, in ms. */
async function measure(fn: () => Promise<unknown>): Promise<{ p50: number; p95: number }> {
	for (let i = 0; i < warmup; i++) await fn();
	const times: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const start = performance.now();
		await fn();
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return {
		p50: times[Math.floor(times.length * 0.5)] ?? 0,
		p95: times[Math.floor(times.length * 0.95)] ?? 0,
	};
}

const store = new TodoStore();
for (let i = 0; i < 20; i++) store.create({ title: `Benchmark todo ${i}` });
setStore(store);

const direct = createDirectClient(createCopilotRegistry(env), { actor: { kind: 'agent' } });

const handler = createMcpHandler({ ...createTodoServerOptions(env), host: '127.0.0.1' });
const server = http.createServer((req, res) => void handler(req, res));
await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
const { port } = server.address() as AddressInfo;
const transport = new StreamableHttpTransport(`http://127.0.0.1:${port}/mcp`, {
	clientName: 'benchmark',
	clientVersion: '1.0.0',
});
await transport.connect();

// Both must succeed, or the comparison times an error path
const listOverMcp = (id: number) =>
	transport.send({
		jsonrpc: '2.0',
		id,
		method: 'tools/call',
		params: { name: 'todo-list', arguments: { limit: 20 } },
	});
const probe = await listOverMcp(0);
const probeResult = probe.result as { isError?: boolean } | undefined;
if (
	!(await direct.call('todo-list', { limit: 20 })).success ||
	probe.error ||
	probeResult?.isError
) {
	throw new Error('todo-list failed; nothing to compare');
}

// Both paths log each call to stderr, as the servers do; drop those lines while measuring, so
// writing them to a terminal does not decide the result
const log = console.error;
console.error = () => {};
let id = 0;
const directResult = await measure(() => direct.call('todo-list', { limit: 20 }));
const mcpResult = await measure(() => listOverMcp(++id));

console.error = log;
transport.disconnect();
handler.dispose();
server.close();

const row = (name: string, { p50, p95 }: { p50: number; p95: number }) =>
	`${name.padEnd(28)} median ${p50.toFixed(3).padStart(8)} ms   p95 ${p95.toFixed(3).padStart(8)} ms`;
console.log(`todo-list over 20 todos, ${iterations} calls each after ${warmup} to warm up:\n`);
console.log(row('DirectClient (in process)', directResult));
console.log(row('MCP (Streamable HTTP)', mcpResult));
console.log(`\nMCP took ${(mcpResult.p50 / directResult.p50).toFixed(0)}x as long at the median.`);
