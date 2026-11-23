/**
 * The desktop suite's inbound helpers (phase 6 specification, 10.8): `inbound.json` read as the bridge reads it, and
 * raw HTTP to the endpoint through `node:http`, which, unlike `fetch`, sends any `Host` and `Origin` it is given.
 */
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { binary } from './harness';

export interface Connection {
	url: string;
	port: number;
	token: string;
	pid: number;
}

export interface Answer {
	status: number;
	body: string;
	headers: Record<string, string | string[] | undefined>;
}

export const connectionFile = (data: string) => join(data, 'inbound.json');

export function readConnection(data: string): Connection | undefined {
	const file = connectionFile(data);
	return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Connection) : undefined;
}

/** POSIX mode bits of `inbound.json`, or `undefined` on Windows, where the Rust units check the ACL. */
export function modeOf(data: string): number | undefined {
	return process.platform === 'win32' ? undefined : statSync(connectionFile(data)).mode & 0o777;
}

/** One HTTP exchange with the endpoint. A refused connection resolves to status 0. */
export function send(
	connection: Pick<Connection, 'port'>,
	options: {
		method?: string;
		path?: string;
		headers?: Record<string, string>;
		body?: string;
	} = {}
): Promise<Answer> {
	return new Promise((resolve) => {
		const outgoing = request(
			{
				host: '127.0.0.1',
				port: connection.port,
				method: options.method ?? 'POST',
				path: options.path ?? '/mcp',
				headers: options.headers ?? {},
				agent: false,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString('utf8'),
						headers: response.headers,
					})
				);
			}
		);
		outgoing.on('error', () => resolve({ status: 0, body: '', headers: {} }));
		if (options.body !== undefined) outgoing.write(options.body);
		outgoing.end();
	});
}

let next = 0;

/** A JSON-RPC request's body. */
export function rpc(method: string, params?: unknown): string {
	return JSON.stringify({
		jsonrpc: '2.0',
		id: ++next,
		method,
		...(params === undefined ? {} : { params }),
	});
}

/** A request with this run's token and `Content-Type`, as an MCP client sends it. */
export function call(connection: Connection, body: string, headers: Record<string, string> = {}) {
	return send(connection, {
		headers: {
			Authorization: `Bearer ${connection.token}`,
			'Content-Type': 'application/json',
			...headers,
		},
		body,
	});
}

/** `tools/call`'s `CommandResult`, from its structured content. */
export async function tool(
	connection: Connection,
	name: string,
	args: Record<string, unknown> = {},
	meta?: Record<string, unknown>
): Promise<{
	isError: boolean;
	result: { success: boolean; data?: unknown; error?: { code?: string; details?: unknown } };
}> {
	const answer = await call(
		connection,
		rpc('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) })
	);
	if (answer.status !== 200) throw new Error(`tools/call ${name}: HTTP ${answer.status}`);
	const { result } = JSON.parse(answer.body) as {
		result: { isError: boolean; structuredContent: never };
	};
	return { isError: result.isError, result: result.structuredContent };
}

/** Waits until the endpoint answers `initialize` with `200`, collecting every other status it answered on the way. */
export async function untilReady(
	connection: Connection,
	timeoutMs = 30_000
): Promise<{ seen: number[] }> {
	const seen: number[] = [];
	const until = Date.now() + timeoutMs;
	for (;;) {
		const answer = await call(connection, rpc('initialize', { protocolVersion: '2025-06-18' }));
		if (answer.status === 200) return { seen };
		seen.push(answer.status);
		if (Date.now() > until)
			throw new Error(
				`the endpoint never became ready: ${seen.length} answers, the last ${seen.at(-1)}`
			);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Waits for the app to write `inbound.json`, or fails after `timeoutMs`. */
export async function untilConnection(data: string, timeoutMs = 30_000): Promise<Connection> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const found = readConnection(data);
		if (found) return found;
		if (Date.now() > until) throw new Error('the app wrote no inbound.json');
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/** Whether a process with this id is running. */
export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/**
 * Quits the app as a person or the system does, so its exit runs: `SIGTERM` on POSIX, which the host answers as "Quit";
 * on Windows, closing the window, its last. Then waits for the process itself to end, which is after `inbound.json` is
 * gone and the single-instance lock released, and fails if it does not within `timeoutMs`.
 */
export async function quit(
	_desktop: { browser: { closeWindow(): Promise<unknown> } },
	pid: number,
	timeoutMs = 30_000
): Promise<void> {
	// Graceful close so the host runs `WindowEvent::Destroyed` / `RunEvent::Exit` and deletes `inbound.json`.
	// On Windows, `msedgedriver`'s `closeWindow()` hard-terminates the WebView2 host process; `taskkill /pid`
	// without `/f` posts `WM_CLOSE` to the window, matching a user closing it.
	if (process.platform === 'win32') {
		const root = process.env.SystemRoot ?? process.env.windir;
		if (!root) throw new Error('No SystemRoot: taskkill.exe cannot be found');
		const result = spawnSync(join(root, 'System32', 'taskkill.exe'), ['/pid', String(pid)], {
			windowsHide: true,
			encoding: 'utf8',
		});
		if (result.error) throw result.error;
		if (result.status !== 0) {
			const detail = (result.stderr || result.stdout || '').trim();
			throw new Error(`taskkill /pid ${pid} exited ${result.status}${detail ? `: ${detail}` : ''}`);
		}
	} else {
		process.kill(pid, 'SIGTERM');
	}
	const until = Date.now() + timeoutMs;
	while (alive(pid)) {
		if (Date.now() > until) throw new Error(`the app (pid ${pid}) did not exit`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/** AFD's CLI, run with Node as its `afd` bin runs. */
export const AFD = join(
	dirname(fileURLToPath(import.meta.resolve('@lushly-dev/afd-cli'))),
	'bin.js'
);

/** `loam-desktop mcp` on this run's data directory, its answers read a line at a time. */
export function bridge(data: string) {
	const child: ChildProcessWithoutNullStreams = spawn(binary(), ['mcp'], {
		env: { ...process.env, LOAM_DESKTOP_DATA_DIR: data },
	});
	const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
	let stderr = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => {
		stderr += chunk;
	});
	let id = 0;
	return {
		child,
		stderr: () => stderr,
		async request(method: string, params?: unknown): Promise<Record<string, unknown>> {
			id += 1;
			child.stdin.write(
				`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`
			);
			const next = await lines.next();
			if (next.done) throw new Error(`the bridge ended: ${stderr}`);
			return JSON.parse(next.value) as Record<string, unknown>;
		},
		notify(method: string) {
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
		},
	};
}

export async function exitCode(child: ChildProcessWithoutNullStreams): Promise<number | null> {
	child.stdin.end();
	// Ended already, by a code or a signal: `exit` has fired, and will not again.
	if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
	const [code] = (await once(child, 'exit')) as [number | null];
	return code;
}

export function run(command: string, args: string[], env: Record<string, string> = {}) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
		const child = spawn(command, args, { env: { ...process.env, ...env } });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		// `close`, not `exit`: after the pipes have drained, so no output is cut short.
		child.on('close', (code) => resolve({ code, stdout, stderr }));
	});
}
