#!/usr/bin/env node
/**
 * Where a measured job's CPU and memory went, from the recorder's `processes.jsonl` and the
 * workload's `phases.jsonl`. Each process's CPU is its largest sampled user+system time, so it
 * is a lower bound (a process living less than one 100 ms interval may be missed). A process is
 * charged to the phase in which it was first seen; the job's root process is kept apart, since
 * it lives through every phase. Roles come from the process tree: a browser is a Chromium
 * process whose parent is not Chromium, and its renderer, GPU and utility processes are its
 * children.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROMIUM = /chrom|headless/i;

export function parseJsonLines(text) {
	return text
		.split('\n')
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
}

function phaseWindows(phases) {
	return phases
		.filter((event) => event.event === 'start')
		.map((start) => {
			const end = phases.find((event) => event.event === 'end' && event.id === start.id);
			return { name: start.name, from: start.timestampMs, to: end?.timestampMs ?? Infinity };
		});
}

/** CPU seconds by role, by phase and by phase and role, plus the processes alive at the end. */
export function attributeJob(processEvents, phases = []) {
	const samples = processEvents.filter((event) => event.type === 'sample');
	const rootPid = processEvents.find((event) => event.type === 'start')?.rootPid;
	const processes = new Map();
	for (const sample of samples)
		for (const entry of sample.processes) {
			const key = `${entry.pid}:${entry.startId}`;
			const known = processes.get(key) ?? {
				pid: entry.pid,
				ppid: entry.ppid,
				name: entry.name,
				firstMs: sample.timestampMs,
				cpuSeconds: 0,
				peakFootprintBytes: 0,
			};
			known.cpuSeconds = Math.max(known.cpuSeconds, (entry.userNs + entry.systemNs) / 1e9);
			known.peakFootprintBytes = Math.max(known.peakFootprintBytes, entry.footprintBytes ?? 0);
			known.lastMs = sample.timestampMs;
			processes.set(key, known);
		}
	const byPid = new Map([...processes.values()].map((entry) => [entry.pid, entry]));
	const role = (entry) => {
		if (entry.pid === rootPid) return 'job-root';
		if (CHROMIUM.test(entry.name)) {
			const parent = byPid.get(entry.ppid);
			return parent && CHROMIUM.test(parent.name) ? 'chromium-child' : 'chromium-browser';
		}
		return entry.name === 'node' ? 'node' : entry.name;
	};
	const windows = phaseWindows(phases);
	const phaseOf = (entry) =>
		entry.pid === rootPid
			? 'job-root'
			: (windows.find((window) => entry.firstMs >= window.from && entry.firstMs <= window.to)
					?.name ?? 'outside-phases');
	const add = (target, key, value) => {
		target[key] = (target[key] ?? 0) + value;
	};
	const byRole = {};
	const byPhase = {};
	const byPhaseRole = {};
	let total = 0;
	for (const entry of processes.values()) {
		const entryRole = role(entry);
		const entryPhase = phaseOf(entry);
		add(byRole, entryRole, entry.cpuSeconds);
		add(byPhase, entryPhase, entry.cpuSeconds);
		byPhaseRole[entryPhase] ??= {};
		add(byPhaseRole[entryPhase], entryRole, entry.cpuSeconds);
		total += entry.cpuSeconds;
	}
	const round = (object) =>
		Object.fromEntries(
			Object.entries(object)
				.sort((a, b) => b[1] - a[1])
				.map(([key, value]) => [
					key,
					typeof value === 'number' ? Number(value.toFixed(3)) : round(value),
				])
		);
	return {
		scope: 'sampled lower bound; each process charged to the phase in which it was first seen',
		attributedCpuSeconds: Number(total.toFixed(3)),
		processes: processes.size,
		byRole: round(byRole),
		byPhase: round(byPhase),
		byPhaseRole: round(byPhaseRole),
	};
}

/** Attribute a job directory written by run-resources.mjs (`<dir>/<consumer>/…`). */
export function attributeJobDirectory(directory, consumer) {
	const base = join(directory, consumer);
	const read = (file) => {
		try {
			return parseJsonLines(readFileSync(join(base, file), 'utf8'));
		} catch {
			return [];
		}
	};
	return attributeJob(read('processes.jsonl'), read('phases.jsonl'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const [directory, consumer] = process.argv.slice(2);
	process.stdout.write(`${JSON.stringify(attributeJobDirectory(directory, consumer), null, 2)}\n`);
}
