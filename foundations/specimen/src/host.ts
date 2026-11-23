import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** The systems and architectures with a prebuilt host; Linux builds link glibc. */
const HOST_PLATFORMS = new Set([
	'darwin-arm64',
	'darwin-x64',
	'linux-arm64',
	'linux-x64',
	'win32-x64',
]);

/** The host binary's file name on a system: Windows executables carry `.exe`. */
export function hostBinaryName(platform: string = process.platform): string {
	return platform === 'win32' ? 'specimen-host.exe' : 'specimen-host';
}

/**
 * The prebuilt host package for a system and architecture, or undefined where none is built.
 * Linux hosts link glibc, as Playwright's headless shell does.
 */
export function hostPackageName(
	platform: string = process.platform,
	arch: string = process.arch
): string | undefined {
	const key = `${platform}-${arch}`;
	if (!HOST_PLATFORMS.has(key)) return undefined;
	return `@lushly-dev/specimen-host-${key}${platform === 'linux' ? '-gnu' : ''}`;
}

/**
 * The native host binary: `SPECIMEN_HOST_BINARY`; in a source checkout, the release build in
 * `host/`; otherwise the prebuilt platform package `@lushly-dev/specimen` installs as an
 * optional dependency. A fresh source build is preferred over a staged package.
 */
export function hostBinaryPath(moduleUrl = import.meta.url): string {
	const configured = process.env.SPECIMEN_HOST_BINARY;
	if (configured) {
		const path = resolve(configured);
		if (!existsSync(path))
			throw new Error(`Specimen host is missing at ${path}, where SPECIMEN_HOST_BINARY points`);
		return path;
	}
	const built = fileURLToPath(new URL(`../host/target/release/${hostBinaryName()}`, moduleUrl));
	if (existsSync(built)) return built;
	const name = hostPackageName();
	if (!name)
		throw new Error(
			`Specimen has no prebuilt host for ${process.platform}-${process.arch}; build foundations/specimen/host with \`cargo build --release --locked\` and set SPECIMEN_HOST_BINARY`
		);
	let manifest: string;
	try {
		manifest = createRequire(moduleUrl).resolve(`${name}/package.json`);
	} catch {
		const report = process.platform === 'linux' ? process.report?.getReport() : undefined;
		const glibc = (report as { header?: { glibcVersionRuntime?: string } } | undefined)?.header
			?.glibcVersionRuntime;
		throw new Error(
			report && !glibc
				? `Specimen's prebuilt Linux hosts need glibc; build foundations/specimen/host with \`cargo build --release --locked\` and set SPECIMEN_HOST_BINARY`
				: `Specimen's host package ${name} is not installed; reinstall without omitting optional dependencies, or set SPECIMEN_HOST_BINARY`
		);
	}
	const path = join(dirname(manifest), 'bin', hostBinaryName());
	if (!existsSync(path))
		throw new Error(
			`${name} has no host binary at ${path}; in a source checkout, run \`pnpm -F @lushly-dev/specimen build:host\``
		);
	return path;
}

/** The browser runtime the host bundles: compiled beside this module, or its TypeScript source. */
export function browserRuntimePath(moduleUrl = import.meta.url): string {
	const compiled = fileURLToPath(new URL('./browser/index.js', moduleUrl));
	return existsSync(compiled) ? compiled : fileURLToPath(new URL('./browser/index.ts', moduleUrl));
}

/**
 * The Playwright release Specimen is built against, pinned exactly in its manifest. The host
 * mirrors this release's headless Chromium switches, and the bench reads its browser registry
 * (`playwright-core/browsers.json`) to find the shell, so another release could launch a
 * browser build the host was never checked against.
 */
export const PLAYWRIGHT_VERSION = '1.64.1';

/** Throw unless `name`, found at `directory`, is the pinned Playwright release. */
export function checkPlaywrightVersion(name: string, version: string, directory: string): void {
	if (version === PLAYWRIGHT_VERSION) return;
	const suggestion = `Install ${name}@${PLAYWRIGHT_VERSION}, or remove the override or resolution that replaces the version Specimen pins`;
	const error: SpecimenHostError = new Error(
		`Specimen needs ${name} ${PLAYWRIGHT_VERSION}, the release whose Chromium build and launch switches it mirrors, but ${name} ${version} is installed at ${directory}. ${suggestion}.`
	);
	error.code = 'PLAYWRIGHT_VERSION_MISMATCH';
	error.suggestion = suggestion;
	error.details = { package: name, expected: PLAYWRIGHT_VERSION, found: version, directory };
	throw error;
}

