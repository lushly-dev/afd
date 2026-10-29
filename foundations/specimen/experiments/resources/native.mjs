import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function buildCollector(directory) {
	if (process.platform !== 'darwin') {
		throw new Error(
			'Whole-process collector is currently supported on macOS with Xcode command-line tools.'
		);
	}
	await mkdir(directory, { recursive: true });
	const source = join(import.meta.dirname, 'darwin.c');
	const binary = join(directory, 'specimen-resources');
	const args = ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', source, '-o', binary];
	await execFile('xcrun', args, { timeout: 30_000 });
	const compiler = (await execFile('xcrun', ['clang', '--version'])).stdout.split('\n')[0];
	const identity = {
		binary,
		source,
		sourceSha256: sha256(await readFile(source)),
		binarySha256: sha256(await readFile(binary)),
		compiler,
		compileArguments: args,
	};
	await writeFile(join(directory, 'collector.json'), `${JSON.stringify(identity, null, 2)}\n`);
	return identity;
}

export async function readJsonLines(file) {
	return (await readFile(file, 'utf8'))
		.split('\n')
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
}

export async function runCollected({
	collector,
	directory,
	command,
	args = [],
	env = {},
	intervalMs = 100,
	graceMs = 500,
	maxFootprintBytes = 2 * 1024 ** 3,
	timeoutMs = 120_000,
	shutdownMs = 2500,
}) {
	await mkdir(directory, { recursive: true });
	const eventsFile = join(directory, 'processes.jsonl');
	const stdoutFile = join(directory, 'stdout.log');
	const stderrFile = join(directory, 'stderr.log');
	const stdout = await open(stdoutFile, 'w');
	const stderr = await open(stderrFile, 'w');
	let timedOut = false;
	let forcedKill = false;
	let timeoutCleanup = null;
	let code;
	let signal;
	try {
		const child = spawn(
			collector.binary,
			[
				'--out',
				eventsFile,
				'--interval-ms',
				String(intervalMs),
				'--grace-ms',
				String(graceMs),
				'--max-footprint-bytes',
				String(maxFootprintBytes),
				'--',
				command,
				...args,
			],
			{ env: { ...process.env, ...env }, stdio: ['ignore', stdout.fd, stderr.fd] }
		);
		let timer;
		let shutdown;
		try {
			({ code, signal } = await new Promise((resolve, reject) => {
				let settled = false;
				const finish = (value) => {
					if (!settled) {
						settled = true;
						resolve(value);
					}
				};
				child.once('error', reject);
				child.once('exit', (exitCode, exitSignal) =>
					finish({ code: exitCode, signal: exitSignal })
				);
				timer = setTimeout(() => {
					timedOut = true;
					child.kill('SIGCONT');
					child.kill('SIGTERM');
					shutdown = setTimeout(() => {
						forcedKill = true;
						child.kill('SIGKILL');
						child.unref();
						finish({ code: null, signal: 'SIGKILL' });
					}, shutdownMs);
				}, timeoutMs);
			}));
		} finally {
			clearTimeout(timer);
			clearTimeout(shutdown);
		}
	} finally {
		await stdout.close();
		await stderr.close();
	}
	let events;
	let parseError = null;
	try {
		events = await readJsonLines(eventsFile);
	} catch (error) {
		parseError = error.message;
		const text = await readFile(eventsFile, 'utf8').catch(() => '');
		events = text.split('\n').flatMap((line) => {
			try {
				return line.trim() ? [JSON.parse(line)] : [];
			} catch {
				return [];
			}
		});
	}
	if (forcedKill) {
		// Kernel-checked audit identities only; never signal descendants by reusable PID alone.
		const targets = new Map();
		const start = events.find((event) => event.type === 'start');
		if (Number.isInteger(start?.rootPid) && Number.isInteger(start?.rootIdversion))
			targets.set(start.rootPid, start.rootIdversion);
		for (const event of events) {
			for (const row of event.processes ?? []) {
				if (Number.isInteger(row.pid) && Number.isInteger(row.idversion))
					targets.set(row.pid, row.idversion);
			}
		}
		timeoutCleanup = { status: 'unverified', targets: targets.size, attempts: [] };
		for (const signalNumber of [15, 9]) {
			if (!targets.size) break;
			try {
				const result = await execFile(
					collector.binary,
					[
						'--signal-owned',
						String(signalNumber),
						...[...targets].map(([pid, version]) => `${pid}:${version}`),
					],
					{ timeout: 2000 }
				);
				timeoutCleanup.attempts.push(JSON.parse(result.stdout));
			} catch (error) {
				timeoutCleanup.attempts.push({ error: error.message });
			}
			if (signalNumber === 15) await new Promise((resolve) => setTimeout(resolve, 300));
		}
	}
	const stop = { code, signal, timedOut, forcedKill, timeoutCleanup, parseError };
	await writeFile(join(directory, 'controller-stop.json'), `${JSON.stringify(stop, null, 2)}\n`);
	return { ...stop, events, eventsFile, stdoutFile, stderrFile };
}
