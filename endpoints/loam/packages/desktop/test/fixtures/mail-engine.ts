/**
 * The real mail engine for P5-A9 (phase 5 specification, 8; the mail plugin's specification, 12.4): `loam-mail
 * test-world` seeds a new data directory and serves the scripted IMAP, SMTP and HTTPS servers on loopback, then
 * `loam-mail serve` serves that directory on a loopback port, as a person runs it before mounting it by hand. The
 * binary is a test build (`--features test-doubles`): `LOAM_MAIL_BINARY`, or the engine's own `target/debug`.
 *
 * `received()` reads what the scripted SMTP server was sent, a line each, so a test counts what left. Every path is
 * under a new temporary directory; the engine never sees the person's own data directory or keychain.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { Readable } from 'node:stream';
import { LOAM } from '../harness';

export interface MailEngine {
	/** `http://127.0.0.1:<port>/mcp`. */
	url: string;
	/** The owner-only file holding the approver token `test-world` made, for the entry's `bearer_file`. */
	approverTokenFile: string;
	/** Every message the scripted SMTP server received, oldest first. */
	received(): Promise<Array<{ kind: string; to?: string[] }>>;
	/** What the engine wrote to standard error, a line each. */
	stderr: string[];
	close(): Promise<void>;
}

export function mailBinary(): string {
	return (
		process.env.LOAM_MAIL_BINARY ??
		join(
			process.env.CARGO_TARGET_DIR || join(LOAM, 'plugins/mail/engine/target'),
			'debug',
			process.platform === 'win32' ? 'loam-mail.exe' : 'loam-mail'
		)
	);
}

/** The first line of `stream` that `match` accepts, or a failure naming `what` once `child` exits or time runs out. */
function lineOf<T>(
	child: ChildProcess,
	lines: Interface,
	match: (line: string) => T | undefined,
	what: string
): Promise<T> {
	return new Promise((resolve, reject) => {
		// Settled once: its listeners and the timer are let go, whichever way it ends. The reader stays open, since
		// closing it would pause the stream another listener records, and a full pipe would stall the engine.
		const settle = () => {
			clearTimeout(timer);
			lines.off('line', onLine);
			child.off('error', onError);
			child.off('exit', onExit);
		};
		const fail = (error: Error) => {
			settle();
			reject(error);
		};
		const onError = (cause: Error) => fail(new Error(`${what} did not start: ${cause.message}`));
		const onExit = (code: number | null) => fail(new Error(`${what} exited with ${code}`));
		const timer = setTimeout(() => fail(new Error(`${what} did not start in 60 s`)), 60_000);
		const onLine = (line: string) => {
			let found: T | undefined;
			try {
				found = match(line);
			} catch (cause) {
				fail(new Error(`${what} printed a line that is not its own: ${String(cause)}`));
				return;
			}
			if (found !== undefined) {
				settle();
				resolve(found);
			}
		};
		lines.on('line', onLine);
		child.once('error', onError);
		child.once('exit', onExit);
	});
}

async function stop(child: ChildProcess | undefined): Promise<void> {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
	child.kill('SIGTERM');
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([exited, new Promise((resolve) => (timer = setTimeout(resolve, 5_000)))]);
	clearTimeout(timer);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill('SIGKILL');
		await exited;
	}
}

export async function startMailEngine(seed = 'loam-desktop'): Promise<MailEngine> {
	const binary = mailBinary();
	if (!existsSync(binary))
		throw new Error(
			`${binary} is not built: run \`cargo build --locked --features test-doubles --bin loam-mail\` in plugins/mail/engine, or set LOAM_MAIL_BINARY`
		);
	const scratch = await mkdtemp(join(tmpdir(), 'loam-desktop-mail-'));
	const stderr: string[] = [];
	const world = spawn(
		binary,
		['test-world', '--seed', seed, '--home', join(scratch, 'home'), '--out', join(scratch, 'out')],
		{
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, LOAM_MAIL_HOME: join(scratch, 'home') },
		}
	);
	let serve: ChildProcess | undefined;
	try {
		// Each process's standard error, kept for the whole run: what a test reads, apart from the start-up reads.
		createInterface({ input: world.stderr as Readable }).on('line', (line) => stderr.push(line));
		const outputs = await lineOf(
			world,
			createInterface({ input: world.stdout as Readable }),
			(line) =>
				line.trim().startsWith('{')
					? (JSON.parse(line) as {
							home: string;
							endpoints: string;
							secrets: string;
							approverToken: string;
							received: string;
						})
					: undefined,
			'loam-mail test-world'
		);
		serve = spawn(binary, ['serve', '--port', '0'], {
			stdio: ['ignore', 'ignore', 'pipe'],
			env: {
				...process.env,
				LOAM_MAIL_HOME: outputs.home,
				LOAM_MAIL_TEST_ENDPOINTS: outputs.endpoints,
				LOAM_MAIL_TEST_SECRETS: outputs.secrets,
			},
		});
		const serving = serve;
		const served = createInterface({ input: serving.stderr as Readable });
		served.on('line', (line) => stderr.push(line));
		const url = await lineOf(
			serving,
			served,
			(line) => /serving on (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(line)?.[1],
			'loam-mail serve'
		);
		return {
			url,
			approverTokenFile: outputs.approverToken,
			stderr,
			async received() {
				const text = await readFile(outputs.received, 'utf8');
				return text
					.split('\n')
					.filter((line) => line.trim() !== '')
					.map((line) => JSON.parse(line) as { kind: string; to?: string[] })
					.filter((entry) => entry.kind === 'smtp');
			},
			async close() {
				await stop(serving);
				await stop(world);
			},
		};
	} catch (cause) {
		await stop(serve);
		await stop(world);
		throw cause;
	}
}
