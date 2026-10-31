/** Diagnostic only: load with NODE_OPTIONS=--import=... so isolated forks inherit it. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { basename, join, resolve } from 'node:path';
import { isMainThread } from 'node:worker_threads';

const directory = process.env.SPECIMEN_CPU_PROFILE_DIRECTORY;
const target = basename(process.argv[1] ?? '');
const role =
	target === 'run-batches.mjs' ? 'coordinator' : target === 'bench-worker.js' ? 'worker' : null;

// A fresh directory belongs to one diagnostic run. The driver writes start.json after
// warm batch 1, awaits every ready PID's started receipt, then runs batches 2–10.
// After batch 10 it writes stop.json and awaits every stopped receipt before close.
if (directory && role && isMainThread) await installProfiler(resolve(directory), role);

async function installProfiler(root, processRole) {
	const stem = `${processRole}-${process.pid}`;
	const profilePath = join(root, `${stem}.cpuprofile`);
	const identity = {
		role: processRole,
		pid: process.pid,
		ppid: process.ppid,
		argv1: process.argv[1],
		node: process.version,
		startTimestampMs: Date.now(),
		profilePath,
	};
	let nonce;
	let session;
	let timer;
	let busy = false;
	let started = false;
	let finished = false;
	const receipt = async (event, details = {}) => {
		const file = join(root, `${stem}.${event}.json`);
		const temporary = `${file}.tmp`;
		await writeFile(
			temporary,
			`${JSON.stringify({ ...identity, nonce, event, timestampMs: Date.now(), ...details }, null, 2)}\n`
		);
		await rename(temporary, file);
	};
	const marker = async (name) => {
		try {
			const value = JSON.parse(await readFile(join(root, `${name}.json`), 'utf8'));
			if (typeof value.nonce !== 'string' || !value.nonce || typeof value.createdUtc !== 'string') {
				throw new Error(`Invalid CPU ${name} marker; expected createdUtc and nonce`);
			}
			return value;
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	};
	const release = () => {
		finished = true;
		clearInterval(timer);
		session?.disconnect();
		session = undefined;
	};
	const fail = async (error) => {
		try {
			release();
		} catch (cleanupError) {
			error = new AggregateError([error, cleanupError], 'CPU profiling and disconnect failed');
		}
		process.exitCode = 1;
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		try {
			await receipt('error', {
				error: message,
				causes: error instanceof AggregateError ? error.errors.map(String) : [],
			});
		} catch (writeError) {
			process.stderr.write(
				`CPU profile ${stem}: ${message}; receipt failed: ${String(writeError)}\n`
			);
		}
	};
	const poll = async () => {
		if (busy || finished) return;
		busy = true;
		try {
			if (!started) {
				if (await marker('stop'))
					throw new Error('CPU stop marker appeared before profiling started');
				const start = await marker('start');
				if (!start) return;
				nonce = start.nonce;
				session = new Session();
				session.connect();
				await session.post('Profiler.enable');
				await session.post('Profiler.setSamplingInterval', { interval: 1000 });
				await session.post('Profiler.start');
				started = true;
				await receipt('started', { samplingIntervalUs: 1000 });
			} else {
				const stop = await marker('stop');
				if (!stop) return;
				if (stop.nonce !== nonce) throw new Error('CPU stop marker nonce differs from start');
				const { profile } = await session.post('Profiler.stop');
				if (!profile.samples?.length) throw new Error('CPU profile contains no samples');
				release();
				await writeFile(`${profilePath}.tmp`, JSON.stringify(profile));
				await rename(`${profilePath}.tmp`, profilePath);
				await receipt('stopped', {
					profilePath,
					sampleCount: profile.samples?.length ?? 0,
					startTime: profile.startTime,
					endTime: profile.endTime,
				});
			}
		} catch (error) {
			await fail(error);
		} finally {
			busy = false;
		}
	};
	try {
		await mkdir(root, { recursive: true });
		// Registration precedes starting the target module and does not start sampling.
		await receipt('ready', { node: process.version, samplingIntervalUs: 1000 });
		timer = setInterval(() => {
			void poll();
		}, 20);
		timer.unref();
	} catch (error) {
		await fail(error);
	}
}
