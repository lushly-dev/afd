#!/usr/bin/env node
/**
 * Waits for a sustained quiet window before a measurement starts. Admission checks one instant;
 * this gate requires every sample across the window to be quiet, because other sessions on a
 * shared host start and stop work without notice. It is a precondition, not evidence: the speed
 * probes around each job still decide whether a pair counts.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { hostSnapshot } from './host.mjs';

const execFile = promisify(execFileCallback);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Test runners, browsers and builds that mean another session is doing measurable work. */
export const FOREIGN_WORK = new RegExp(
	[
		'ms-playwright/',
		'chrome-headless-shell',
		'headless_shell',
		'--headless',
		'\\bvitest(?:\\.mjs)?\\b',
		'\\bplaywright (?:test|install)\\b',
		'\\bjest\\b',
		'storybook',
		'run-browser-iteration',
		'\\bpytest\\b',
		'\\bcargo (?:build|test|run|check|clippy|bench)\\b',
		'\\brustc\\b',
		'xcodebuild',
		'swift-frontend',
		'cmake --build',
		'\\bninja\\b',
		'/bin/tsc\\b|\\btsc (?:-|--)',
		'/\\.bin/vite\\b|\\bvite (?:build|dev|preview)\\b',
		'\\bwebpack\\b',
		'\\bturbo run\\b',
	].join('|'),
	'i'
);

/** Long-lived agent browser servers; they count only when they are actually busy. */
export const IDLE_SERVICES = /@playwright\/mcp|playwright-mcp/i;

export const quietDefaults = {
	windowSeconds: 600,
	intervalSeconds: 30,
	cpuWindowMs: 5_000,
	maxBusyCores: 1.5,
	minFreeMemoryPercent: 25,
	maxForeignCpuPercent: 20,
};

/** Parse `ps -Ao pid=,ppid=,pcpu=,command=`. */
export function parseProcesses(text) {
	return text
		.split('\n')
		.map((line) => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(line))
		.filter(Boolean)
		.map(([, pid, ppid, cpu, command]) => ({
			pid: Number(pid),
			ppid: Number(ppid),
			cpuPercent: Number(cpu),
			command,
		}));
}

/** Processes outside `ownPids` that are test/browser/build work, or simply busy. */
export function foreignWork(processes, ownPids, policy = quietDefaults) {
	return processes.filter(
		(process) =>
			!ownPids.has(process.pid) &&
			((FOREIGN_WORK.test(process.command) && !IDLE_SERVICES.test(process.command)) ||
				process.cpuPercent >= policy.maxForeignCpuPercent)
	);
}

/** The window is quiet only if it is full and every sample in it is quiet. */
export function quietVerdict(samples, policy = quietDefaults) {
	const needed = Math.ceil(policy.windowSeconds / policy.intervalSeconds) + 1;
	const window = samples.slice(-needed);
	const reasons = new Set();
	if (window.length < needed) reasons.add('WINDOW_INCOMPLETE');
	for (const sample of window) {
		if (sample.usedCores === null) reasons.add('CPU_UNAVAILABLE');
		else if (sample.usedCores > policy.maxBusyCores) reasons.add('CPU_BUSY');
		if (sample.freeMemoryPercent === null) reasons.add('MEMORY_UNAVAILABLE');
		else if (sample.freeMemoryPercent < policy.minFreeMemoryPercent) reasons.add('MEMORY_LOW');
		if (sample.foreign.length) reasons.add('FOREIGN_WORK');
	}
	return { quiet: reasons.size === 0, reasons: [...reasons], samples: window.length, needed };
}

/** Reject values that would make the gate pass vacuously. */
export function quietPolicy(overrides = {}) {
	const policy = { ...quietDefaults, ...overrides };
	for (const name of ['windowSeconds', 'intervalSeconds', 'maxBusyCores']) {
		const value = policy[name];
		if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
	}
	if (policy.intervalSeconds * 1000 < policy.cpuWindowMs)
		throw new Error('intervalSeconds must cover the 5-second CPU window');
	return policy;
}

// Only this process and its descendants: a parent can exit and reparent us to launchd.
function ownFamily(processes) {
	const own = new Set([process.pid]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const entry of processes)
			if (own.has(entry.ppid) && !own.has(entry.pid)) {
				own.add(entry.pid);
				grew = true;
			}
	}
	return own;
}

export async function sampleHost(policy = quietDefaults) {
	const before = cpus();
	await pause(policy.cpuWindowMs);
	const after = cpus();
	let idle = 0;
	let total = 0;
	after.forEach((cpu, index) => {
		const previous = before[index]?.times;
		if (!previous) return;
		const current = cpu.times;
		const delta = (name) => current[name] - previous[name];
		const sum = delta('user') + delta('nice') + delta('sys') + delta('idle') + delta('irq');
		idle += delta('idle');
		total += sum;
	});
	const snapshot = await hostSnapshot();
	const listing = await execFile('/bin/ps', ['-Ao', 'pid=,ppid=,pcpu=,command='], {
		maxBuffer: 16 * 1024 * 1024,
	});
	const processes = parseProcesses(listing.stdout);
	const foreign = foreignWork(processes, ownFamily(processes), policy).map((entry) => ({
		pid: entry.pid,
		cpuPercent: entry.cpuPercent,
		command: entry.command.slice(0, 160),
	}));
	return {
		timestampUtc: new Date().toISOString(),
		usedCores: total > 0 ? after.length * (1 - idle / total) : null,
		cpuWindowMs: policy.cpuWindowMs,
		loadAverage: snapshot.loadAverage,
		freeMemoryPercent: snapshot.freeMemoryPercent,
		foreign,
	};
}

/**
 * Sample until the window is quiet (`quiet: true`), or until `timeoutSeconds` passes or one
 * sample fails when `wait` is false. CPU is measured over 5 seconds of each interval.
 */
export async function waitForQuiet(policy, { wait = true, timeoutSeconds = 0, onSample } = {}) {
	const started = Date.now();
	const samples = [];
	while (true) {
		const next = await sampleHost(policy);
		samples.push(next);
		const verdict = quietVerdict(samples, policy);
		onSample?.({ sample: next, verdict });
		if (verdict.quiet || !wait) return { ...verdict, samples };
		if (timeoutSeconds && Date.now() - started > timeoutSeconds * 1000)
			return { ...verdict, timedOut: true, samples };
		await pause(Math.max(0, policy.intervalSeconds * 1000 - policy.cpuWindowMs));
	}
}

async function main(args) {
	const option = (name, fallback) => {
		const index = args.indexOf(name);
		return index === -1 ? fallback : Number(args[index + 1]);
	};
	const policy = quietPolicy({
		windowSeconds: option('--window', quietDefaults.windowSeconds),
		intervalSeconds: option('--interval', quietDefaults.intervalSeconds),
		maxBusyCores: option('--max-busy', quietDefaults.maxBusyCores),
	});
	const result = await waitForQuiet(policy, {
		wait: args.includes('--wait'),
		timeoutSeconds: option('--timeout', 0),
		onSample: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
	});
	return result.quiet ? 0 : result.timedOut ? 3 : 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	process.exitCode = await main(process.argv.slice(2));
