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
	return process.env.LOAM_UMBEL_TARGET_DIR ?? process.env.CARGO_TARGET_DIR ?? join(UMBEL, 'target');
}

export const binary = (name: 'umbel' | 'hello-mcp'): string =>
	join(targetDirectory(), 'debug', name);

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

function startProcess(
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
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			fail(new Error(`umbel did not start in ${STARTUP_MS} ms: ${stderr.slice(-400)}`));
		}, STARTUP_MS);
		child.stdout?.resume();
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk;
			const port = LISTENING.exec(stderr)?.[1];
			if (port) {
				clearTimeout(timer);
				done({ child, port: Number(port) });
			}
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			fail(new Error(`umbel exited with ${code}: ${stderr.slice(-400)}`));
		});
	});
}

/** SIGTERM, and wait until it has really gone. */
function stopProcess(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((done) => {
		child.once('exit', () => done());
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
