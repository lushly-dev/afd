import { appendFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

/**
 * Opt-in diagnostic trace for resource work. With `SPECIMEN_BENCH_TRACE=<file>` set, bench
 * creation and each render append one JSON line of step spans: wall time and this process's
 * CPU. Unset, `startTrace` returns undefined and nothing is measured or written. Spans that
 * overlap other work in the same process include that work's CPU.
 */
export interface TraceSpan {
	name: string;
	startMs: number;
	wallMs: number;
	cpuUs: number;
}

export interface Trace {
	span<T>(name: string, work: () => Promise<T>): Promise<T>;
	record(values: Record<string, unknown>): void;
	flush(): Promise<void>;
}

export function startTrace(kind: string, details: Record<string, unknown> = {}): Trace | undefined {
	const target = process.env.SPECIMEN_BENCH_TRACE;
	if (!target) return undefined;
	const origin = performance.now();
	const cpu = process.cpuUsage();
	const spans: TraceSpan[] = [];
	const values: Record<string, unknown> = {};
	return {
		async span(name, work) {
			const start = performance.now();
			const before = process.cpuUsage();
			try {
				return await work();
			} finally {
				const used = process.cpuUsage(before);
				spans.push({
					name,
					startMs: start - origin,
					wallMs: performance.now() - start,
					cpuUs: used.user + used.system,
				});
			}
		},
		record(next) {
			Object.assign(values, next);
		},
		async flush() {
			const used = process.cpuUsage(cpu);
			await appendFile(
				target,
				`${JSON.stringify({
					kind,
					pid: process.pid,
					...details,
					wallMs: performance.now() - origin,
					cpuUs: used.user + used.system,
					spans,
					...values,
				})}\n`
			);
		},
	};
}

/** Run `work` inside a span when tracing, or directly when not. */
export const traced = <T>(
	trace: Trace | undefined,
	name: string,
	work: () => Promise<T>
): Promise<T> => (trace ? trace.span(name, work) : work());
