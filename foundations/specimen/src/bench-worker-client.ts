import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SpecimenBench } from './bench.js';
import type { LoadedConfig } from './config.js';
import type {
	CaptureRequest,
	InspectRequest,
	InspectResult,
	Observation,
	RunRequest,
	StoryRun,
} from './types.js';

type WorkerOperation =
	| { operation: 'initialize'; config: LoadedConfig; executablePath?: string }
	| { operation: 'render'; request: CaptureRequest }
	| { operation: 'run'; request: RunRequest }
	| { operation: 'inspect'; request: InspectRequest }
	| { operation: 'build'; outDir: string }
	| { operation: 'close' }
	| { operation: 'abort' };
export type WorkerRequest = { id: number } & WorkerOperation;
export interface WorkerError {
	name: string;
	message: string;
	stack?: string;
	errors?: WorkerError[];
}
export type WorkerReply =
	| { id: number; success: true; result: unknown }
	| { id: number; success: false; error: WorkerError };

export function serializeWorkerError(value: unknown, depth = 0): WorkerError {
	const error = value instanceof Error ? value : new Error(String(value));
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		...(error instanceof AggregateError && depth < 8
			? { errors: error.errors.map((item: unknown) => serializeWorkerError(item, depth + 1)) }
			: {}),
	};
}
export function deserializeWorkerError(value: WorkerError): Error {
	const error = value.errors
		? new AggregateError(value.errors.map(deserializeWorkerError), value.message)
		: new Error(value.message);
	error.name = value.name;
	if (value.stack) error.stack = value.stack;
	return error;
}

/** Never run source TypeScript with an inherited loader: published workers are plain JS. */
export function compiledWorkerPath(moduleUrl = import.meta.url): string {
	const sibling = new URL('./bench-worker.js', moduleUrl);
	const candidate = moduleUrl.endsWith('.ts')
		? new URL('../dist/bench-worker.js', moduleUrl)
		: sibling;
	const path = fileURLToPath(candidate);
	if (!existsSync(path))
		throw new Error(
			'Compiled Specimen worker is missing; build @lushly-dev/specimen before rendering'
		);
	return path;
}

// Keep every owner watchdog beyond the browser's startup window. Before a
// BrowserServer handle exists, orderly Node exit must retain Playwright's
// registered process-exit cleanup for a partially launched browser.
export const BROWSER_LAUNCH_TIMEOUT = 10_000;
export const WORKER_SHUTDOWN_TIMEOUT = BROWSER_LAUNCH_TIMEOUT + 5_000;
const OWNER_TERMINATE_TIMEOUT = WORKER_SHUTDOWN_TIMEOUT + 1_000;
const STARTUP_TIMEOUT = 30_000;
const CLOSE_TIMEOUT = WORKER_SHUTDOWN_TIMEOUT;
const BUILD_TIMEOUT = 120_000;
const STDERR_LIMIT = 8_192;

/** A single persistent, private JSON IPC connection; no Vite/Playwright imports in the host. */
export class BenchWorkerClient {
	private child: ChildProcess | undefined;
	private sequence = 0;
	private readonly requests = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
	>();
	private readonly ready: Promise<unknown>;
	private readonly exited: Promise<void>;
	private resolveExit: () => void = () => {};
	private failure: Error | undefined;
	private stderr = '';
	private closing: Promise<void> | undefined;
	private terminating: Promise<void> | undefined;

