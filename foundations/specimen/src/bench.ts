import { resolve } from 'node:path';
import { BenchWorkerClient } from './bench-worker-client.js';
import { type LoadedConfig, loadConfig, resolveContext } from './config.js';
import { validateDiscovery } from './stories.js';
import type {
	BenchOptions,
	CaptureRequest,
	Observation,
	RunRequest,
	SpecimenEntry,
	StoryRun,
	ValidationReport,
	ValidationTarget,
} from './types.js';
import { parseCaptureRequest } from './validate.js';

/** Discovery found stories it cannot index; `validate()` reports each problem. */
export class DiscoveryError extends Error {
	readonly code = 'SPECIMEN_DISCOVERY_FAILED';
	constructor(readonly problems: string[]) {
		super(
			`Story discovery failed with ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.join('; ')}`
		);
	}
}

export interface SpecimenBench {
	/** Native specimens and discovered stories; throws a `DiscoveryError` if discovery failed. */
	list(): SpecimenEntry[];
	/**
	 * Static validation of discovered stories, optionally one story or file: identity, format
	 * and annotation support, and what only running the module can settle. Never throws for
	 * problems it finds.
	 */
	validate(target?: ValidationTarget): ValidationReport;
	render(request: CaptureRequest): Promise<Observation>;
	/**
	 * Run a retained story as Storybook's Vitest addon runs it: render, play, then the
	 * accessibility check under its effective policy. A story that fails to render fails its run.
	 */
	run(request: RunRequest): Promise<StoryRun>;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
	close(): Promise<void>;
}

export async function createSpecimenBench(options: BenchOptions): Promise<SpecimenBench> {
	// Validate once, before returning metadata. Either backend receives this exact snapshot,
	// including resolved module paths and digest, rather than rereading a changed config.
	let config: LoadedConfig | undefined = await loadConfig(options);
	for (const entry of config.entries) Object.freeze(entry);
	Object.freeze(config.entries);
	Object.freeze(config.config);
	Object.freeze(config.modules);
	Object.freeze(config);
	const executablePath = options.executablePath;
	const runtimeIsolation = options.runtimeIsolation ?? 'in-process';
	type Backend = Pick<SpecimenBench, 'render' | 'run' | 'build' | 'close'>;
	let backend: Backend | undefined;
	let closed = false;
	let closing: Promise<void> | undefined;
	let pending: Promise<unknown> = Promise.resolve();
	const ensureOpen = (): LoadedConfig => {
		if (closed || !config) throw new Error('Specimen bench is closed');
		return config;
	};
	/** Listing and rendering need a discovery without errors. */
	const ensureDiscovered = (): LoadedConfig => {
		const snapshot = ensureOpen();
		const errors = snapshot.stories?.discovery.errors ?? [];
		if (errors.length) throw new DiscoveryError(errors.map((problem) => problem.message));
		return snapshot;
	};
	const enqueue = <T>(operation: (runtime: Backend) => Promise<T>): Promise<T> => {
		const snapshot = ensureOpen();
		const result = pending.then(async () => {
			if (!backend) {
				backend =
					runtimeIsolation === 'process'
						? new BenchWorkerClient(snapshot, executablePath)
						: await (await import('./bench-runtime.js')).createInProcessBench(
								{ root: snapshot.root, executablePath },
								snapshot
							);
			}
			return operation(backend);
		});
		// An individual render error must not poison later work or close.
		pending = result.catch(() => {});
		return result;
	};
	return {
		list() {
			return ensureDiscovered().entries.map((entry) => ({ ...entry }));
		},
		validate(target) {
			const snapshot = ensureOpen();
			const discovery = snapshot.stories?.discovery;
			if (!discovery) {
				const known = !target?.id || snapshot.entries.some((entry) => entry.id === target.id);
				return {
					valid: known,
					scope: 'static',
					checked: 0,
					issues: known
						? []
						: [
								{
									severity: 'error',
									code: 'SPECIMEN_NOT_FOUND',
									message: `Specimen not found: ${target?.id}`,
									suggestion: 'Use specimen-list to check the id.',
								},
							],
				};
			}
			const report = validateDiscovery(discovery, snapshot.root, target);
			if (target?.id && !snapshot.entries.some((entry) => entry.id === target.id))
				return {
					...report,
					valid: false,
					issues: [
						{
							severity: 'error',
							code: 'SPECIMEN_NOT_FOUND',
							message: `Specimen not found: ${target.id}`,
							suggestion:
								'Use specimen-list to check the id, or validate the file to see why it was not indexed.',
						},
						...report.issues,
					],
				};
			return report;
		},
		async render(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureRequest(rawRequest);
			if (!snapshot.entries.some((entry) => entry.id === request.id))
				throw new Error(`Specimen not found: ${request.id}`);
			// Resolve context here too: invalid requests never start a runtime.
			resolveContext(request.context);
			return enqueue((client) => client.render(request));
		},
		async run(rawRequest) {
			const snapshot = ensureDiscovered();
			const request = parseCaptureRequest(rawRequest);
			if (request.checkpoint !== undefined)
				throw new Error('A run always ends at the after-run checkpoint; omit checkpoint.');
			if (!snapshot.entries.some((entry) => entry.id === request.id))
				throw new Error(`Specimen not found: ${request.id}`);
			resolveContext(request.context);
			return enqueue((client) => client.run(request));
		},
		async build(outDir) {
			ensureDiscovered();
			const directory = resolve(outDir);
			return enqueue((client) => client.build(directory));
		},
		close() {
			closing ??= (async () => {
				closed = true;
				try {
					await pending;
					await backend?.close();
				} finally {
					backend = undefined;
					config = undefined;
					pending = Promise.resolve();
				}
			})();
			return closing;
		},
	};
}
