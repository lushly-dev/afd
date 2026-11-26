import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SpecimenBench } from './bench.js';
import type { LoadedConfig } from './config.js';
import { hostLogLines, jsonSafeDetails, type SpecimenHostError } from './host.js';
import type {
	A11yRequest,
	A11yRun,
	BaselineRequest,
	CaptureRequest,
	CaptureSetRequest,
	CaptureSetRun,
	CheckpointsRequest,
	CheckpointsRun,
	CompareRequest,
	CompareRun,
	ContractRequest,
	ContractRun,
	CoverageRequest,
	CoverageRun,
	GateRun,
	InspectRequest,
	InspectResult,
	JobRun,
	JobRunRequest,
	MatrixRequest,
	MatrixRun,
	NoteAddRequest,
	NoteCheckRequest,
	NoteCheckResult,
	NoteMoveRequest,
	NoteResult,
	Observation,
	PackBuildRequest,
	PackBuildRun,
	PointCheckRequest,
	PointCheckResult,
	PointMoveRequest,
	PointRequest,
	PointResult,
	ProfileRequest,
	ProfileRun,
	RunRequest,
	StoryRun,
	SuggestRequest,
	SuggestRun,
	SuiteRequest,
	SuiteRun,
	ThemesRequest,
	ThemesRun,
} from './types.js';

type WorkerOperation =
	| { operation: 'initialize'; config: LoadedConfig; executablePath?: string }
	| { operation: 'render'; request: CaptureRequest }
	| { operation: 'captureSet'; request: CaptureSetRequest }
	| { operation: 'compare'; request: CompareRequest }
	| { operation: 'captureCheckpoints'; request: CheckpointsRequest }
	| { operation: 'runJob'; request: JobRunRequest }
	| { operation: 'run'; request: RunRequest }
	| { operation: 'runSuite'; request: SuiteRequest }
	| { operation: 'a11y'; request: A11yRequest }
	| { operation: 'themes'; request: ThemesRequest }
	| { operation: 'coverage'; request: CoverageRequest }
	| { operation: 'packBuild'; request: PackBuildRequest; reportProgress: boolean }
	| { operation: 'contract'; request: ContractRequest }
	| { operation: 'suggest'; request: SuggestRequest }
	| { operation: 'profile'; request: ProfileRequest }
	| { operation: 'matrix'; request: MatrixRequest }
	| { operation: 'recordBaseline'; request: BaselineRequest }
	| { operation: 'inspect'; request: InspectRequest }
	| { operation: 'point'; request: PointRequest }
	| { operation: 'pointMove'; request: PointMoveRequest }
	| { operation: 'pointCheck'; request: PointCheckRequest }
	| { operation: 'noteAdd'; request: NoteAddRequest }
	| { operation: 'noteCheck'; request: NoteCheckRequest }
	| { operation: 'noteMove'; request: NoteMoveRequest }
	| { operation: 'build'; outDir: string }
	| { operation: 'close' }
	| { operation: 'abort' };
export type WorkerRequest = { id: number } & WorkerOperation;
export interface WorkerError {
	name: string;
	message: string;
	stack?: string;
	code?: string;
	suggestion?: string;
	details?: Record<string, unknown>;
	errors?: WorkerError[];
}
export type WorkerReply =
	| { id: number; progress: string }
	| { id: number; success: true; result: unknown }
	| { id: number; success: false; error: WorkerError };

