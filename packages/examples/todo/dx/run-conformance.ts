import { type ChildProcess, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
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
const BACKENDS = ['ts', 'py', 'rs', 'cpp', 'umbel', 'umbel-mounted'] as const;
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
async function waitForHealth(
	url: string,
	child: ChildProcess,
	timeoutMs: number,
	headers?: Record<string, string>
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`The backend exited with code ${child.exitCode} before it was ready`);
		}
		try {
			if ((await fetch(url, { headers })).ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`The backend did not answer ${url} within ${timeoutMs / 1000}s`);
}

/** A started backend: how to reach it, and how to stop everything the runner started for it. */
interface Started {
	transport: Transport;
	stop(): Promise<void>;
}

/** Kill `child` and wait until it is gone (a process already gone is fine). */
async function kill(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
	child.kill();
	const forced = setTimeout(() => child.kill('SIGKILL'), 5000);
	await exited;
	clearTimeout(forced);
}

/** Start the Rust backend on a free port and wait until it is healthy. */
async function spawnRustServer(
	extraEnv: Record<string, string>
): Promise<{ base: string; child: ChildProcess }> {
	const port = await freePort();
	const manifest = path.join(__dirname, '../backends/rust/Cargo.toml');
	const child = spawn(
		'cargo',
		['run', '--locked', '--quiet', '--manifest-path', manifest, '--', 'server'],
		{
			env: { ...process.env, ...extraEnv, HOST: '127.0.0.1', PORT: String(port) },
			stdio: ['ignore', 'ignore', 'inherit'],
		}
	);
	const base = `http://127.0.0.1:${port}`;
	try {
		// Generous: the first run may still compile the crate.
		await waitForHealth(`${base}/health`, child, 300_000);
	} catch (error) {
		await kill(child);
		throw error;
	}
	return { base, child };
}

/**
 * The Rust backend speaks MCP over HTTP rather than stdio: start it on a free
 * port and connect with the Streamable HTTP client transport.
 */
async function startRustBackend(extraEnv: Record<string, string>): Promise<Started> {
	const { base, child } = await spawnRustServer(extraEnv);
	return {
		transport: new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
		stop: () => kill(child),
	};
}

/** Where cargo puts Umbel's binaries (`endpoints/umbel` is its own workspace). */
function umbelBinary(name: string): string {
	const target =
		process.env.CARGO_TARGET_DIR ?? path.join(__dirname, '../../../../endpoints/umbel/target');
	return path.join(
		path.resolve(target),
		'debug',
		process.platform === 'win32' ? `${name}.exe` : name
	);
}

/** The committed plugin directory that mounts the Rust backend over HTTP (exit run 4). */
const MOUNT_FIXTURE = path.join(
	__dirname,
	'../../../../endpoints/umbel/tests/fixtures/plugins/todo-http'
);

/**
 * Umbel serves the todo commands over Streamable HTTP behind a bearer token:
 *
 * - `umbel`: `umbel-todo`, the `umbel` command line with the todo plugin compiled in;
 * - `umbel-mounted`: the stock `umbel` binary with no plugin compiled in, which mounts the Rust
 *   backend over HTTP from `plugins/todo` in the workspace.
 *
 * Each connection gets a fresh workspace in the system temporary directory and a fresh process.
 */
async function startUmbel(
	target: 'umbel' | 'umbel-mounted',
	extraEnv: Record<string, string>
): Promise<Started> {
	const confirmations = extraEnv.CONFIRMATIONS === 'enforce' ? 'enforce' : 'off';
	const workspace = await mkdtemp(path.join(tmpdir(), 'umbel-todo-conformance-'));
	const cleanups: Array<() => Promise<void>> = [
		() => rm(workspace, { recursive: true, force: true }),
	];
	const stop = async () => {
		for (const cleanup of cleanups.reverse()) await cleanup();
	};
	try {
		const port = await freePort();
		let plugin = '';
		if (target === 'umbel-mounted') {
			// The mount renames tools one by one, so the backend lists one tool per command.
			const backend = await spawnRustServer({ TOOL_STRATEGY: 'individual' });
			cleanups.push(() => kill(backend.child));
			await mkdir(path.join(workspace, 'plugins'));
			await cp(MOUNT_FIXTURE, path.join(workspace, 'plugins/todo'), { recursive: true });
			plugin = `\n[plugins.todo]\nsource = "plugins/todo"\nurl = "${backend.base}/mcp"\nrequired = true\n`;
		}
		await writeFile(
			path.join(workspace, 'umbel.toml'),
			`config_version = 2\n\n[plugins]\nenabled = ["todo"]\n${plugin}\n[mcp]\nconfirmations = "${confirmations}"\n\n[http]\nbind = "127.0.0.1:${port}"\n`
		);
		const child = spawn(
			umbelBinary(target === 'umbel' ? 'umbel-todo' : 'umbel'),
			['--workspace', workspace, 'serve', '--http', '--print-token'],
			{ env: process.env, stdio: ['ignore', 'pipe', 'inherit'] }
		);
		cleanups.push(() => kill(child));
		const token = await readToken(child);
		const headers = { Authorization: `Bearer ${token}` };
		await waitForHealth(`http://127.0.0.1:${port}/health`, child, 300_000, headers);
		return {
			transport: new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
				requestInit: { headers },
			}),
			stop,
		};
	} catch (error) {
		await stop();
		throw error;
	}
}

