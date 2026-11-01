import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/**
 * The native host binary (`host/`): `SPECIMEN_HOST_BINARY`, or the release build beside this
 * package. Packaging prebuilt hosts is publication work, not part of this source.
 */
export function hostBinaryPath(moduleUrl = import.meta.url): string {
	const configured = process.env.SPECIMEN_HOST_BINARY;
	const path = configured
		? resolve(configured)
		: fileURLToPath(new URL('../host/target/release/specimen-host', moduleUrl));
	if (!existsSync(path))
		throw new Error(
			`Specimen host is missing at ${path}; run \`cargo build --release --locked\` in foundations/specimen/host or set SPECIMEN_HOST_BINARY`
		);
	return path;
}

/** The browser runtime the host bundles: compiled beside this module, or its TypeScript source. */
export function browserRuntimePath(moduleUrl = import.meta.url): string {
	const compiled = fileURLToPath(new URL('./browser/index.js', moduleUrl));
	return existsSync(compiled) ? compiled : fileURLToPath(new URL('./browser/index.ts', moduleUrl));
}

const SHELL_DIRECTORIES: Record<string, string> = {
	'darwin-arm64': 'chrome-headless-shell-mac-arm64',
	'darwin-x64': 'chrome-headless-shell-mac-x64',
	'linux-arm64': 'chrome-headless-shell-linux-arm64',
	'linux-x64': 'chrome-headless-shell-linux64',
};

/**
 * Playwright's installed Chromium headless shell, found the way Playwright finds it
 * (`PLAYWRIGHT_BROWSERS_PATH` or its cache directory) without importing Playwright.
 */
export function chromiumExecutable(): string {
	const require = createRequire(import.meta.url);
	const playwright = dirname(require.resolve('playwright/package.json'));
	const core = dirname(
		createRequire(join(playwright, 'package.json')).resolve('playwright-core/package.json')
	);
	const browsers = JSON.parse(readFileSync(join(core, 'browsers.json'), 'utf8')) as {
		browsers: { name: string; revision: string }[];
	};
	const shell = browsers.browsers.find((browser) => browser.name === 'chromium-headless-shell');
	const directory = SHELL_DIRECTORIES[`${process.platform}-${process.arch}`];
	if (!shell || !directory)
		throw new Error(`Specimen's native host does not support ${process.platform}-${process.arch}`);
	const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
	const cache =
		process.platform === 'darwin'
			? join(homedir(), 'Library', 'Caches')
			: (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'));
	let registry = join(cache, 'ms-playwright');
	if (configured === '0') registry = join(core, '.local-browsers');
	else if (configured) registry = isAbsolute(configured) ? configured : resolve(configured);
	const executable = join(
		registry,
		`chromium_headless_shell-${shell.revision}`,
		directory,
		'chrome-headless-shell'
	);
	if (!existsSync(executable))
		throw new Error(
			`Chromium headless shell is missing at ${executable}; run \`pnpm -F @lushly-dev/specimen exec playwright install chromium\``
		);
	return executable;
}

export interface HostFailure {
	message: string;
	causes: string[];
}
type Reply = { id: number } & ({ ok: true; result: unknown } | { ok: false; error: HostFailure });

/** The host's error, with render and disposal failures kept apart as Playwright's runtime did. */
export function hostError(failure: HostFailure): Error {
	if (failure.causes.length < 2) return new Error(failure.message);
	const errors = failure.causes.map((cause) => new Error(cause));
	return new AggregateError(
		errors,
		`Specimen render and disposal failed: ${errors.map(String).join('; ')}`
	);
}

const CLOSE_TIMEOUT = 10_000;
const STDERR_LIMIT = 8_192;

/** One owned `specimen-host` process speaking its JSON-lines protocol. */
export class HostProcess {
	private readonly child: ChildProcess;
	private readonly pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void }
	>();
	private readonly exited: Promise<void>;
	private resolveExit: () => void = () => {};
	private sequence = 0;
	private failure: Error | undefined;
	private stderr = '';
	/** Set once the host acknowledged close: it has stopped Chromium itself. */
	private closedCleanly = false;
	/** Chromium's process group, reported by `open`: the last-resort cleanup handle. */
	browserGroup: number | undefined;

	constructor(binary = hostBinaryPath()) {
		const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child = child;
		this.exited = new Promise((resolveExit) => {
			this.resolveExit = resolveExit;
			child.once('exit', (code, signal) => {
				this.fail(
					new Error(
						`Specimen host exited (code ${code}, signal ${signal})${this.stderr ? `: ${this.stderr}` : ''}`
					)
				);
				// The host stops Chromium on every exit it controls; this covers one it did not.
				// After a clean close the group is gone and its id may already belong to
				// another process group, so it is left alone.
				if (this.browserGroup && !this.closedCleanly) {
					try {
						process.kill(-this.browserGroup, 'SIGKILL');
					} catch {
						// Already gone.
					}
				}
				resolveExit();
			});
		});
		child.once('error', (error) => {
			this.fail(new Error(`Specimen host failed to start: ${error.message}`, { cause: error }));
			// A process that never started emits no exit.
			if (!child.pid) this.resolveExit();
		});
		child.stdin?.on('error', () => {});
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			this.stderr = (this.stderr + chunk).slice(-STDERR_LIMIT);
		});
		if (child.stdout)
			createInterface({ input: child.stdout }).on('line', (line) => {
				let reply: Reply;
				try {
					reply = JSON.parse(line) as Reply;
				} catch {
					return;
				}
				const request = this.pending.get(reply.id);
				if (!request) return;
				this.pending.delete(reply.id);
				if (reply.ok) request.resolve(reply.result);
				else request.reject(hostError(reply.error));
			});
	}

	private fail(error: Error): void {
		this.failure ??= error;
		for (const request of this.pending.values()) request.reject(this.failure);
		this.pending.clear();
	}

	/**
	 * Send one request. Past `timeoutMs` the host is presumed stuck: every pending request
	 * fails and the host is killed, which ends Chromium too.
	 */
	request(op: string, body: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		const id = ++this.sequence;
		return new Promise((resolveReply, reject) => {
			const timer =
				timeoutMs === undefined
					? undefined
					: setTimeout(() => {
							this.fail(new Error(`Specimen host ${op} deadline exceeded after ${timeoutMs}ms`));
							this.child.kill('SIGKILL');
						}, timeoutMs);
			const settle = () => {
				if (timer) clearTimeout(timer);
			};
			this.pending.set(id, {
				resolve: (value) => {
					settle();
					resolveReply(value);
				},
				reject: (error) => {
					settle();
					reject(error);
				},
			});
			this.child.stdin?.write(`${JSON.stringify({ id, op, ...body })}\n`);
		});
	}

	/** Ask the host to finish accepted work and stop Chromium; kill it if it does not exit. */
	async close(): Promise<void> {
		if (this.child.exitCode === null && this.child.signalCode === null && !this.failure) {
			const closed = this.request('close').then(
				() => {
					this.closedCleanly = true;
				},
				() => undefined
			);
			let timer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				closed.then(() => this.exited),
				new Promise<void>((resolveTimeout) => {
					timer = setTimeout(resolveTimeout, CLOSE_TIMEOUT);
				}),
			]);
			if (timer) clearTimeout(timer);
		}
		this.child.stdin?.end();
		if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
		await this.exited;
	}
}
