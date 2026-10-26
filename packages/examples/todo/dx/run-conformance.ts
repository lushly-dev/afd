import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	Client,
	StreamableHTTPClientTransport,
	type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ConformanceRunner, wireProblems } from './conformance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKENDS = ['ts', 'py', 'rs', 'cpp'] as const;
type Backend = (typeof BACKENDS)[number];

/**
 * How the runner negotiates the MCP protocol revision:
 *
 * - `legacy` (default): the 2025 `initialize` handshake, as every backend speaks today;
 * - `auto`: probe `server/discover`, fall back to `initialize` for a legacy backend;
 * - `modern`: require 2026-07-28 (stateless, per-request `_meta`) and fail otherwise.
 */
const MODES = ['legacy', 'auto', 'modern'] as const;
type Mode = (typeof MODES)[number];

function isBackend(value: string | undefined): value is Backend {
	return BACKENDS.some((backend) => backend === value);
}

function isMode(value: string | undefined): value is Mode {
	return MODES.some((mode) => mode === value);
}

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

/** A free TCP port on 127.0.0.1. */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			probe.close(() =>
				typeof address === 'object' && address
					? resolve(address.port)
					: reject(new Error('No port assigned'))
			);
		});
	});
}

/** Poll `url` until it answers 200, the process exits, or the timeout passes. */
async function waitForHealth(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`The backend exited with code ${child.exitCode} before it was ready`);
		}
		try {
			if ((await fetch(url)).ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`The backend did not answer ${url} within ${timeoutMs / 1000}s`);
}

/**
 * The Rust backend speaks MCP over HTTP rather than stdio: start it on a free
 * port and connect with the Streamable HTTP client transport.
 */
async function startRustBackend(): Promise<{ transport: Transport; child: ChildProcess }> {
	const port = await freePort();
	const manifest = path.join(__dirname, '../backends/rust/Cargo.toml');
	const child = spawn(
		'cargo',
		['run', '--locked', '--quiet', '--manifest-path', manifest, '--', 'server'],
		{
			env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
			stdio: ['ignore', 'ignore', 'inherit'],
		}
	);
	const base = `http://127.0.0.1:${port}`;
	try {
		// Generous: the first run may still compile the crate.
		await waitForHealth(`${base}/health`, child, 300_000);
	} catch (error) {
		child.kill();
		throw error;
	}
	return { transport: new StreamableHTTPClientTransport(new URL(`${base}/mcp`)), child };
}

async function run() {
	const target = option('--backend');
	const mode = option('--mode') ?? 'legacy';
	if (!isBackend(target) || !isMode(mode)) {
		console.error(
			`Usage: tsx dx/run-conformance.ts --backend <${BACKENDS.join('|')}> [--mode <${MODES.join('|')}>]`
		);
		process.exit(1);
	}
	const specPath = path.join(__dirname, '../spec/test-cases.json');

	console.log(`Running conformance tests against: ${target} (protocol mode: ${mode})`);

	let transport: Transport;
	let child: ChildProcess | undefined;

	if (target === 'ts') {
		transport = new StdioClientTransport({
			command: 'node',
			args: [path.join(__dirname, '../backends/typescript/dist/server.js')],
			env: { ...process.env, PORT: '3101', TODO_STORE_TYPE: 'memory' },
		});
	} else if (target === 'py') {
		transport = new StdioClientTransport({
			command: 'uv',
			args: ['run', '--project', path.join(__dirname, '../backends/python'), 'todo-server'],
			env: { ...process.env, TODO_STORE_TYPE: 'memory' } as Record<string, string>,
		});
	} else if (target === 'cpp') {
		// Built by `pnpm test:conformance:cpp` (CMake); speaks MCP over stdio like ts and py.
		const executable = process.platform === 'win32' ? 'todo-server-cpp.exe' : 'todo-server-cpp';
		transport = new StdioClientTransport({
			command: path.join(__dirname, '../backends/cpp/build/release', executable),
			env: { ...process.env, TODO_STORE_TYPE: 'memory' } as Record<string, string>,
		});
	} else {
		({ transport, child } = await startRustBackend());
	}

	const client = new Client(
		{ name: 'conformance-runner', version: '1.0.0' },
		{
			capabilities: {},
			versionNegotiation: {
				mode: mode === 'modern' ? { pin: '2026-07-28' } : mode,
			},
		}
	);

	console.log('Connecting to MCP server...');
	try {
		await client.connect(transport);
		console.log(
			`Connected: ${client.getProtocolEra()} era, protocol ${client.getNegotiatedProtocolVersion()}.`
		);

		const runner = new ConformanceRunner(async (name, args) => {
			console.log(`Calling tool: ${name}`, args);
			const result = (await client.callTool({
				name,
				arguments: args as Record<string, unknown>,
			})) as { content: Array<{ text: string }>; isError?: boolean };
			const text = result.content[0]?.text;
			let parsed: unknown;
			try {
				parsed = text ? JSON.parse(text) : result;
			} catch (e) {
				console.error(`Failed to parse JSON from tool ${name}. Raw text:`, text);
				throw e;
			}
			const problems = wireProblems(parsed, result.isError === true);
			if (problems.length > 0) {
				throw new Error(`${name} broke the wire format (spec/wire): ${problems.join('; ')}`);
			}
			return parsed as { success: boolean; data?: unknown; error?: { message: string } };
		});

		const results = await runner.run(specPath);

		let passed = 0;
		results.forEach((r) => {
			if (r.success) {
				passed++;
				console.log(`✅ ${r.name}`);
			} else {
				console.log(`❌ ${r.name}: ${r.error}`);
			}
		});

		console.log(`\nSummary: ${passed}/${results.length} passed`);

		await client.close();
		child?.kill();
		process.exit(passed === results.length ? 0 : 1);
	} catch (error) {
		child?.kill();
		throw error;
	}
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