/** The bearer token `--print-token` writes as the first line of stdout; the rest is drained. */
function readToken(child: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		const stdout = child.stdout;
		if (!stdout) {
			reject(new Error('The Umbel process has no stdout'));
			return;
		}
		let buffer = '';
		let found = false;
		stdout.setEncoding('utf8');
		stdout.on('data', (chunk: string) => {
			if (found) return;
			buffer += chunk;
			const end = buffer.indexOf('\n');
			if (end >= 0) {
				found = true;
				resolve(buffer.slice(0, end).trim());
			}
		});
		child.once('exit', (code) =>
			reject(new Error(`Umbel exited with code ${code} before it printed its token`))
		);
	});
}

/** Start `target` (stdio, or HTTP for Rust) with `extraEnv` added to its environment. */
async function startBackend(target: Backend, extraEnv: Record<string, string>): Promise<Started> {
	if (target === 'umbel' || target === 'umbel-mounted') {
		return startUmbel(target, extraEnv);
	}
	const env = { ...process.env, ...extraEnv, TODO_STORE_TYPE: 'memory' } as Record<string, string>;
	if (target === 'ts') {
		return {
			transport: new StdioClientTransport({
				command: 'node',
				args: [path.join(__dirname, '../backends/typescript/dist/server.js')],
				env: { ...env, PORT: '3101' },
			}),
			stop: async () => {},
		};
	}
	if (target === 'py') {
		return {
			transport: new StdioClientTransport({
				command: 'uv',
				args: ['run', '--project', path.join(__dirname, '../backends/python'), 'todo-server'],
				env,
			}),
			stop: async () => {},
		};
	}
	if (target === 'cpp') {
		// Built by `pnpm test:conformance:cpp` (CMake); speaks MCP over stdio like ts and py.
		const executable = process.platform === 'win32' ? 'todo-server-cpp.exe' : 'todo-server-cpp';
		return {
			transport: new StdioClientTransport({
				command: path.join(__dirname, '../backends/cpp/build/release', executable),
				env,
			}),
			stop: async () => {},
		};
	}
	return startRustBackend(extraEnv);
}

/** How a confirmation-suite client answers elicitations; `acknowledge` declares none. */
const CONFIRMATION_CLIENTS = ['acknowledge', 'accept', 'decline'] as const;
type ConfirmationClient = (typeof CONFIRMATION_CLIENTS)[number];

interface Session {
	client: Client;
	close(): Promise<void>;
}

async function connect(
	target: Backend,
	mode: Mode,
	extraEnv: Record<string, string>,
	answer?: Exclude<ConfirmationClient, 'acknowledge'>
): Promise<Session> {
	const { transport, stop } = await startBackend(target, extraEnv);
	const client = new Client(
		{ name: 'conformance-runner', version: '1.0.0' },
		{
			capabilities: answer ? { elicitation: { form: {} } } : {},
			versionNegotiation: {
				mode: mode === 'modern' ? { pin: '2026-07-28' } : mode,
			},
		}
	);
	if (answer) {
		client.setRequestHandler('elicitation/create', async () =>
			answer === 'accept' ? { action: 'accept', content: { confirm: true } } : { action: 'decline' }
		);
	}
	try {
		await client.connect(transport);
	} catch (error) {
		await stop();
		throw error;
	}
	console.log(
		`Connected: ${client.getProtocolEra()} era, protocol ${client.getNegotiatedProtocolVersion()}.`
	);
	return {
		client,
		async close() {
			await client.close();
			await stop();
		},
	};
}

/** Call a tool, parse its CommandResult and check the wire format. */
function toolCaller(client: Client) {
	return async (name: string, args: unknown) => {
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
	};
}

const SUITES = ['todo', 'confirmations'] as const;
type Suite = (typeof SUITES)[number];

async function run() {
	const target = option('--backend');
	const mode = option('--mode') ?? 'legacy';
	const suite = (option('--suite') ?? 'todo') as Suite;
	if (!isBackend(target) || !isMode(mode) || !SUITES.includes(suite)) {
		console.error(
			`Usage: tsx dx/run-conformance.ts --backend <${BACKENDS.join('|')}> [--mode <${MODES.join('|')}>] [--suite <${SUITES.join('|')}>]`
		);
		process.exit(1);
	}

	console.log(`Running ${suite} conformance tests against: ${target} (protocol mode: ${mode})`);
	const results: Array<{ name: string; success: boolean; error?: string }> = [];

	if (suite === 'todo') {
		const session = await connect(target, mode, {});
		try {
			results.push(
				...(await new ConformanceRunner(toolCaller(session.client)).run(
					path.join(__dirname, '../spec/test-cases.json')
				))
			);
		} finally {
			await session.close();
		}
	} else {
		// One backend per client kind: a client declares its capabilities once, so the
		// elicitation and acknowledgement paths need separate connections.
		for (const kind of CONFIRMATION_CLIENTS) {
			const session = await connect(
				target,
				mode,
				{ CONFIRMATIONS: 'enforce' },
				kind === 'acknowledge' ? undefined : kind
			);
			try {
				const runner = new ConformanceRunner(toolCaller(session.client), {
					// The reset itself is confirm-gated: acknowledge it.
					reset: (call) => call('todo-clear', { all: true, confirm: true }),
				});
				results.push(
					...(await runner.run(path.join(__dirname, '../spec/confirmation-cases.json'), {
						client: kind,
					}))
				);
			} finally {
				await session.close();
			}
		}
	}

	let passed = 0;
	for (const result of results) {
		if (result.success) {
			passed++;
			console.log(`✅ ${result.name}`);
		} else {
			console.log(`❌ ${result.name}: ${result.error}`);
		}
	}
	console.log(`\nSummary: ${passed}/${results.length} passed`);
	process.exit(passed === results.length ? 0 : 1);
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
