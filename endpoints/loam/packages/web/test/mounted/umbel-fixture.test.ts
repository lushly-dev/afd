import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { startProcess, stopProcess } from './umbel-fixture';

vi.mock('node:child_process', async (original) => {
	const actual = await original<typeof import('node:child_process')>();
	return { ...actual, spawn: vi.fn(actual.spawn) };
});

function fakeChild() {
	const child = Object.assign(new EventEmitter(), {
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn<(signal: NodeJS.Signals) => boolean>(() => true),
	});
	return {
		child,
		process: child as unknown as ChildProcess,
		exit(signal: NodeJS.Signals) {
			child.signalCode = signal;
			child.emit('exit', null, signal);
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

it('stops a real child twice after signal termination without waiting for another exit', async () => {
	const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
	await once(child, 'spawn');
	try {
		await stopProcess(child);
		expect(child.signalCode).not.toBeNull();
		expect(child.exitCode).toBeNull();
		await stopProcess(child);
	} finally {
		child.kill('SIGKILL');
	}
});

it('rejects a failed spawn immediately and clears its startup timer', async () => {
	vi.useFakeTimers();
	const fixture = fakeChild();
	vi.mocked(spawn).mockReturnValueOnce(fixture.process);
	const started = startProcess('unused', '127.0.0.1:0');
	const failed = expect(started).rejects.toThrow('ENOENT');
	fixture.child.emit('error', new Error('ENOENT'));
	await failed;
	expect(vi.getTimerCount()).toBe(0);
});

it('reports an early exit with its startup diagnostic', async () => {
	vi.useFakeTimers();
	const fixture = fakeChild();
	vi.mocked(spawn).mockReturnValueOnce(fixture.process);
	const failed = expect(startProcess('unused', '127.0.0.1:0')).rejects.toThrow(
		'umbel exited with SIGTERM: cannot bind'
	);
	fixture.child.stderr.write('cannot bind');
	fixture.exit('SIGTERM');
	await failed;
	expect(vi.getTimerCount()).toBe(0);
});

it('clears the startup deadline once the listener is ready', async () => {
	vi.useFakeTimers();
	const fixture = fakeChild();
	vi.mocked(spawn).mockReturnValueOnce(fixture.process);
	const started = startProcess('unused', '127.0.0.1:0');
	fixture.child.stderr.write('umbel listening on http://127.0.0.1:12345/mcp');
	expect(await started).toEqual({ child: fixture.process, port: 12345 });
	await vi.advanceTimersByTimeAsync(30_000);
	expect(fixture.child.kill).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

it('reaps a process that misses the startup deadline before rejecting', async () => {
	vi.useFakeTimers();
	const fixture = fakeChild();
	fixture.child.kill.mockImplementation((signal) => {
		fixture.exit(signal);
		return true;
	});
	vi.mocked(spawn).mockReturnValueOnce(fixture.process);
	const failed = expect(startProcess('unused', '127.0.0.1:0')).rejects.toThrow(
		'umbel did not start in 30000 ms'
	);
	await vi.advanceTimersByTimeAsync(30_000);
	await failed;
	expect(fixture.child.signalCode).toBe('SIGTERM');
	expect(vi.getTimerCount()).toBe(0);
});

it('escalates a stubborn process to SIGKILL and waits for its exit', async () => {
	vi.useFakeTimers();
	const fixture = fakeChild();
	fixture.child.kill.mockImplementation((signal) => {
		if (signal === 'SIGKILL') fixture.exit(signal);
		return true;
	});
	const stopped = stopProcess(fixture.process);
	await vi.advanceTimersByTimeAsync(5_000);
	await stopped;
	expect(fixture.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
	expect(fixture.child.listenerCount('exit')).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it('rejects within a bound if even SIGKILL produces no exit', async () => {
	vi.useFakeTimers();
	const fixture = fakeChild();
	const failed = expect(stopProcess(fixture.process)).rejects.toThrow(
		'umbel did not exit within 5000 ms of SIGKILL'
	);
	await vi.advanceTimersByTimeAsync(10_000);
	await failed;
	expect(fixture.child.listenerCount('exit')).toBe(0);
	expect(fixture.child.listenerCount('error')).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});
