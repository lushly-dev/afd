import { resolve } from 'node:path';
import { BenchWorkerClient } from './bench-worker-client.js';
import { type LoadedConfig, loadConfig, resolveContext } from './config.js';
import { captureRequestSchema } from './schema.js';
import type { BenchOptions, CaptureRequest, Observation, SpecimenEntry } from './types.js';

export interface SpecimenBench {
	list(): SpecimenEntry[];
	render(request: CaptureRequest): Promise<Observation>;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
	close(): Promise<void>;
}

export async function createSpecimenBench(options: BenchOptions): Promise<SpecimenBench> {
	// Validate once, before returning metadata. Either backend receives this exact snapshot,
	// including resolved module paths and digest, rather than rereading a changed config.
	let config: LoadedConfig | undefined = await loadConfig(options);
	for (const entry of config.config.specimens) Object.freeze(entry);
	Object.freeze(config.config.specimens);
	Object.freeze(config.config);
	Object.freeze(config.modules);
	Object.freeze(config);
	const executablePath = options.executablePath;
	const runtimeIsolation = options.runtimeIsolation ?? 'in-process';
	type Backend = Pick<SpecimenBench, 'render' | 'build' | 'close'>;
	let backend: Backend | undefined;
	let closed = false;
	let closing: Promise<void> | undefined;
	let pending: Promise<unknown> = Promise.resolve();
	const ensureOpen = (): LoadedConfig => {
		if (closed || !config) throw new Error('Specimen bench is closed');
		return config;
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
			return ensureOpen().config.specimens.map((entry) => ({ ...entry }));
		},
		async render(rawRequest) {
			const snapshot = ensureOpen();
			const request = captureRequestSchema.parse(rawRequest);
			if (!snapshot.config.specimens.some((entry) => entry.id === request.id))
				throw new Error(`Specimen not found: ${request.id}`);
			// Resolve context here too: invalid requests never start a runtime.
			resolveContext(request.context);
			return enqueue((client) => client.render(request));
		},
		async build(outDir) {
			ensureOpen();
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