const SHELL_DIRECTORIES: Record<string, string> = {
	'darwin-arm64': 'chrome-headless-shell-mac-arm64',
	'darwin-x64': 'chrome-headless-shell-mac-x64',
	'linux-arm64': 'chrome-headless-shell-linux-arm64',
	'linux-x64': 'chrome-headless-shell-linux64',
	'win32-x64': 'chrome-headless-shell-win64',
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
	for (const [name, directory] of [
		['playwright', playwright],
		['playwright-core', core],
	] as const) {
		const { version } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
			version: string;
		};
		checkPlaywrightVersion(name, version, directory);
	}
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
			: process.platform === 'win32'
				? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
				: (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'));
	let registry = join(cache, 'ms-playwright');
	if (configured === '0') registry = join(core, '.local-browsers');
	else if (configured) registry = isAbsolute(configured) ? configured : resolve(configured);
	const executable = join(
		registry,
		`chromium_headless_shell-${shell.revision}`,
		directory,
		process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'
	);
	if (!existsSync(executable)) {
		const version = PLAYWRIGHT_VERSION;
		throw new Error(
			`Chromium headless shell ${shell.revision}, for Playwright ${version}, is missing at ${executable}; install it with \`npx playwright@${version} install --only-shell chromium\` (in the AFD repository, \`pnpm -F @lushly-dev/specimen exec playwright install chromium\`)`
		);
	}
	return executable;
}

/**
 * The version of the sandbox and network rules the host must apply, which its `open` reply
 * reports (`ISOLATION` in `host/src/main.rs`). A host built before them ignores `network`, so
 * it is refused rather than used.
 */
export const HOST_ISOLATION = 1;

/**
 * Throw unless the host's `open` reply reports at least the isolation rules this client needs:
 * a newer host applies them too, so it keeps working.
 */
export function checkHostIsolation(opened: { isolation?: unknown }, binary: string): void {
	const { isolation } = opened;
	if (typeof isolation === 'number' && Number.isInteger(isolation) && isolation >= HOST_ISOLATION)
		return;
	const suggestion =
		'In a source checkout, rebuild it with `pnpm -F @lushly-dev/specimen build:host && pnpm -F @lushly-dev/specimen stage:host`; otherwise reinstall @lushly-dev/specimen so its host package matches, or point SPECIMEN_HOST_BINARY at a current build';
	const found = opened.isolation === undefined ? 'none' : String(opened.isolation);
	const error: SpecimenHostError = new Error(
		`The Specimen host at ${binary} is older than this bench: it reports isolation ${found}, below ${HOST_ISOLATION}, so it would not apply the sandbox and network rules. ${suggestion}.`
	);
	error.code = 'HOST_OUTDATED';
	error.suggestion = suggestion;
	error.details = { binary, expected: HOST_ISOLATION, found: opened.isolation ?? null };
	throw error;
}

export interface HostFailure {
	message: string;
	causes: string[];
	code?: string;
	suggestion?: string;
	details?: Record<string, unknown>;
}
type Reply = { id: number } & ({ ok: true; result: unknown } | { ok: false; error: HostFailure });

/** Error fields forwarded from the native host when a failure is structured. */
export type SpecimenHostError = Error & {
	code?: string;
	suggestion?: string;
	details?: Record<string, unknown>;
};

/** Return a JSON-safe clone of plain object details, or undefined if absent or unencodable. */
export function jsonSafeDetails(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	try {
		const encoded = JSON.stringify(value);
		if (encoded === undefined) return undefined;
		const parsed: unknown = JSON.parse(encoded);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function attachFailureFields<T extends Error>(
	error: T,
	failure: HostFailure
): T & SpecimenHostError {
	const target = error as T & SpecimenHostError;
	if (typeof failure.code === 'string' && failure.code.trim().length > 0)
		target.code = failure.code;
	if (typeof failure.suggestion === 'string' && failure.suggestion.trim().length > 0)
		target.suggestion = failure.suggestion;
	const details = jsonSafeDetails(failure.details);
	if (details !== undefined) target.details = details;
	return target;
}

/** The host's error, with render and disposal failures kept apart as Playwright's runtime did. */
export function hostError(failure: HostFailure): SpecimenHostError {
	if (failure.causes.length < 2) return attachFailureFields(new Error(failure.message), failure);
	const errors = failure.causes.map((cause, index) =>
		index === 0 ? attachFailureFields(new Error(cause), failure) : new Error(cause)
	);
	return attachFailureFields(
		new AggregateError(
			errors,
			`Specimen render and disposal failed: ${errors.map(String).join('; ')}`
		),
		failure
	);
}

const CLOSE_TIMEOUT = 10_000;
const STDERR_LIMIT = 8_192;
/** The prefix of the host's log lines, such as the one saying Chromium runs without its sandbox. */
export const HOST_LOG_PREFIX = 'specimen-host: ';

/**
 * A stderr listener that passes the host's log lines on to `write` as they complete; the rest
 * of stderr stays in the failure message only.
 */
export function hostLogLines(write: (line: string) => void): (chunk: string) => void {
	let partial = '';
	return (chunk) => {
		const lines = (partial + chunk).split('\n');
		partial = lines.pop() ?? '';
		for (const line of lines) if (line.startsWith(HOST_LOG_PREFIX)) write(`${line}\n`);
	};
}

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

	constructor(readonly binary = hostBinaryPath()) {
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
				// another process group, so it is left alone. On Windows the browser is in a job
				// the host holds, which closing the host's handles terminates, so no group exists.
				if (this.browserGroup && !this.closedCleanly && process.platform !== 'win32') {
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
		child.stderr?.on(
			'data',
			hostLogLines((line) => process.stderr.write(line))
		);
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
