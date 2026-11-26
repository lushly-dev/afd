/**
 * Benchmark `tools/list` and `tools/call` over `POST /mcp` (MCP 2026-07-28, stateless) with N
 * commands (#1746). Each request goes through the whole HTTP lane: Host and Origin checks, the
 * SDK's per-request `Server`, admission, the router and the engine.
 *
 * Run from packages/server after `pnpm build`:
 *   node scripts/bench-mcp.mjs [--commands 100,1000] [--iterations 200] [--rounds 7]
 *     [--strategies individual,grouped] [--compare <path to another build's index.js>]
 *
 * `--compare` loads a second build of this package (a copy of `dist/` kept inside this package,
 * such as under `node_modules/`, so its imports resolve) and serves both from this one process,
 * alternating rounds between them, so both see the same load on a busy machine.
 *
 * Each figure is the median of `rounds` rounds, each the mean of `iterations` sequential
 * requests, after a warm-up. The first request of each kind is checked, so a broken route fails
 * the run rather than timing an error.
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { success } from '@lushly-dev/afd-core';
import { z } from 'zod';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
const sizes = String(flag('commands', '100,1000')).split(',').map(Number);
const iterations = Number(flag('iterations', 200));
const rounds = Number(flag('rounds', 7));
const strategies = String(flag('strategies', 'individual,grouped')).split(',');
const compare = flag('compare', undefined);

const builds = [{ label: 'this build', module: await import('../dist/index.js') }];
if (compare) {
	builds.unshift({
		label: compare,
		module: await import(pathToFileURL(resolve(compare)).href),
	});
}

const PROTOCOL = '2026-07-28';
const META = {
	'io.modelcontextprotocol/protocolVersion': PROTOCOL,
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'bench', version: '0' },
};
/** Commands per group under the grouped strategy (`entity<g>-action<a>`). */
const GROUP_SIZE = 10;

function commands(defineCommand, n) {
	return Array.from({ length: n }, (_, i) =>
		defineCommand({
			name: `entity${Math.floor(i / GROUP_SIZE)}-action${i % GROUP_SIZE}`,
			description: `Command ${i}`,
			expose: { mcp: true },
			input: z.object({
				id: z.string().describe('The id'),
				count: z.number().int().min(0).optional(),
				tags: z.array(z.string()).optional(),
			}),
			handler: async (input) => success({ id: input.id }),
		})
	);
}

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

/** Serve `build` with `n` commands under `strategy`; its checked `list` and `call` requests. */
async function serve(build, strategy, n) {
	const { createMcpHandler, defineCommand } = build.module;
	const handler = createMcpHandler({
		name: 'bench',
		version: '1',
		host: '127.0.0.1',
		commands: commands(defineCommand, n),
		toolStrategy: strategy,
		contexts: [{ name: 'a' }],
		contextFields: [{ name: 'tenant', meta: 'example.com/tenant', schema: z.string().optional() }],
	});
	const server = createServer(handler);
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	const url = `http://127.0.0.1:${server.address().port}/mcp`;
	let id = 0;
	const rpc = async (method, params) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': PROTOCOL,
				'Mcp-Method': method,
				...(params?.name && { 'Mcp-Name': params.name }),
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: ++id,
				method,
				params: { ...params, _meta: META },
			}),
		});
		const text = await response.text();
		if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${text.slice(0, 300)}`);
		return text;
	};

	const callName = strategy === 'grouped' ? 'entity0' : 'entity0-action0';
	const callArgs =
		strategy === 'grouped' ? { action: 'action0', params: { id: 'x' } } : { id: 'x' };
	const requests = {
		'tools/list': () => rpc('tools/list', {}),
		'tools/call': () => rpc('tools/call', { name: callName, arguments: callArgs }),
	};

	// One checked request of each kind before timing. The list also holds the five meta-tools
	// and the context tools.
	const listed = JSON.parse(await requests['tools/list']()).result?.tools;
	const atLeast = 5 + (strategy === 'grouped' ? Math.ceil(n / GROUP_SIZE) : n);
	if (!(listed?.length >= atLeast)) {
		throw new Error(`tools/list: expected at least ${atLeast} tools, got ${listed?.length}`);
	}
	const called = JSON.parse(await requests['tools/call']()).result;
	if (called?.isError !== false || called.structuredContent?.success !== true) {
		throw new Error(`tools/call failed: ${JSON.stringify(called).slice(0, 300)}`);
	}

	return {
		requests,
		async close() {
			handler.dispose();
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
		},
	};
}

const rows = [];
for (const strategy of strategies) {
	for (const n of sizes) {
		const served = [];
		for (const build of builds) served.push(await serve(build, strategy, n));
		for (const method of ['tools/list', 'tools/call']) {
			for (const { requests } of served) {
				for (let i = 0; i < 30; i++) await requests[method](); // warm up
			}
			const perRound = served.map(() => []);
			for (let r = 0; r < rounds; r++) {
				// Alternate which build goes first, so neither always follows the other.
				const order = r % 2 === 0 ? [...served.keys()] : [...served.keys()].reverse();
				for (const index of order) {
					const request = served[index].requests[method];
					const start = performance.now();
					for (let i = 0; i < iterations; i++) await request();
					perRound[index].push((performance.now() - start) / iterations);
				}
			}
			rows.push({ strategy, n, method, ms: perRound.map(median) });
		}
		for (const { close } of served) await close();
	}
}

console.log(
	`Node ${process.version}, ${iterations} requests x ${rounds} rounds, median ms/request`
);
const labels = builds.map((build) => build.label);
console.log(`| Strategy | Commands | Method | ${labels.join(' | ')} |`);
console.log(`|---|---:|---|${labels.map(() => '---:').join('|')}|`);
for (const row of rows) {
	const figures = row.ms.map((ms) => ms.toFixed(3)).join(' | ');
	console.log(`| ${row.strategy} | ${row.n} | ${row.method} | ${figures} |`);
}
