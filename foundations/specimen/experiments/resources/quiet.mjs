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
export const FOREIGN_WORK =
	/ms-playwright\/|chrome-headless-shell|headless_shell|\bvitest\b|\bplaywright\b|storybook|run-browser-iteration|\bpytest\b|\bcargo\b|\brustc\b|xcodebuild|swift-frontend|\btsc\b|\bvite\b|\bwebpack\b|\bturbo\b/i;

/** Long-lived agent tool servers; they count only when they are actually busy. */
export const IDLE_SERVICES = /@playwright\/mcp|\bmcp-server\b|playwright-mcp/i;

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
	const needed = Math.floor(policy.windowSeconds / policy.intervalSeconds) + 1;
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

function ownFamily(processes) {
	const own = new Set([process.pid, process.ppid]);
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

async function sample(policy) {
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

async function main(args) {
	const option = (name, fallback) => {
		const index = args.indexOf(name);
		return index === -1 ? fallback : Number(args[index + 1]);
	};
	const policy = {
		...quietDefaults,
		windowSeconds: option('--window', quietDefaults.windowSeconds),
		intervalSeconds: option('--interval', quietDefaults.intervalSeconds),
		maxBusyCores: option('--max-busy', quietDefaults.maxBusyCores),
	};
	const timeoutSeconds = option('--timeout', 0);
	const started = Date.now();
	const samples = [];
	while (true) {
		const next = await sample(policy);
		samples.push(next);
		const verdict = quietVerdict(samples, policy);
		process.stdout.write(`${JSON.stringify({ sample: next, verdict })}\n`);
		if (verdict.quiet) return 0;
		if (!args.includes('--wait')) return 2;
		if (timeoutSeconds && Date.now() - started > timeoutSeconds * 1000) return 3;
		await pause(Math.max(0, policy.intervalSeconds * 1000 - policy.cpuWindowMs));
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	process.exitCode = await main(process.argv.slice(2));
