import { execFileSync, type ForkOptions, fork } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createSpecimenBench } from './bench.js';
import {
	compiledWorkerPath,
	deserializeWorkerError,
	serializeWorkerError,
} from './bench-worker-client.js';

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return { ...actual, fork: vi.fn(actual.fork) };
});

const roots: string[] = [];
const benches: Awaited<ReturnType<typeof createSpecimenBench>>[] = [];
afterEach(async () => {
	await Promise.all(benches.splice(0).map((bench) => bench.close().catch(() => {})));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	vi.mocked(fork).mockClear();
});
async function fixture(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-worker-')));
	roots.push(root);
	await writeFile(
		join(root, 'probe.js'),
		`export const Probe = {
 render() { const button = document.createElement('button'); button.textContent = 'Worker capture'; return button; },
 dispose() { return new Promise((done) => setTimeout(done, 50)); }
};`
	);
	await writeFile(
		join(root, 'specimen.config.json'),
		JSON.stringify({
			specimens: [{ id: 'probe', title: 'Original', module: './probe.js', exportName: 'Probe' }],
		})
	);
	return root;
}
async function create(root: string) {
	const bench = await createSpecimenBench({ root, runtimeIsolation: 'process' });
	benches.push(bench);
	return bench;
}
function worker() {
	const result = vi.mocked(fork).mock.results.at(-1);
	if (result?.type !== 'return') throw new Error('Worker did not start');
	return result.value;
}
function expectExited(pid: number | undefined): void {
	expect(pid).toBeTypeOf('number');
	if (!pid) throw new Error('Worker had no pid');
	expect(() => process.kill(pid, 0)).toThrow();
}

it.each([undefined, 'in-process'] as const)(
	'renders without a worker and drains close with runtimeIsolation=%s',
	async (runtimeIsolation) => {
		const bench = await createSpecimenBench({ root: await fixture(), runtimeIsolation });
		benches.push(bench);
		expect(bench.list()[0]?.id).toBe('probe');
		expect(fork).not.toHaveBeenCalled();
		const render = bench.render({ id: 'probe' });
		const close = bench.close();
		expect(bench.close()).toBe(close);
		expect((await render).channels.dom.raw).toContain('Worker capture');
		await close;
		expect(fork).not.toHaveBeenCalled();
		await expect(bench.render({ id: 'probe' })).rejects.toThrow('closed');
	}
);

it('validates metadata and requests without starting a worker', async () => {
	const root = await fixture();
	const bench = await create(root);
	expect(bench.list()[0]?.title).toBe('Original');
	const entry = bench.list()[0];
	if (entry) entry.title = 'Caller mutation';
	expect(bench.list()[0]?.title).toBe('Original');
	await expect(bench.render({ id: 'missing' })).rejects.toThrow('Specimen not found');
	await expect(bench.render({ id: 'probe', timeoutMs: -1 })).rejects.toThrow();
	await expect(
		bench.render({ id: 'probe', context: { viewport: { width: 0, height: 20 } } })
	).rejects.toThrow();
	expect(fork).not.toHaveBeenCalled();
	await Promise.all([bench.close(), bench.close()]);
	expect(fork).not.toHaveBeenCalled();
	expect(() => bench.list()).toThrow('closed');
	await expect(bench.build(join(root, 'output'))).rejects.toThrow('closed');
	await writeFile(join(root, 'specimen.config.json'), '{ invalid');
	await expect(createSpecimenBench({ root })).rejects.toThrow();
	expect(fork).not.toHaveBeenCalled();
});

