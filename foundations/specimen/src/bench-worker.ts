import type { SpecimenBench } from './bench.js';
import {
	serializeWorkerError,
	WORKER_SHUTDOWN_TIMEOUT,
	type WorkerReply,
	type WorkerRequest,
} from './bench-worker-client.js';

// This entrypoint has no public command surface. Only the owning bench has its IPC channel.
let bench: SpecimenBench | undefined;
let queue: Promise<void> = Promise.resolve();
let closing = false;
let shutdown: Promise<void> | undefined;
function close(): Promise<void> {
	shutdown ??= (async () => {
		try {
			await bench?.close();
		} finally {
			bench = undefined;
		}
	})();
	return shutdown;
}
async function reply(message: WorkerReply): Promise<void> {
	if (!process.connected || !process.send) return;
	await new Promise<void>((resolve, reject) => {
		process.send?.(message, (error) => (error ? reject(error) : resolve()));
	});
}
async function execute(message: WorkerRequest): Promise<unknown> {
	if (message.operation === 'initialize') {
		if (bench) throw new Error('Specimen worker is already initialized');
		if (closing || !process.connected) throw new Error('Specimen worker owner disconnected');
		const { createInProcessBench } = await import('./bench-runtime.js');
		if (closing || !process.connected) throw new Error('Specimen worker owner disconnected');
		bench = await createInProcessBench(
			{ root: message.config.root, executablePath: message.executablePath },
			message.config
		);
		return null;
	}
	if (message.operation === 'close' || message.operation === 'abort') {
		await close();
		return null;
	}
	if (!bench) throw new Error('Specimen worker is not initialized');
	return message.operation === 'render'
		? bench.render(message.request)
		: bench.build(message.outDir);
}
function exitAfterCleanup(): void {
	closing = true;
	// Keep cleanup bounded even if Vite or Chromium is stuck during parent loss.
	const timer = setTimeout(() => process.exit(1), WORKER_SHUTDOWN_TIMEOUT);
	// Interrupt active browser work through the runtime's public force-kill handle.
	// During initialization, wait for the runtime to become available before closing.
	const cleanup = bench ? close() : queue.then(close);
	void Promise.all([queue, cleanup])
		.catch(() => {})
		.finally(() => {
			clearTimeout(timer);
			process.exit(0);
		});
}
process.on('message', (message: WorkerRequest) => {
	if (message.operation === 'abort') {
		exitAfterCleanup();
		return;
	}
	if (closing) return;
	if (message.operation === 'close') closing = true;
	queue = queue.then(async () => {
		let failed = false;
		try {
			await reply({ id: message.id, success: true, result: await execute(message) });
		} catch (error) {
			failed = true;
			await reply({ id: message.id, success: false, error: serializeWorkerError(error) }).catch(
				() => {}
			);
		}
		if (message.operation === 'close' || (message.operation === 'initialize' && failed)) {
			exitAfterCleanup();
		}
	});
});
process.once('disconnect', exitAfterCleanup);
// SIGTERM is also the host's bounded fallback after an acknowledged close.
process.once('SIGTERM', exitAfterCleanup);

if (!process.connected) exitAfterCleanup();