	constructor(config: LoadedConfig, executablePath?: string) {
		this.exited = new Promise((resolveExit) => {
			this.resolveExit = resolveExit;
		});
		const child = fork(compiledWorkerPath(), [], {
			execArgv: [],
			stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
			serialization: 'json',
		});
		this.child = child;
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			this.stderr = (this.stderr + chunk).slice(-STDERR_LIMIT);
		});
		child.on('message', (message: WorkerReply) => {
			const request = this.requests.get(message.id);
			if (!request) return;
			this.requests.delete(message.id);
			clearTimeout(request.timer);
			if (message.success) request.resolve(message.result);
			else request.reject(deserializeWorkerError(message.error));
		});
		child.once('error', (error) => {
			this.fail(new Error(`Specimen worker process failed: ${error.message}`, { cause: error }));
			if (!child.pid) {
				this.child = undefined;
				this.resolveExit();
				child.stderr?.destroy();
			}
		});
		child.once('disconnect', () => {
			this.fail(new Error('Specimen worker IPC disconnected'));
			void this.terminate();
		});
		// Node can omit ChildProcess 'close' after an explicit IPC disconnect.
		// 'exit' establishes that the owned process and its caches are gone.
		child.once('exit', (code, signal) => {
			this.fail(
				new Error(
					`Specimen worker exited (code ${code}, signal ${signal})${this.stderr ? `: ${this.stderr}` : ''}`
				)
			);
			this.resolveExit();
			this.child = undefined;
			this.stderr = '';
			child.stderr?.destroy();
		});
		this.ready = this.request(
			{ operation: 'initialize', config, executablePath },
			STARTUP_TIMEOUT
		).catch(async (error: unknown) => {
			await this.terminate();
			throw error;
		});
	}

	private fail(error: Error): void {
		this.failure ??= error;
		for (const request of this.requests.values()) {
			clearTimeout(request.timer);
			request.reject(this.failure);
		}
		this.requests.clear();
	}

	private request(payload: WorkerOperation, timeout: number): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		const child = this.child;
		if (!child?.connected) return Promise.reject(new Error('Specimen worker is disconnected'));
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.fail(
					new Error(`Specimen worker ${payload.operation} deadline exceeded after ${timeout}ms`)
				);
				void this.terminate();
			}, timeout);
			this.requests.set(id, { resolve, reject, timer });
			child.send({ ...payload, id }, (error) => {
				if (error) {
					this.fail(
						new Error(`Specimen worker IPC send failed: ${error.message}`, { cause: error })
					);
					void this.terminate();
				}
			});
		});
	}

	private terminate(): Promise<void> {
		this.terminating ??= (async () => {
			const child = this.child;
			if (!child) return;
			// Give the worker a portable opportunity to force-kill its browser through
			// Playwright's public BrowserServer API before terminating the Node owner.
			if (child.connected) child.send({ id: 0, operation: 'abort' }, () => {});
			const terminateTimer = setTimeout(() => child.kill('SIGTERM'), OWNER_TERMINATE_TIMEOUT);
			const killTimer = setTimeout(() => child.kill('SIGKILL'), OWNER_TERMINATE_TIMEOUT + 1000);
			try {
				await this.exited;
			} finally {
				clearTimeout(terminateTimer);
				clearTimeout(killTimer);
			}
		})();
		return this.terminating;
	}

	async render(request: CaptureRequest): Promise<Observation> {
		await this.ready;
		return (await this.request(
			{ operation: 'render', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as Observation;
	}
	async run(request: RunRequest): Promise<StoryRun> {
		await this.ready;
		return (await this.request(
			{ operation: 'run', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as StoryRun;
	}
	async inspect(request: InspectRequest): Promise<InspectResult> {
		await this.ready;
		return (await this.request(
			{ operation: 'inspect', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as InspectResult;
	}
	async build(outDir: string): ReturnType<SpecimenBench['build']> {
		await this.ready;
		return (await this.request({ operation: 'build', outDir }, BUILD_TIMEOUT)) as Awaited<
			ReturnType<SpecimenBench['build']>
		>;
	}
	close(): Promise<void> {
		this.closing ??= (async () => {
			try {
				await this.ready;
				if (this.child) {
					await this.request({ operation: 'close' }, CLOSE_TIMEOUT);
					// A close reply is only useful once the process and its caches are gone.
					await this.terminate();
				}
			} finally {
				await this.terminate();
			}
		})();
		return this.closing;
	}
}
