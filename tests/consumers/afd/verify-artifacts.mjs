#!/usr/bin/env node
/**
 * Packed-artifact protocol conformance verifier (#1739).
 *
 * Packs `@lushly-dev/afd-core` and `@lushly-dev/afd-server` from built workspace packages with
 * `pnpm pack`, installs those tarballs into a fresh project outside workspace resolution, builds
 * a minimal scripted MCP server that imports only those installed tarballs, and verifies:
 *
 * 1. `spec/protocol-conformance.json` over stdio in both MCP eras (`legacy` 2025-11-25 and
 *    `modern` 2026-07-28), with every tool result validated against
 *    `spec/schema/{result,batch,pipeline}.json`.
 * 2. HTTP SSE streaming (`POST /stream/todo-list`), with every emitted `StreamChunk` validated
 *    against `spec/schema/stream.json`.
 *
 * Usage:
 *   pnpm -F @lushly-dev/afd-core -F @lushly-dev/afd-server build
 *   node tests/consumers/afd/verify-artifacts.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execTool, spawnTool } from '../../../scripts/release/exec-tool.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'afd-packed-conformance-')));
const artifacts = join(root, 'artifacts');
const consumer = join(root, 'consumer');

function freePort() {
	return new Promise((resolvePort, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			probe.close(() =>
				typeof address === 'object' && address
					? resolvePort(address.port)
					: reject(new Error('No port assigned'))
			);
		});
	});
}

async function waitForHealth(url, child, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`Packed HTTP server exited early with code ${child.exitCode}`);
		}
		try {
			if ((await fetch(url)).ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new Error(`Packed HTTP server did not answer ${url} within ${timeoutMs}ms`);
}

async function killChild(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((done) => child.once('exit', () => done()));
	child.kill();
	const forced = setTimeout(() => child.kill('SIGKILL'), 5000);
	await exited;
	clearTimeout(forced);
}

/** Execute `streamCases` from `spec/protocol-conformance.json` and validate against `spec/schema/stream.json`. */
async function verifyHttpStreaming(serverScript) {
	const specSuite = JSON.parse(
		readFileSync(join(repository, 'spec/protocol-conformance.json'), 'utf8')
	);
	const streamCases = (specSuite.streamCases ?? []).filter((entry) =>
		entry.implementedBy?.includes('typescript')
	);
	assert.ok(
		streamCases.length > 0,
		'Expected at least one typescript streamCase in spec/protocol-conformance.json'
	);

	const { AjvJsonSchemaValidator } = createRequire(
		join(repository, 'packages/examples/todo/package.json')
	)('@modelcontextprotocol/client/validators/ajv');
	const validator = new AjvJsonSchemaValidator();
	const loadSchema = (name) =>
		JSON.parse(readFileSync(join(repository, 'spec/schema', name), 'utf8'));
	validator.getValidator(loadSchema('error.json'));
	validator.getValidator(loadSchema('result.json'));
	const validateStreamChunk = validator.getValidator(loadSchema('stream.json'));

	const port = await freePort();
	const child = spawn(process.execPath, [serverScript], {
		env: { ...process.env, TRANSPORT: 'http', PORT: String(port) },
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	try {
		await waitForHealth(`http://127.0.0.1:${port}/health`, child);
		for (const streamCase of streamCases) {
			const response = await fetch(`http://127.0.0.1:${port}${streamCase.path}`, {
				method: streamCase.method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(streamCase.input ?? {}),
			});
			assert.equal(
				response.status,
				streamCase.expect.status,
				`${streamCase.name}: expected ${streamCase.expect.status} from ${streamCase.path}, got ${response.status}`
			);
			const body = await response.text();
			const chunks = [];
			for (const line of body.split(/\r?\n/)) {
				if (!line.startsWith('data:')) continue;
				const payload = line.slice('data:'.length).trim();
				if (!payload) continue;
				const chunk = JSON.parse(payload);
				const outcome = validateStreamChunk(chunk);
				assert.equal(
					outcome.valid,
					true,
					`${streamCase.name}: StreamChunk broke spec/schema/stream.json: ${outcome.errorMessage ?? JSON.stringify(chunk)}`
				);
				chunks.push(chunk);
			}
			assert.ok(
				chunks.length >= streamCase.expect.minChunks,
				`${streamCase.name}: expected at least ${streamCase.expect.minChunks} StreamChunk(s) from ${streamCase.path}, got ${chunks.length}`
			);
			assert.equal(
				chunks.at(-1)?.type,
				streamCase.expect.terminalType,
				`${streamCase.name}: expected terminal '${streamCase.expect.terminalType}' chunk, got ${JSON.stringify(chunks.at(-1))}`
			);
			console.log(
				`ok - ${streamCase.name} (${chunks.length} chunk(s) match spec/schema/stream.json)`
			);
		}
	} finally {
		await killChild(child);
	}
}

try {
	await mkdir(artifacts, { recursive: true });
	await mkdir(consumer, { recursive: true });

	const sources = ['packages/core', 'packages/server'];
	const packs = {};
	for (const rel of sources) {
		const dir = join(repository, rel);
		assert.ok(existsSync(join(dir, 'dist')), `${rel} is not built; run pnpm build first`);
		const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
		execTool('pnpm', ['pack', '--pack-destination', artifacts], { cwd: dir, stdio: 'pipe' });
		const tgz = join(
			artifacts,
			`${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`
		);
		assert.ok(existsSync(tgz), `Missing packed tarball ${tgz}`);
		packs[manifest.name] = tgz;
	}

	const file = (name) => `file:${packs[name]}`;
	const consumerManifest = {
		name: 'afd-packed-conformance-consumer',
		private: true,
		type: 'module',
		dependencies: {
			'@lushly-dev/afd-core': file('@lushly-dev/afd-core'),
			'@lushly-dev/afd-server': file('@lushly-dev/afd-server'),
			zod: '^4.6.6',
		},
		pnpm: {
			overrides: {
				'@lushly-dev/afd-core': file('@lushly-dev/afd-core'),
			},
		},
	};
	await writeFile(join(consumer, 'package.json'), `${JSON.stringify(consumerManifest, null, 2)}\n`);

	const installed = spawnTool('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], {
		cwd: consumer,
		encoding: 'utf8',
	});
	assert.equal(
		installed.status,
		0,
		`Failed to install packed tarballs:\n${installed.stdout}\n${installed.stderr}`
	);

	// Minimal scripted MCP server importing ONLY the packed tarballs.
	const serverScript = join(consumer, 'server.mjs');
	await writeFile(
		serverScript,
		`import { error, success } from '@lushly-dev/afd-core';
import { createMcpServer, defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';

const store = new Map();
let seq = 0;

const READ_CONTEXTS = ['todo-reading', 'todo-editing'];
const EDIT_CONTEXTS = ['todo-editing'];

const commands = [
	defineCommand({
		name: 'todo-create',
		description: 'Create a todo',
		expose: { mcp: true, agent: true },
		contexts: EDIT_CONTEXTS,
		input: z.object({ title: z.string().min(1), priority: z.enum(['low', 'medium', 'high']).default('medium') }),
		async handler(input) {
			const id = 'todo-' + String(++seq);
			const item = { id, title: input.title, priority: input.priority, completed: false };
			store.set(id, item);
			return success(item);
		},
	}),
	defineCommand({
		name: 'todo-list',
		description: 'List todos',
		expose: { mcp: true, agent: true },
		contexts: READ_CONTEXTS,
		input: z.object({}),
		async handler() {
			const todos = [...store.values()];
			return success({ todos, total: todos.length });
		},
	}),
	defineCommand({
		name: 'todo-get',
		description: 'Get a todo by ID',
		expose: { mcp: true, agent: true },
		contexts: READ_CONTEXTS,
		input: z.object({ id: z.string() }),
		async handler(input) {
			const item = store.get(input.id);
			if (!item) return error('NOT_FOUND', 'Todo not found', { suggestion: 'List todos first' });
			return success(item);
		},
	}),
	defineCommand({
		name: 'todo-toggle',
		description: 'Toggle todo completion',
		expose: { mcp: true, agent: true },
		contexts: EDIT_CONTEXTS,
		input: z.object({ id: z.string() }),
		async handler(input) {
			const item = store.get(input.id);
			if (!item) return error('NOT_FOUND', 'Todo not found', { suggestion: 'List todos first' });
			item.completed = !item.completed;
			return success(item);
		},
	}),
	defineCommand({
		name: 'todo-clear',
		description: 'Clear todos',
		expose: { mcp: true, agent: true },
		contexts: EDIT_CONTEXTS,
		input: z.object({ all: z.boolean().optional() }),
		async handler() {
			const cleared = store.size;
			store.clear();
			return success({ cleared });
		},
	}),
	defineCommand({
		name: 'todo-internal-ping',
		description: 'Private internal probe not exposed to MCP',
		expose: { mcp: false, agent: true },
		input: z.object({}),
		async handler() {
			return success({ pong: true });
		},
	}),
];

const server = createMcpServer({
	name: 'packed-protocol-conformance',
	version: '1.0.0',
	transport: process.env.TRANSPORT === 'http' ? 'http' : 'stdio',
	host: '127.0.0.1',
	port: Number(process.env.PORT || 3101),
	commands,
	contexts: [
		{ name: 'todo-reading', description: 'Read-only todo commands' },
		{ name: 'todo-editing', description: 'Read and write todo commands' },
	],
	bootstrap: true,
});

await server.start();
`
	);

	// Drive the packed server through the shared protocol conformance runner in both MCP eras.
	const todoDir = join(repository, 'packages/examples/todo');
	for (const mode of ['legacy', 'modern']) {
		execTool(
			'pnpm',
			[
				'exec',
				'tsx',
				'dx/run-conformance.ts',
				'--backend',
				'ts',
				'--server-script',
				serverScript,
				'--suite',
				'protocol',
				'--mode',
				mode,
			],
			{ cwd: todoDir, stdio: 'inherit' }
		);
		console.log(`ok - packed protocol conformance (${mode} era)`);
	}

	await verifyHttpStreaming(serverScript);
	console.log('Packed AFD artifact protocol conformance passed.');
} finally {
	await rm(root, { recursive: true, force: true });
}
