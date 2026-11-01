#!/usr/bin/env node
/**
 * Group the self time in Node `.cpuprofile` files by source package, per process role. Sampled
 * wall time on each main isolate: a share, not CPU seconds. A profile's role comes from the
 * main script it ran (a cold sample, the job harness, the isolated worker).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The package a file belongs to: the last `node_modules/<name>` segment of its path. */
export function packageOf(url) {
	const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/.exec(url);
	return match?.[1] ?? null;
}

const PACKAGES = [
	[
		/^(rolldown|@rolldown\/.*|oxc.*|@oxc-.*|esbuild|lightningcss.*)$/,
		'transform (rolldown/oxc/esbuild)',
	],
	[/^vite$/, 'vite'],
	[/^(playwright|playwright-core)$/, 'playwright'],
	[/^parse5$/, 'parse5'],
	[/^zod$/, 'zod'],
];

export function categorize(url, name) {
	if (name === '(idle)') return 'idle';
	if (name === '(garbage collector)') return 'gc';
	if (name === '(program)') return 'program';
	if (!url) return name === '(root)' ? 'root' : 'native/builtin';
	if (url.startsWith('node:internal/modules')) return 'module loading';
	if (url.startsWith('node:'))
		return `node:${url.replace(/^node:(internal\/)?/, '').split('/')[0]}`;
	const pkg = packageOf(url);
	if (pkg) {
		for (const [pattern, label] of PACKAGES) if (pattern.test(pkg)) return label;
		return `other (${pkg})`;
	}
	if (/\/specimen\/dist\//.test(url)) return 'specimen';
	if (/\/specimen\/experiments\//.test(url)) return 'experiment harness';
	return 'other';
}

const roleOf = (profile) => {
	const urls = new Set(profile.nodes.map((node) => node.callFrame.url));
	for (const [pattern, role] of [
		[/cold-sample\.mjs$/, 'cold-sample'],
		[/bench-worker\.js$/, 'worker'],
		[/run-consumers\.mjs$|run-batches\.mjs$/, 'harness'],
	])
		if ([...urls].some((url) => pattern.test(url))) return role;
	return 'unknown';
};

/** Self-time milliseconds by category for one profile. */
export function summarizeProfile(profile) {
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const deltas = profile.timeDeltas ?? [];
	const totals = {};
	for (let index = 0; index < profile.samples.length; index++) {
		const node = byId.get(profile.samples[index]);
		const key = categorize(node?.callFrame.url, node?.callFrame.functionName);
		totals[key] = (totals[key] ?? 0) + (deltas[index] ?? 0) / 1000;
	}
	return { role: roleOf(profile), totals };
}

/** Totals per role across every profile in a directory, with each category's share. */
export function summarizeDirectory(directory) {
	const roles = {};
	for (const file of readdirSync(directory).filter((name) => name.endsWith('.cpuprofile'))) {
		const { role, totals } = summarizeProfile(
			JSON.parse(readFileSync(join(directory, file), 'utf8'))
		);
		roles[role] ??= { profiles: 0, totals: {} };
		const target = roles[role];
		target.profiles++;
		for (const [key, value] of Object.entries(totals))
			target.totals[key] = (target.totals[key] ?? 0) + value;
	}
	for (const target of Object.values(roles)) {
		const busy = Object.entries(target.totals)
			.filter(([key]) => key !== 'idle')
			.reduce((sum, [, value]) => sum + value, 0);
		target.busyMs = Number(busy.toFixed(1));
		target.share = Object.fromEntries(
			Object.entries(target.totals)
				.filter(([key]) => key !== 'idle')
				.sort((a, b) => b[1] - a[1])
				.map(([key, value]) => [key, `${((value / busy) * 100).toFixed(1)}%`])
		);
		target.totals = Object.fromEntries(
			Object.entries(target.totals).map(([key, value]) => [key, Number(value.toFixed(1))])
		);
	}
	return roles;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	process.stdout.write(`${JSON.stringify(summarizeDirectory(process.argv[2]), null, 2)}\n`);
