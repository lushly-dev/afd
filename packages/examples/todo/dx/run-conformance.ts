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
async function startRustBackend(
	extraEnv: Record<string, string>
): Promise<{ transport: Transport; child: ChildProcess }> {
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
		child.kill();
		throw error;
	}
	return { transport: new StreamableHTTPClientTransport(new URL(`${base}/mcp`)), child };
}

/** Start `target` (stdio, or HTTP for Rust) with `extraEnv` added to its environment. */
async function startBackend(
	target: Backend,
	extraEnv: Record<string, string>
): Promise<{ transport: Transport; child?: ChildProcess }> {
	const env = { ...process.env, ...extraEnv, TODO_STORE_TYPE: 'memory' } as Record<string, string>;
	if (target === 'ts') {
		return {
			transport: new StdioClientTransport({
				command: 'node',
				args: [path.join(__dirname, '../backends/typescript/dist/server.js')],
				env: { ...env, PORT: '3101' },
			}),
		};
	}
	if (target === 'py') {
		return {
			transport: new StdioClientTransport({
				command: 'uv',
				args: ['run', '--project', path.join(__dirname, '../backends/python'), 'todo-server'],
				env,
			}),
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
		};
	}
	return startRustBackend(extraEnv);
}

/** How a confirmation-suite client answers elicitations; `acknowledge` declares none. */
const CONFIRMATION_CLIENTS = ['acknowledge', 'accept', 'decline'] as const;
type ConfirmationClient = (typeof CONFIRMATION_CLIENTS)[number];

interface Session {
	client: Client;
	child?: ChildProcess;
	close(): Promise<void>;
}

async function connect(
	target: Backend,
	mode: Mode,
	extraEnv: Record<string, string>,
	answer?: Exclude<ConfirmationClient, 'acknowledge'>
): Promise<Session> {
	const { transport, child } = await startBackend(target, extraEnv);
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
		child?.kill();
		throw error;
	}
	console.log(
		`Connected: ${client.getProtocolEra()} era, protocol ${client.getNegotiatedProtocolVersion()}.`
	);
	return {
		client,
		child,
		async close() {
			await client.close();
			child?.kill();
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
