import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { dirname, join, resolve } from 'node:path';
import { getHeapCodeStatistics, getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

export async function apiIdentity(entry) {
	const root = dirname(resolve(entry));
	const files = {};
	const visit = async (directory, prefix = '') => {
		for (const file of await readdir(directory, { withFileTypes: true })) {
			if (file.name === 'node_modules') continue;
			const relative = join(prefix, file.name);
			if (file.isDirectory()) await visit(join(directory, file.name), relative);
			else if (file.name.endsWith('.js'))
				files[relative] = createHash('sha256')
					.update(await readFile(join(directory, file.name)))
					.digest('hex');
		}
	};
	await visit(root);
	return { entry: resolve(entry), files };
}

export function allocationTotals(profile, limit = 20) {
	const totals = new Map();
	const walk = (node) => {
		const frame = node.callFrame ?? {};
		const key = `${frame.url ?? ''}:${frame.lineNumber ?? 0}:${frame.functionName ?? '(anonymous)'}`;
		if (node.selfSize > 0) {
			const item = totals.get(key) ?? {
				url: frame.url,
				line: (frame.lineNumber ?? 0) + 1,
				function: frame.functionName || '(anonymous)',
				sampledBytes: 0,
			};
			item.sampledBytes += node.selfSize;
			totals.set(key, item);
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(profile.head);
	return [...totals.values()].sort((a, b) => b.sampledBytes - a.sampledBytes).slice(0, limit);
}

export async function createHeapSampler() {
	const session = new Session();
	session.connect();
	await session.post('HeapProfiler.enable');
	await session.post('HeapProfiler.startSampling', {
		samplingInterval: 32768,
		includeObjectsCollectedByMajorGC: false,
		includeObjectsCollectedByMinorGC: false,
	});
	return {
		async collectGarbage() {
			// Diagnostic runs only. Production bench cleanup does not force GC.
			await session.post('HeapProfiler.collectGarbage');
			await new Promise((resolve) => setImmediate(resolve));
			await session.post('HeapProfiler.collectGarbage');
		},
		async sample() {
			const memory = process.memoryUsage();
			const heap = getHeapStatistics();
			const spaces = getHeapSpaceStatistics();
			const code = getHeapCodeStatistics();
			const { profile } = await session.post('HeapProfiler.getSamplingProfile');
			return {
				memory,
				heap,
				spaces,
				code,
				activeResources: process.getActiveResourcesInfo(),
				allocations: {
					intervalBytes: 32768,
					top: allocationTotals(profile),
					scope:
						'Statistical surviving allocations in the main V8 isolate; excludes untracked native allocations and worker isolates',
				},
				profile,
			};
		},
		async close() {
			try {
				await session.post('HeapProfiler.stopSampling');
			} finally {
				session.disconnect();
			}
		},
	};
}
