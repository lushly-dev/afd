#!/usr/bin/env node
// Step C5: what the repository's Umbel setup costs an agent. Starts `scripts/umbel-components.mjs`
// as a harness would, over MCP stdio, and prints the time to the first answer (the export and the
// server's start), `tools/list`, and `components-brief` on step 0.1's pages, with each answer's
// bytes. Run from the repository root once the binary and Specimen's CLI are built.
//
//   node docs/features/complete/component-briefs/first-consumer/measure.mjs [--starts 5] [--calls 5]
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
	binaryCandidates,
	findBinary,
	REPO_ROOT,
} from '../../../../../scripts/umbel-components.mjs';

const option = (name, fallback) => {
	const index = process.argv.indexOf(`--${name}`);
	return index < 0 ? fallback : Number(process.argv[index + 1]);
};
const starts = option('starts', 5);
const calls = option('calls', 5);
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const range = (values) =>
	`median ${Math.round(median(values))} (${Math.round(Math.min(...values))} to ${Math.round(Math.max(...values))})`;

/** One server, started as a harness starts it, with a request function over its stdio. */
function start() {
	const started = performance.now();
	const child = spawn(process.execPath, [join(REPO_ROOT, 'scripts/umbel-components.mjs')], {
		cwd: REPO_ROOT,
		stdio: ['pipe', 'pipe', 'ignore'],
	});
	const waiting = new Map();
	let buffer = '';
	child.stdout.on('data', (chunk) => {
		buffer += chunk;
		let end = buffer.indexOf('\n');
		while (end >= 0) {
			const line = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			end = buffer.indexOf('\n');
			if (!line.trim()) continue;
			const message = JSON.parse(line);
			waiting.get(message.id)?.(message);
			waiting.delete(message.id);
		}
	});
	let id = 0;
	const request = (method, params = {}) =>
		new Promise((resolve) => {
			id += 1;
			waiting.set(id, resolve);
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
		});
	const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
	return { child, started, request, notify };
}

async function initialize(server) {
	const answer = await server.request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'c5-measure', version: '0' },
	});
	server.notify('notifications/initialized');
	return { ms: performance.now() - server.started, answer };
}

const binary = findBinary(binaryCandidates());
console.log(`Binary: ${binary}, ${(statSync(binary).size / 1024 / 1024).toFixed(1)} MiB`);

const startup = [];
for (let round = 0; round < starts; round += 1) {
	const server = start();
	startup.push((await initialize(server)).ms);
	server.child.kill();
}
console.log(`Start to the first answer (export and server), ms: ${range(startup)}`);

const server = start();
await initialize(server);
const listed = [];
let tools;
for (let round = 0; round < calls; round += 1) {
	const at = performance.now();
	tools = await server.request('tools/list');
	listed.push(performance.now() - at);
}
console.log(
	`tools/list, ms: ${range(listed)}; ${tools.result.tools.length} tools, ${JSON.stringify(tools.result).length} bytes`
);

const { pages } = JSON.parse(
	readFileSync(
		join(REPO_ROOT, 'endpoints/umbel/plugins/components/tests/fast_af/pages.json'),
		'utf8'
	)
);
for (const page of pages) {
	const times = [];
	let bytes = 0;
	let shed = [];
	for (let round = 0; round < calls; round += 1) {
		const at = performance.now();
		const answer = await server.request('tools/call', {
			name: 'components-brief',
			arguments: { tags: page.tags },
		});
		times.push(performance.now() - at);
		const text = answer.result.content.map((part) => part.text ?? '').join('');
		bytes = Buffer.byteLength(text);
		const result = JSON.parse(text);
		shed = (result.data?.omitted ?? []).flatMap((entry) => entry.sections ?? []);
	}
	console.log(
		`components-brief, ${page.page} (${page.tags.length} tags), ms: ${range(times)}; ${bytes} bytes; shed: ${shed.join(', ') || 'nothing'}`
	);
}
server.child.kill();
