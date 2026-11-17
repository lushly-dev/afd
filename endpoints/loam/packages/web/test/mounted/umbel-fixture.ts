/**
 * The stock `umbel` binary on a real workspace, with Umbel's own hello plugin in its mounted build (phase 1
 * specification, 7.2). Nothing here is Umbel's code or changes it: Loam is one more MCP client, under
 * Umbel D32's loopback and token rules.
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { access, chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UMBEL = resolve(fileURLToPath(new URL('../../../../../umbel', import.meta.url)));
const HELLO = join(UMBEL, 'plugins/hello');

/** `$LOAM_UMBEL_TARGET_DIR`, else `$CARGO_TARGET_DIR`, else Umbel's own `target`. */
function targetDirectory(): string {
	return resolve(
		UMBEL,
		process.env.LOAM_UMBEL_TARGET_DIR || process.env.CARGO_TARGET_DIR || 'target'
	);
}

/** A built binary; Windows names it with `.exe`. */
export const binary = (name: 'umbel' | 'hello-mcp'): string =>
	join(targetDirectory(), 'debug', process.platform === 'win32' ? `${name}.exe` : name);

/** A missing binary says how to build it. */
async function requireBinaries(): Promise<void> {
	for (const name of ['umbel', 'hello-mcp'] as const) {
		try {
			await access(binary(name));
		} catch {
			throw new Error(
				`${binary(name)} is not built. Run \`pnpm -F @lushly-dev/loam-web build:umbel\`, with the same CARGO_TARGET_DIR.`
			);
		}
	}
}

const run = (file: string, args: string[]): Promise<void> =>
	new Promise((done, fail) => {
		execFile(file, args, (error) => (error ? fail(error) : done()));
	});

/** `umbel init`, then `plugins/hello` as Umbel's own tests lay it out (`tests/support/mounted.rs`). */
export async function createUmbelWorkspace(directory: string): Promise<void> {
	await requireBinaries();
	await run(binary('umbel'), ['init', directory]);
	const plugin = join(directory, 'plugins/hello');
	await mkdir(join(plugin, 'bin'), { recursive: true });
	await cp(join(HELLO, 'manifests/mounted.toml'), join(plugin, 'umbel-plugin.toml'));
	await cp(binary('hello-mcp'), join(plugin, 'bin/hello-mcp'));
	await chmod(join(plugin, 'bin/hello-mcp'), 0o755);
	await cp(join(HELLO, 'packs'), join(plugin, 'packs'), { recursive: true });
	await cp(join(HELLO, 'skills'), join(plugin, 'skills'), { recursive: true });
	const config = join(directory, 'umbel.toml');
	await writeFile(config, `${await readFile(config, 'utf8')}\n[plugins]\nenabled = ["hello"]\n`);
}

export interface UmbelInstance {
	url: string;
	port: number;
	/** `<dir>/state/keys/http.token`. */
	tokenFile: string;
	token(): Promise<string>;
	stop(): Promise<void>;
	/** Stopped and started again on the same port, with the same workspace and token. */
	restart(): Promise<void>;
}

const LISTENING = /umbel listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/;
const STARTUP_MS = 30_000;
const STOP_MS = 5_000;

export function startProcess(
	directory: string,
	bind: string
): Promise<{ child: ChildProcess; port: number }> {
	return new Promise((done, fail) => {
		const child = spawn(binary('umbel'), [
			'--workspace',
			directory,
			'serve',
			'--http',
			'--bind',
			bind,
		]);
		let stderr = '';
		const cleanup = () => {
			clearTimeout(timer);
			child.removeListener('error', onError);
			child.removeListener('exit', onExit);
			child.stderr?.removeListener('data', onData);
		};
		const onError = (error: Error) => {
			cleanup();
			fail(error);
		};
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			cleanup();
			fail(new Error(`umbel exited with ${signal ?? code}: ${stderr}`));
		};
		const onData = (chunk: string) => {
			stderr += chunk;
			const port = LISTENING.exec(stderr)?.[1];
			if (port) {
				cleanup();
				done({ child, port: Number(port) });
			}
			stderr = stderr.slice(-400);
		};
		const timer = setTimeout(() => {
			cleanup();
			const error = new Error(`umbel did not start in ${STARTUP_MS} ms: ${stderr}`);
			void stopProcess(child).then(
				() => fail(error),
				(stopError) => fail(new AggregateError([error, stopError], error.message))
			);
		}, STARTUP_MS);
		child.stdout?.resume();
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', onData);
		child.once('error', onError);
		child.once('exit', onExit);
	});
}

/** Wait for exit, escalating SIGTERM to SIGKILL, with a bound on both waits. */
export function stopProcess(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((done, fail) => {
		const cleanup = () => {
			clearTimeout(timer);
			child.removeListener('exit', onExit);
			child.removeListener('error', onError);
		};
		const onExit = () => {
			cleanup();
			done();
		};
		const onError = (error: Error) => {
			cleanup();
			fail(error);
		};
		let timer = setTimeout(() => {
			timer = setTimeout(() => {
				cleanup();
				fail(new Error(`umbel did not exit within ${STOP_MS} ms of SIGKILL`));
			}, STOP_MS);
			child.kill('SIGKILL');
		}, STOP_MS);
		child.once('exit', onExit);
		child.once('error', onError);
		child.kill('SIGTERM');
	});
}

/** `umbel --workspace <dir> serve --http --bind 127.0.0.1:0`. */
export async function startUmbel(directory: string): Promise<UmbelInstance> {
	let { child, port } = await startProcess(directory, '127.0.0.1:0');
	const tokenFile = join(directory, 'state/keys/http.token');
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		port,
		tokenFile,
		token: async () => (await readFile(tokenFile, 'utf8')).trim(),
		stop: () => stopProcess(child),
		async restart() {
			await stopProcess(child);
			({ child, port } = await startProcess(directory, `127.0.0.1:${port}`));
		},
	};
}