it('reuses one owned worker, keeps the config snapshot, builds and exits before close resolves', async () => {
	const root = await fixture();
	const bench = await create(root);
	// Changing the on-disk manifest after metadata discovery must not change execution.
	await writeFile(join(root, 'specimen.config.json'), '{ invalid now');
	const screenshot = join(root, 'capture.png');
	const capture = await bench.render({ id: 'probe', screenshot });
	expect(capture.channels.dom.raw).toContain('Worker capture');
	expect(capture.manifest.specimenId).toBe('probe');
	expect(capture.manifest.context.viewport).toEqual({ width: 1280, height: 720 });
	expect(capture.manifest.source.digest).toHaveLength(64);
	expect((await readFile(screenshot)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
	const child = worker();
	expect(child.exitCode).toBeNull();
	// Resolve the caller's current directory when the API accepts the build,
	// even though the existing worker inherited a different directory.
	const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
	let build: ReturnType<typeof bench.build>;
	try {
		build = bench.build('output');
	} finally {
		cwd.mockRestore();
	}
	const output = await build;
	expect(output.directory).toBe(join(root, 'output'));
	expect(output.shellBytes).toBeLessThanOrEqual(output.budget);
	expect(output.files.some((file) => file.endsWith('.js'))).toBe(true);
	await expect(bench.build(output.directory)).rejects.toThrow('must be empty');
	expect((await bench.render({ id: 'probe' })).channels.dom.raw).toContain('Worker capture');
	expect(fork).toHaveBeenCalledTimes(1);
	const close = bench.close();
	expect(bench.close()).toBe(close);
	await close;
	expectExited(child.pid);
	await expect(bench.render({ id: 'probe' })).rejects.toThrow('closed');
});

it('preserves render and disposal failures across the process backend', async () => {
	const root = await fixture();
	await writeFile(
		join(root, 'probe.js'),
		`export const Probe = {
 render() { return document.createElement('button'); },
 targets: { missing: { selector: '.missing' } },
 scenario: [{ action: { click: 'missing' } }],
 dispose() { throw new Error('process-cleanup-marker'); }
};`
	);
	const bench = await create(root);
	const error = await bench
		.render({ id: 'probe', checkpoint: 'after-run' })
		.catch((value: unknown) => value);
	expect(error).toBeInstanceOf(AggregateError);
	if (!(error instanceof AggregateError)) throw new Error('Expected both process failures');
	expect(String(error.errors[0])).toContain('Target must identify exactly one element: missing');
	expect(String(error.errors[1])).toContain('process-cleanup-marker');
});

it('drains an accepted render and concurrent close calls before releasing the process', async () => {
	const bench = await create(await fixture());
	const render = bench.render({ id: 'probe' });
	const close = bench.close();
	expect(bench.close()).toBe(close);
	await expect(bench.render({ id: 'probe' })).rejects.toThrow('closed');
	expect((await render).channels.dom.raw).toContain('Worker capture');
	const child = worker();
	await close;
	expectExited(child.pid);
});

it('rejects pending work when the child exits and still reaps the worker', async () => {
	const root = await fixture();
	const bench = await create(root);
	await bench.render({ id: 'probe' });
	const child = worker();
	child.kill('SIGKILL');
	await expect(bench.render({ id: 'probe' })).rejects.toThrow(/worker|IPC/i);
	await bench.close().catch(() => {});
	expectExited(child.pid);
});

it('closes its runtime after IPC is lost', async () => {
	const bench = await create(await fixture());
	await bench.render({ id: 'probe' });
	const child = worker();
	const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
	child.disconnect();
	await exited;
	await bench.close().catch(() => {});
	expectExited(child.pid);
});

function processTable() {
	return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
		.split('\n')
		.flatMap((line) => {
			const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
			return match
				? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] ?? '' }]
				: [];
		});
}
/** The native host the worker started, and Chromium under it. */
function ownedHost(worker: number) {
	const processes = processTable();
	const host = processes.find(
		(entry) => entry.parent === worker && entry.command.includes('specimen-host')
	);
	if (!host) throw new Error('No native host owned by the test worker');
	return { host, processes };
}

it.skipIf(process.platform === 'win32')(
	'bounds a render in a stopped browser and reaps it on close',
	async () => {
		const bench = await create(await fixture());
		await bench.render({ id: 'probe' });
		const child = worker();
		const { host, processes } = ownedHost(child.pid ?? 0);
		const browser = processes.find(
			(entry) => entry.parent === host.pid && entry.command.includes('--remote-debugging-pipe')
		);
		if (!browser) throw new Error('No browser owned by the native host');
		const owned = new Set([host.pid, browser.pid]);
		for (let changed = true; changed; ) {
			changed = false;
			for (const entry of processes) {
				if (owned.has(entry.parent) && !owned.has(entry.pid)) {
					owned.add(entry.pid);
					changed = true;
				}
			}
		}
		process.kill(browser.pid, 'SIGSTOP');
		try {
			// The render's own deadline covers a browser that stops answering.
			await expect(bench.render({ id: 'probe', timeoutMs: 50 })).rejects.toThrow(/deadline/);
			// Close reaps the stopped browser without a second signal.
			await bench.close();
			expectExited(child.pid);
			await vi.waitFor(
				() => {
					for (const pid of owned) expectExited(pid);
				},
				{ timeout: 2000 }
			);
		} finally {
			// A failed test must resume only the browser whose ownership was checked above.
			try {
				process.kill(browser.pid, 'SIGCONT');
			} catch {}
			await bench.close().catch(() => {});
		}
	}
);

