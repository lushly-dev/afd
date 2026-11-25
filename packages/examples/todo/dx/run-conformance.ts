import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
import {
	ConformanceRunner,
	selectCases,
	TOOL_LIST,
	toolListView,
	wireProblems,
	wireSchemaForTool,
} from './conformance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKENDS = ['ts', 'py', 'rs', 'cpp', 'umbel', 'umbel-mounted'] as const;
type Backend = (typeof BACKENDS)[number];

/** Each backend's language, as `implementedBy` names it; the Umbel todo plugin is the Rust backend. */
const LANGUAGE: Record<Backend, string> = {
	ts: 'typescript',
	py: 'python',
	rs: 'rust',
	cpp: 'cpp',
	umbel: 'rust',
	'umbel-mounted': 'rust',
};

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

/**
 * Start the Rust backend's HTTP server on a free port and wait until it is healthy. Umbel's
 * mounted mode reaches the backend this way; the Rust conformance runs use stdio.
 */
async function spawnRustServer(
	extraEnv: Record<string, string>
): Promise<{ base: string; child: ChildProcess }> {
	const port = await freePort();
	const child = spawn(rustBinary(), ['server'], {
		env: { ...process.env, ...extraEnv, HOST: '127.0.0.1', PORT: String(port) },
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	const base = `http://127.0.0.1:${port}`;
	try {
		await waitForHealth(`${base}/health`, child, 60_000);
	} catch (error) {
		await kill(child);
		throw error;
	}
	return { base, child };
}

/**
 * The Rust backend's binary, which the package scripts build first (`cargo build`), in the
 * target directory cargo uses: `CARGO_TARGET_DIR`, else the backend's own `target`. Spawning it
 * directly, as for C++, keeps each session from waiting on cargo's build lock.
 */
function rustBinary(): string {
	const target = process.env.CARGO_TARGET_DIR ?? path.join(__dirname, '../backends/rust/target');
	const name = process.platform === 'win32' ? 'todo-backend-rust.exe' : 'todo-backend-rust';
	return path.join(path.resolve(target), 'debug', name);
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
	mode: Mode,
	extraEnv: Record<string, string>
): Promise<Started> {
	const confirmations = extraEnv.CONFIRMATIONS === 'enforce' ? 'enforce' : 'off';
	const approvals = extraEnv.APPROVALS === 'agents' ? 'mcp-elicitation' : 'off';
	// MCP 2025 form elicitation needs a stateful back channel (stdio); MCP 2026-07-28 carries
	// elicitations statelessly over Streamable HTTP.
	const useStdio = extraEnv.APPROVALS === 'agents' && mode !== 'modern';
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
			// The mount renames tools one by one, so the backend lists one tool per command. Umbel
			// enforces todo-clear's approval policy itself (todo-http/umbel-plugin.toml), so the
			// mounted backend's own approval hold is off.
			const backend = await spawnRustServer({ TOOL_STRATEGY: 'individual', APPROVALS: 'off' });
			cleanups.push(() => kill(backend.child));
			await mkdir(path.join(workspace, 'plugins'));
			await cp(MOUNT_FIXTURE, path.join(workspace, 'plugins/todo'), { recursive: true });
			plugin = `\n[plugins.todo]\nsource = "plugins/todo"\nurl = "${backend.base}/mcp"\nrequired = true\n`;
		}
		await writeFile(
			path.join(workspace, 'umbel.toml'),
			`config_version = 7\n\n[plugins]\nenabled = ["todo"]\n${plugin}\n[mcp]\nconfirmations = "${confirmations}"\napprovals = "${approvals}"\n\n[http]\nbind = "127.0.0.1:${port}"\n`
		);
		const bin = umbelBinary(target === 'umbel' ? 'umbel-todo' : 'umbel');
		if (useStdio) {
			return {
				transport: new StdioClientTransport({
					command: bin,
					args: ['--workspace', workspace, 'serve', '--stdio'],
					env: process.env as Record<string, string>,
				}),
				stop,
			};
		}
		const child = spawn(bin, ['--workspace', workspace, 'serve', '--http', '--print-token'], {
			env: process.env,
			stdio: ['ignore', 'pipe', 'inherit'],
		});
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

/** Start `target` (stdio, or HTTP for Umbel) with `extraEnv` added to its environment. */
async function startBackend(
	target: Backend,
	mode: Mode,
	extraEnv: Record<string, string>
): Promise<Started> {
	if (target === 'umbel' || target === 'umbel-mounted') {
		return startUmbel(target, mode, extraEnv);
	}
	// The todo and confirmation suites reset with a clear, which an agent's approval hold would
	// stop, so they run with APPROVALS=off, as they set CONFIRMATIONS; the approvals suite turns
	// it on.
	const env = {
		...process.env,
		APPROVALS: 'off',
		...extraEnv,
		TODO_STORE_TYPE: 'memory',
	} as Record<string, string>;
	if (target === 'ts') {
		const serverScript =
			option('--server-script') ?? path.join(__dirname, '../backends/typescript/dist/server.js');
		return {
			transport: new StdioClientTransport({
				command: 'node',
				args: [serverScript],
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
	if (target === 'rs') {
		// Built by `pnpm test:conformance:rs`.
		return {
			transport: new StdioClientTransport({ command: rustBinary(), args: ['stdio'], env }),
			stop: async () => {},
		};
	}
	if (target === 'cpp') {
		// Built by `pnpm test:conformance:cpp` (CMake); speaks MCP over stdio like ts and py.
		const executable = process.platform === 'win32' ? 'todo-server-cpp.exe' : 'todo-server-cpp';
		// A multi-config generator (Visual Studio, Xcode) puts the Release build in a `Release` folder.
		const build = path.join(__dirname, '../backends/cpp/build/release');
		const single = path.join(build, executable);
		return {
			transport: new StdioClientTransport({
				command: existsSync(single) ? single : path.join(build, 'Release', executable),
				env,
			}),
			stop: async () => {},
		};
	}
	throw new Error(`Unknown backend: ${target}`);
}

/** How a confirmation-suite client answers elicitations; `acknowledge` declares none. */
const CONFIRMATION_CLIENTS = ['acknowledge', 'accept', 'decline'] as const;
type ConfirmationClient = (typeof CONFIRMATION_CLIENTS)[number];

const TASK_CLIENTS = ['tasks', 'no-tasks'] as const;
const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
const TASK_SENTINEL = '__afd_conformance_task__';
const PASS_THROUGH_SCHEMA = {
	'~standard': {
		version: 1,
		vendor: 'afd-conformance',
		validate: (value: unknown) => ({ value }),
	},
} as const;

interface Session {
	client: Client;
	interceptedTasks: Map<string, Record<string, unknown>>;
	close(): Promise<void>;
}

async function connect(
	target: Backend,
	mode: Mode,
	extraEnv: Record<string, string>,
	options: {
		answer?: Exclude<ConfirmationClient, 'acknowledge'>;
		tasks?: boolean;
	} = {}
): Promise<Session> {
	const { answer, tasks } = options;
	const { transport, stop } = await startBackend(target, mode, extraEnv);
	const capabilities: Record<string, unknown> = {};
	if (answer) capabilities.elicitation = { form: {} };
	if (tasks) capabilities.extensions = { [TASKS_EXTENSION_ID]: {} };
	const client = new Client(
		{ name: 'conformance-runner', version: '1.0.0' },
		{
			capabilities: capabilities as never,
			versionNegotiation: {
				mode: mode === 'modern' ? { pin: '2026-07-28' } : mode,
			},
		}
	);
	if (answer) {
		// Accept says yes to whatever is asked: each boolean field of the form (a confirmation's
		// `confirm`, an approval's `approve`) is answered true.
		client.setRequestHandler('elicitation/create', async (request) => {
			if (answer === 'decline') return { action: 'decline' };
			const schema = (request.params as { requestedSchema?: { properties?: object } })
				.requestedSchema;
			const fields = Object.entries(schema?.properties ?? {}).filter(
				([, field]) => (field as { type?: string }).type === 'boolean'
			);
			return {
				action: 'accept',
				content: Object.fromEntries(fields.map(([name]) => [name, true])),
			};
		});
	}
	try {
		await client.connect(transport);
	} catch (error) {
		await stop();
		throw error;
	}
	const interceptedTasks = new Map<string, Record<string, unknown>>();
	if (tasks) {
		let seq = 0;
		const deliver = transport.onmessage;
		transport.onmessage = (message) => {
			const msg = message as { id?: string | number; result?: Record<string, unknown> };
			if (
				msg &&
				typeof msg === 'object' &&
				'result' in msg &&
				msg.result &&
				typeof msg.result === 'object' &&
				msg.result.resultType === 'task'
			) {
				const token = String(++seq);
				interceptedTasks.set(token, msg.result);
				deliver?.({
					jsonrpc: '2.0',
					id: msg.id as string | number,
					result: {
						resultType: 'complete',
						content: [],
						_meta: { [TASK_SENTINEL]: token },
					},
				} as never);
				return;
			}
			deliver?.(message);
		};
	}
	console.log(
		`Connected: ${client.getProtocolEra()} era, protocol ${client.getNegotiatedProtocolVersion()}.`
	);
	return {
		client,
		interceptedTasks,
		async close() {
			await client.close();
			await stop();
		},
	};
}

/** Call a tool, parse its result and check the wire format and contract JSON Schema. */
function toolCaller(
	session: Session,
	taskWire?: { expectTaskFor?: ReadonlySet<string>; taskIds: string[] }
) {
	const { client, interceptedTasks } = session;
	return async (name: string, args: unknown, meta?: Record<string, unknown>) => {
		if (name === TOOL_LIST) {
			console.log('Listing tools');
			const listed = await client.listTools();
			return {
				success: true,
				data: toolListView(listed.tools as Parameters<typeof toolListView>[0]),
			};
		}
		console.log(`Calling tool: ${name}`, args);
		const raw = (await client.callTool({
			name,
			arguments: args as Record<string, unknown>,
			...(meta ? { _meta: meta } : {}),
		})) as {
			content: Array<{ text: string }>;
			isError?: boolean;
			_meta?: Record<string, unknown>;
		};
		const taskToken = raw._meta?.[TASK_SENTINEL];
		const startedAsTask = typeof taskToken === 'string';
		const shouldBeTask = taskWire?.expectTaskFor?.has(name) === true;
		if (taskWire) {
			if (shouldBeTask && !startedAsTask) {
				throw new Error(
					`Expected '${name}' to start an MCP task (resultType: 'task'), but it ran inline`
				);
			}
			if (!shouldBeTask && startedAsTask) {
				throw new Error(`Expected '${name}' to run inline, but it started an MCP task`);
			}
		}

		let result: { content: Array<{ text: string }>; isError?: boolean } = raw;
		if (startedAsTask) {
			const seed = interceptedTasks.get(taskToken);
			interceptedTasks.delete(taskToken);
			if (!seed || typeof seed.taskId !== 'string' || !/^[a-z2-7]{26}$/.test(seed.taskId)) {
				throw new Error(`Invalid task seed from '${name}': ${JSON.stringify(seed)}`);
			}
			if (seed.status !== 'working' || typeof seed.ttlMs !== 'number' || seed.ttlMs <= 0) {
				throw new Error(`Unexpected task seed fields from '${name}': ${JSON.stringify(seed)}`);
			}
			taskWire?.taskIds.push(seed.taskId);
			const deadline = Date.now() + 10_000;
			let settled: Record<string, unknown> | undefined;
			while (Date.now() < deadline) {
				const got = (await client.request(
					{ method: 'tasks/get', params: { taskId: seed.taskId } },
					PASS_THROUGH_SCHEMA as never
				)) as Record<string, unknown>;
				if (got.status !== 'working') {
					settled = got;
					break;
				}
				await new Promise((r) => setTimeout(r, 15));
			}
			if (settled?.status !== 'completed' || !settled.result) {
				throw new Error(
					`Task ${seed.taskId} for '${name}' did not reach status 'completed': ${JSON.stringify(settled)}`
				);
			}
			result = settled.result as { content: Array<{ text: string }>; isError?: boolean };
		}

		const text = result.content[0]?.text;
		let parsed: unknown;
		try {
			parsed = text ? JSON.parse(text) : result;
		} catch (e) {
			console.error(`Failed to parse JSON from tool ${name}. Raw text:`, text);
			throw e;
		}
		const problems = wireProblems(parsed, result.isError === true, wireSchemaForTool(name));
		if (problems.length > 0) {
			throw new Error(`${name} broke the wire format (spec/wire): ${problems.join('; ')}`);
		}
		return parsed as { success?: boolean; data?: unknown; error?: { message: string } };
	};
}

const SUITES = ['todo', 'protocol', 'confirmations', 'approvals', 'tasks'] as const;

/** Empty the live list without a clear, which the approvals suite's agent cannot run unasked. */
async function resetByDeleting(
	call: (name: string, args: unknown) => Promise<{ success?: boolean; data?: unknown }>
): Promise<{ success?: boolean; error?: { message: string } }> {
	const listed = await call('todo-list', { limit: 100 });
	const ids = ((listed.data as { todos?: { id: string }[] } | undefined)?.todos ?? []).map(
		(todo) => todo.id
	);
	if (ids.length === 0) return listed;
	return call('todo-delete-batch', { ids });
}
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
				...(await new ConformanceRunner(toolCaller(session)).run(
					path.join(__dirname, '../spec/test-cases.json'),
					{ language: LANGUAGE[target], backend: target }
				))
			);
		} finally {
			await session.close();
		}
	} else if (suite === 'protocol') {
		const session = await connect(target, mode, { PROTOCOL_CONFORMANCE: '1' });
		const era =
			session.client.getNegotiatedProtocolVersion() === '2026-07-28' ? 'modern' : 'legacy';
		try {
			results.push(
				...(await new ConformanceRunner(toolCaller(session)).run(
					path.join(__dirname, '../../../../spec/protocol-conformance.json'),
					{ era, language: LANGUAGE[target], backend: target }
				))
			);
		} finally {
			await session.close();
		}
	} else if (suite === 'tasks') {
		if (mode !== 'modern') {
			throw new Error('The tasks suite requires --mode modern (MCP 2026-07-28)');
		}
		const specPath = path.join(__dirname, '../spec/task-cases.json');
		for (const kind of TASK_CLIENTS) {
			const filter = { client: kind, language: LANGUAGE[target], backend: target };
			if ((await selectCases(specPath, filter)).length === 0) {
				console.log(
					`Skipping the ${kind} client: no case in ${suite} is for ${filter.language} yet`
				);
				continue;
			}
			const isTasksClient = kind === 'tasks';
			const session = await connect(target, mode, {}, { tasks: isTasksClient });
			try {
				const taskWire = {
					expectTaskFor: isTasksClient ? new Set(['todo-create-batch']) : new Set<string>(),
					taskIds: [] as string[],
				};
				if (isTasksClient) {
					const serverCaps = session.client.getServerCapabilities() as {
						extensions?: Record<string, unknown>;
					};
					if (!serverCaps.extensions || !(TASKS_EXTENSION_ID in serverCaps.extensions)) {
						results.push({
							name: 'Server advertises io.modelcontextprotocol/tasks capability',
							success: false,
							error: `Missing ${TASKS_EXTENSION_ID} in server/discover capabilities: ${JSON.stringify(serverCaps)}`,
						});
					} else {
						results.push({
							name: 'Server advertises io.modelcontextprotocol/tasks capability',
							success: true,
						});
					}
				}
				const runner = new ConformanceRunner(toolCaller(session, taskWire));
				results.push(...(await runner.run(specPath, filter)));
				if (isTasksClient) {
					const lastId = taskWire.taskIds.at(-1);
					if (lastId) {
						try {
							await session.client.request(
								{ method: 'tasks/update', params: { taskId: lastId, inputResponses: {} } },
								PASS_THROUGH_SCHEMA as never
							);
							await session.client.request(
								{ method: 'tasks/cancel', params: { taskId: lastId } },
								PASS_THROUGH_SCHEMA as never
							);
							results.push({
								name: 'tasks/update and tasks/cancel acknowledge a completed task',
								success: true,
							});
						} catch (error) {
							results.push({
								name: 'tasks/update and tasks/cancel acknowledge a completed task',
								success: false,
								error: error instanceof Error ? error.message : String(error),
							});
						}
					}
					try {
						await session.client.request(
							{ method: 'tasks/get', params: { taskId: 'a'.repeat(26) } },
							PASS_THROUGH_SCHEMA as never
						);
						results.push({
							name: 'tasks/get on unknown taskId returns -32602',
							success: false,
							error: 'Expected -32602 error, got success',
						});
					} catch (error) {
						const code = (error as { code?: number }).code;
						results.push(
							code === -32602
								? { name: 'tasks/get on unknown taskId returns -32602', success: true }
								: {
										name: 'tasks/get on unknown taskId returns -32602',
										success: false,
										error: `Expected code -32602, got ${String(code)}: ${String(error)}`,
									}
						);
					}
				}
			} finally {
				await session.close();
			}
		}
		if (target === 'ts' || target === 'py' || target === 'rs') {
			// Verify post-completion retention and execution run budget across TS, Python, and Rust
			// (spec/command-metadata.md, "Tasks").
			const maxRunMs = 900;
			const retentionMs = 1200;
			const delayMs = 300;
			const session = await connect(
				target,
				mode,
				{
					TASK_CONFORMANCE: '1',
					TASK_MAX_RUN_MS: String(maxRunMs),
					TASK_RETENTION_MS: String(retentionMs),
					TASK_POLL_INTERVAL_MS: '50',
					TASK_CHECK_INTERVAL_MS: '25',
				},
				{ tasks: true }
			);
			try {
				const startSlow = async (ms: number) => {
					const raw = (await session.client.callTool({
						name: 'todo-slow-task',
						arguments: { delayMs: ms },
					})) as { _meta?: Record<string, unknown> };
					const token = raw._meta?.[TASK_SENTINEL];
					if (typeof token !== 'string') {
						throw new Error('Expected todo-slow-task to start an MCP task');
					}
					const seed = session.interceptedTasks.get(token);
					session.interceptedTasks.delete(token);
					if (!seed || typeof seed.taskId !== 'string') {
						throw new Error(`Invalid task seed: ${JSON.stringify(seed)}`);
					}
					return seed;
				};
				const pollSettled = async (taskId: string) => {
					const deadline = Date.now() + 10_000;
					while (Date.now() < deadline) {
						const got = (await session.client.request(
							{ method: 'tasks/get', params: { taskId } },
							PASS_THROUGH_SCHEMA as never
						)) as Record<string, unknown>;
						if (got.status !== 'working') return got;
						await new Promise((r) => setTimeout(r, 25));
					}
					throw new Error(`Task ${taskId} did not settle in time`);
				};

				// 1. Task finishing within maxRunMs stays readable past maxRunMs until finishedAt + retentionMs.
				try {
					const startedWall = Date.now();
					const seed = await startSlow(delayMs);
					if (seed.ttlMs !== maxRunMs + retentionMs) {
						throw new Error(
							`Expected initial ttlMs=${maxRunMs + retentionMs}, got ${String(seed.ttlMs)}`
						);
					}
					const settled = await pollSettled(String(seed.taskId));
					if (settled.status !== 'completed') {
						throw new Error(`Expected completed, got ${JSON.stringify(settled)}`);
					}
					const settledRes = settled.result as {
						isError?: boolean;
						content?: Array<{ text?: string }>;
					};
					const settledBody = JSON.parse(settledRes?.content?.[0]?.text ?? '{}') as {
						success?: boolean;
						data?: { delayedMs?: number };
					};
					if (
						settledRes?.isError === true ||
						settledBody.success !== true ||
						settledBody.data?.delayedMs !== delayMs
					) {
						throw new Error(
							`Expected successful todo-slow-task result { delayedMs: ${delayMs} }, got ${JSON.stringify(settled)}`
						);
					}
					const createdAtMs = Date.parse(String(settled.createdAt));
					const finishedAtMs = Date.parse(String(settled.lastUpdatedAt));
					const expectedTtlMs =
						Math.min(maxRunMs, Math.max(0, finishedAtMs - createdAtMs)) + retentionMs;
					if (
						!Number.isFinite(createdAtMs) ||
						!Number.isFinite(finishedAtMs) ||
						settled.ttlMs !== expectedTtlMs
					) {
						throw new Error(
							`Expected exact tightened ttlMs=${expectedTtlMs} from server timestamps, got ${String(settled.ttlMs)}`
						);
					}
					// Wait past original maxRunMs (still well inside retentionMs after finish).
					const pastRunBudget = startedWall + maxRunMs + 150 - Date.now();
					if (pastRunBudget > 0) await new Promise((r) => setTimeout(r, pastRunBudget));
					const stillReadable = (await session.client.request(
						{ method: 'tasks/get', params: { taskId: String(seed.taskId) } },
						PASS_THROUGH_SCHEMA as never
					)) as Record<string, unknown>;
					if (stillReadable.status !== 'completed') {
						throw new Error(
							`Expected completed past maxRunMs, got ${JSON.stringify(stillReadable)}`
						);
					}
					// Wait past server's createdAt + settled.ttlMs and confirm -32602.
					const pastRetention = createdAtMs + expectedTtlMs + 200 - Date.now();
					if (pastRetention > 0) await new Promise((r) => setTimeout(r, pastRetention));
					let expiredCode: number | undefined;
					try {
						await session.client.request(
							{ method: 'tasks/get', params: { taskId: String(seed.taskId) } },
							PASS_THROUGH_SCHEMA as never
						);
					} catch (error) {
						expiredCode = (error as { code?: number }).code;
					}
					if (expiredCode !== -32602) {
						throw new Error(`Expected -32602 after retention elapsed, got ${String(expiredCode)}`);
					}
					results.push({
						name: 'Finished task stays readable past maxRunMs and expires after post-completion retention',
						success: true,
					});
				} catch (error) {
					results.push({
						name: 'Finished task stays readable past maxRunMs and expires after post-completion retention',
						success: false,
						error: error instanceof Error ? error.message : String(error),
					});
				}

				// 2. Working task exceeding maxRunMs stops with TIMEOUT and retains that result without widening ttlMs.
				try {
					const seed = await startSlow(3_000);
					const settled = await pollSettled(String(seed.taskId));
					if (settled.status !== 'completed') {
						throw new Error(`Expected completed TIMEOUT, got ${JSON.stringify(settled)}`);
					}
					if (
						typeof settled.ttlMs !== 'number' ||
						settled.ttlMs < retentionMs ||
						settled.ttlMs > maxRunMs + retentionMs
					) {
						throw new Error(
							`Expected TIMEOUT ttlMs in [${retentionMs}, ${maxRunMs + retentionMs}], got ${String(settled.ttlMs)}`
						);
					}
					const toolRes = settled.result as {
						isError?: boolean;
						content?: Array<{ text?: string }>;
					};
					const body = JSON.parse(toolRes?.content?.[0]?.text ?? '{}') as {
						error?: { code?: string; retryable?: boolean };
					};
					if (
						toolRes?.isError !== true ||
						body.error?.code !== 'TIMEOUT' ||
						body.error?.retryable !== true
					) {
						throw new Error(`Unexpected TIMEOUT payload: ${JSON.stringify(settled)}`);
					}
					await new Promise((r) => setTimeout(r, 200));
					const retained = (await session.client.request(
						{ method: 'tasks/get', params: { taskId: String(seed.taskId) } },
						PASS_THROUGH_SCHEMA as never
					)) as Record<string, unknown>;
					if (retained.status !== 'completed') {
						throw new Error(`Expected TIMEOUT result retained, got ${JSON.stringify(retained)}`);
					}
					results.push({
						name: 'Working task exceeding maxRunMs stops with TIMEOUT and retains its result',
						success: true,
					});
				} catch (error) {
					results.push({
						name: 'Working task exceeding maxRunMs stops with TIMEOUT and retains its result',
						success: false,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} finally {
				await session.close();
			}
		}
		if (results.length === 0) {
			throw new Error(
				`No case in ${specPath} is for ${LANGUAGE[target]}: this backend does not implement the suite yet`
			);
		}
	} else {
		// One backend per client kind: a client declares its capabilities once, so the
		// elicitation and acknowledgement paths need separate connections.
		const approvals = suite === 'approvals';
		const specPath = path.join(
			__dirname,
			approvals ? '../spec/approval-cases.json' : '../spec/confirmation-cases.json'
		);
		for (const kind of CONFIRMATION_CLIENTS) {
			// A client kind whose cases this language does not implement yet is skipped, and said
			// so; the suite still fails when it leaves the language no case at all.
			const filter = { client: kind, language: LANGUAGE[target], backend: target };
			if ((await selectCases(specPath, filter)).length === 0) {
				console.log(
					`Skipping the ${kind} client: no case in ${suite} is for ${filter.language} yet`
				);
				continue;
			}
			const session = await connect(
				target,
				mode,
				approvals ? { APPROVALS: 'agents' } : { CONFIRMATIONS: 'enforce' },
				{ answer: kind === 'acknowledge' ? undefined : kind }
			);
			try {
				const runner = new ConformanceRunner(toolCaller(session), {
					reset: approvals
						? // A clear is held for an agent, so empty the live list with a batch delete
							resetByDeleting
						: // The reset itself is confirm-gated: acknowledge it.
							(call) => call('todo-clear', { all: true, confirm: true }),
				});
				results.push(...(await runner.run(specPath, filter)));
			} finally {
				await session.close();
			}
		}
		if (results.length === 0) {
			throw new Error(
				`No case in ${specPath} is for ${LANGUAGE[target]}: this backend does not implement the suite yet`
			);
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