export function serializeWorkerError(value: unknown, depth = 0): WorkerError {
	const error = value instanceof Error ? value : new Error(String(value));
	const fields = error as Error & {
		code?: unknown;
		suggestion?: unknown;
		details?: unknown;
	};
	const details = jsonSafeDetails(fields.details);
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		...(typeof fields.code === 'string' && fields.code.trim().length > 0
			? { code: fields.code }
			: {}),
		...(typeof fields.suggestion === 'string' && fields.suggestion.trim().length > 0
			? { suggestion: fields.suggestion }
			: {}),
		...(details !== undefined ? { details } : {}),
		...(error instanceof AggregateError && depth < 8
			? { errors: error.errors.map((item: unknown) => serializeWorkerError(item, depth + 1)) }
			: {}),
	};
}
export function deserializeWorkerError(value: WorkerError): SpecimenHostError {
	const error = value.errors
		? new AggregateError(value.errors.map(deserializeWorkerError), value.message)
		: new Error(value.message);
	error.name = value.name;
	if (value.stack) error.stack = value.stack;
	const target = error as SpecimenHostError;
	if (typeof value.code === 'string' && value.code.trim().length > 0) target.code = value.code;
	if (typeof value.suggestion === 'string' && value.suggestion.trim().length > 0)
		target.suggestion = value.suggestion;
	const details = jsonSafeDetails(value.details);
	if (details !== undefined) target.details = details;
	return target;
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
	private reportPackProgress = false;
	private stderr = '';
	private closing: Promise<void> | undefined;
	private terminating: Promise<void> | undefined;

	constructor(
		config: LoadedConfig,
		executablePath?: string,
		onPackProgress?: (message: string) => void
	) {
		this.reportPackProgress = onPackProgress !== undefined;
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
		// The worker's host log lines reach this process's stderr, as an in-process host's do.
		child.stderr?.on(
			'data',
			hostLogLines((line) => process.stderr.write(line))
		);
		child.on('message', (message: WorkerReply) => {
			const request = this.requests.get(message.id);
			if (!request) return;
			if ('progress' in message) {
				onPackProgress?.(message.progress);
				return;
			}
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
	async captureSet(request: CaptureSetRequest = {}): Promise<CaptureSetRun> {
		await this.ready;
		return (await this.request({ operation: 'captureSet', request }, 3_600_000)) as CaptureSetRun;
	}
	async compare(request: CompareRequest): Promise<CompareRun> {
		await this.ready;
		return (await this.request({ operation: 'compare', request }, 3_600_000)) as CompareRun;
	}
	async captureCheckpoints(request: CheckpointsRequest): Promise<CheckpointsRun> {
		await this.ready;
		return (await this.request(
			{ operation: 'captureCheckpoints', request },
			(request.timeoutMs ?? 30_000) + 30_000
		)) as CheckpointsRun;
	}
	async runJob(request: JobRunRequest): Promise<JobRun> {
		await this.ready;
		return (await this.request(
			{ operation: 'runJob', request },
			(request.timeoutMs ?? 30_000) + 30_000
		)) as JobRun;
	}
	async run(request: RunRequest): Promise<StoryRun | GateRun> {
		await this.ready;
		return (await this.request(
			{ operation: 'run', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as StoryRun | GateRun;
	}
	async matrix(request: MatrixRequest): Promise<MatrixRun> {
		await this.ready;
		return (await this.request({ operation: 'matrix', request }, 3_600_000)) as MatrixRun;
	}
	async profile(request: ProfileRequest): Promise<ProfileRun> {
		await this.ready;
		return (await this.request({ operation: 'profile', request }, 3_600_000)) as ProfileRun;
	}
	async recordBaseline(request: BaselineRequest): Promise<ProfileRun> {
		await this.ready;
		return (await this.request({ operation: 'recordBaseline', request }, 3_600_000)) as ProfileRun;
	}
	async suggest(request: SuggestRequest): Promise<SuggestRun> {
		await this.ready;
		return (await this.request({ operation: 'suggest', request }, 3_600_000)) as SuggestRun;
	}
	async contract(request: ContractRequest): Promise<ContractRun> {
		await this.ready;
		return (await this.request({ operation: 'contract', request }, 3_600_000)) as ContractRun;
	}
	async coverage(request: CoverageRequest): Promise<CoverageRun> {
		await this.ready;
		return (await this.request({ operation: 'coverage', request }, 3_600_000)) as CoverageRun;
	}
	async packBuild(request: PackBuildRequest = {}): Promise<PackBuildRun> {
		await this.ready;
		return (await this.request(
			{ operation: 'packBuild', request, reportProgress: this.reportPackProgress },
			3_600_000
		)) as PackBuildRun;
	}
	async a11y(request: A11yRequest): Promise<A11yRun> {
		await this.ready;
		// As a suite: each entry has its own deadline in the worker.
		return (await this.request({ operation: 'a11y', request }, 3_600_000)) as A11yRun;
	}
	async themes(request: ThemesRequest): Promise<ThemesRun> {
		await this.ready;
		// As a suite: each render has its own deadline in the worker.
		return (await this.request({ operation: 'themes', request }, 3_600_000)) as ThemesRun;
	}
	async runSuite(request: SuiteRequest): Promise<SuiteRun> {
		await this.ready;
		// Every story has its own deadline in the worker; this covers a worker that stops answering.
		return (await this.request({ operation: 'runSuite', request }, 3_600_000)) as SuiteRun;
	}
	async inspect(request: InspectRequest): Promise<InspectResult> {
		await this.ready;
		return (await this.request(
			{ operation: 'inspect', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as InspectResult;
	}
	async point(request: PointRequest): Promise<PointResult> {
		await this.ready;
		return (await this.request(
			{ operation: 'point', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as PointResult;
	}
	async pointMove(request: PointMoveRequest): Promise<PointResult> {
		await this.ready;
		return (await this.request(
			{ operation: 'pointMove', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as PointResult;
	}
	async pointCheck(request: PointCheckRequest): Promise<PointCheckResult> {
		await this.ready;
		return (await this.request(
			{ operation: 'pointCheck', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as PointCheckResult;
	}
	async noteAdd(request: NoteAddRequest): Promise<NoteResult> {
		await this.ready;
		return (await this.request(
			{ operation: 'noteAdd', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as NoteResult;
	}
	async noteCheck(request: NoteCheckRequest = {}): Promise<NoteCheckResult> {
		await this.ready;
		return (await this.request({ operation: 'noteCheck', request }, 3_600_000)) as NoteCheckResult;
	}
	async noteMove(request: NoteMoveRequest): Promise<NoteResult> {
		await this.ready;
		return (await this.request(
			{ operation: 'noteMove', request },
			(request.timeoutMs ?? 10_000) + 15_000
		)) as NoteResult;
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