it.skipIf(process.platform === 'win32')(
	'reaps a browser stopped before the first launch handshake after IPC loss',
	async () => {
		const root = await fixture();
		const executable = join(root, 'stopped-browser.sh');
		const pidFile = join(root, 'browser.pid');
		await writeFile(
			executable,
			`#!/bin/sh
printf '%s' "$$" > '${pidFile}'
kill -STOP "$$"
exit 1
`
		);
		await chmod(executable, 0o755);
		const bench = await createSpecimenBench({
			root,
			executablePath: executable,
			runtimeIsolation: 'process',
		});
		benches.push(bench);
		const rejected = expect(bench.render({ id: 'probe' })).rejects.toThrow(/worker|IPC/i);
		let pid = 0;
		await vi.waitFor(
			async () => {
				pid = Number(await readFile(pidFile, 'utf8'));
				expect(pid).toBeGreaterThan(0);
			},
			{ timeout: 3000 }
		);
		const child = worker();
		// The disposable executable records its own pid; verify ownership before signaling.
		const parent = Number(
			execFileSync('ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }).trim()
		);
		expect(parent).toBe(ownedHost(child.pid ?? 0).host.pid);
		const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
		try {
			child.disconnect();
			await rejected;
			await exited;
			// The worker's host must reap the entire launch group without a public close call.
			await vi.waitFor(
				() => {
					expectExited(pid);
					expect(() => process.kill(-pid, 0)).toThrow();
				},
				{ timeout: 2000 }
			);
		} finally {
			try {
				process.kill(pid, 'SIGCONT');
			} catch {}
			await bench.close().catch(() => {});
		}
	}
);

it('propagates startup failures and reaps a worker which cannot initialize', async () => {
	const root = await fixture();
	const script = join(root, 'failed-worker.cjs');
	await writeFile(
		script,
		`process.on('message', (message) => {
 if (message.operation === 'abort') process.exit(0);
 process.send({ id: message.id, success: false, error: { name: 'Error', message: 'startup-marker' } });
}); setInterval(() => {}, 1000);`
	);
	const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
	vi.mocked(fork).mockImplementationOnce((_path, _args, options) =>
		actual.fork(script, [], options as ForkOptions)
	);
	const bench = await create(root);
	await expect(bench.render({ id: 'probe' })).rejects.toThrow('startup-marker');
	await bench.close().catch(() => {});
	expectExited(worker().pid);
});

it('bounds worker startup when no IPC reply arrives', async () => {
	const root = await fixture();
	const script = join(root, 'unresponsive-worker.cjs');
	await writeFile(
		script,
		`process.on('message', (message) => {
 if (message.operation === 'abort') process.exit(0);
}); setInterval(() => {}, 1000);`
	);
	const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
	let started: () => void = () => {};
	const start = new Promise<void>((resolve) => {
		started = resolve;
	});
	vi.mocked(fork).mockImplementationOnce((_path, _args, options) => {
		const child = actual.fork(script, [], options as ForkOptions);
		started();
		return child;
	});
	const bench = await create(root);
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	try {
		const rejected = expect(bench.render({ id: 'probe' })).rejects.toThrow(/initialize deadline/);
		await start;
		await vi.advanceTimersByTimeAsync(30_000);
		await rejected;
		await bench.close().catch(() => {});
		expectExited(worker().pid);
	} finally {
		vi.useRealTimers();
	}
});

it('reports unsupported worker paths and transports nested disposal errors', () => {
	expect(() =>
		compiledWorkerPath(pathToFileURL('/missing-specimen/bench-worker-client.js').href)
	).toThrow(/Compiled Specimen worker is missing/);
	const error = deserializeWorkerError(
		serializeWorkerError(new AggregateError([new Error('render-marker'), 'cleanup-marker'], 'both'))
	);
	expect(error).toBeInstanceOf(AggregateError);
	if (!(error instanceof AggregateError)) throw new Error('Expected AggregateError');
	expect(String(error.errors[0])).toContain('render-marker');
	expect(String(error.errors[1])).toContain('cleanup-marker');
});
