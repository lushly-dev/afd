#!/usr/bin/env node
// Phase 0: reads every run's meta.json, eval.json and review.json and prints the arms' scores,
// costs, and which arm beats which by the thresholds fixed in baseline.md. Throwaway.
//
//   node summarize.mjs <results dir> [--json]    from the raw runs (not committed)
//   node summarize.mjs results.json [--json]     from the rows that an earlier --json run printed
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const results = resolve(process.argv[2]);
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const CHECKS = ['complete', 'mounts', 'accessible', 'manifest', 'taxonomy'];
const fromRuns = [];
for (const task of statSync(results).isFile() ? [] : readdirSync(results))
	for (const arm of readdirSync(join(results, task)))
		for (const run of readdirSync(join(results, task, arm))) {
			const directory = join(results, task, arm, run);
			const meta = read(join(directory, 'meta.json'));
			const evaluation = read(join(directory, 'eval.json'));
			const review = read(join(directory, 'review.json'));
			if (!meta) continue;
			const checks = {
				...(evaluation?.checks ?? {}),
				taxonomy: meta.wrote && review && !review.error ? review.violations.length === 0 : false,
			};
			fromRuns.push({
				task,
				arm,
				run: Number(run),
				checks,
				score: CHECKS.filter((check) => checks[check]).length,
				tokens: meta.tokens.total,
				output: meta.tokens.output,
				calls: meta.toolCallCount,
				cost: meta.costUsd ?? 0,
				seconds: Math.round(meta.elapsedMs / 1000),
				wrote: meta.wrote,
				otherChanges: meta.otherChanges.length,
				missing: evaluation?.missing ?? [],
				manifestProblems: evaluation?.manifestProblems ?? [],
				taxonomyViolations: review?.violations?.length ?? null,
				reviewError: review?.error,
				violations: Object.values(evaluation?.stories ?? {}).flatMap(
					(story) => story.violations ?? []
				),
			});
		}
const rows = statSync(results).isFile() ? read(results).rows : fromRuns;

const arms = [...new Set(rows.map((row) => row.arm))].sort();
const tasks = [...new Set(rows.map((row) => row.task))].sort();
const summary = Object.fromEntries(
	arms.map((arm) => {
		const mine = rows.filter((row) => row.arm === arm);
		return [
			arm,
			{
				runs: mine.length,
				score: mine.reduce((sum, row) => sum + row.score, 0),
				checks: Object.fromEntries(
					CHECKS.map((check) => [check, mine.filter((row) => row.checks[check]).length])
				),
				byTask: Object.fromEntries(
					tasks.map((task) => [
						task,
						mine.filter((row) => row.task === task).reduce((sum, row) => sum + row.score, 0),
					])
				),
				tokens: {
					median: median(mine.map((row) => row.tokens)),
					min: Math.min(...mine.map((row) => row.tokens)),
					max: Math.max(...mine.map((row) => row.tokens)),
				},
				output: median(mine.map((row) => row.output)),
				calls: {
					median: median(mine.map((row) => row.calls)),
					min: Math.min(...mine.map((row) => row.calls)),
					max: Math.max(...mine.map((row) => row.calls)),
				},
				cost: mine.reduce((sum, row) => sum + row.cost, 0),
				seconds: median(mine.map((row) => row.seconds)),
			},
		];
	})
);

// The thresholds of baseline.md.
const better = (x, y) => summary[x].score - summary[y].score >= 8;
const asGood = (x, y) => Math.abs(summary[x].score - summary[y].score) <= 7;
const cheaper = (x, y) =>
	summary[x].tokens.median <= summary[y].tokens.median * 0.8 &&
	summary[x].calls.median <= summary[y].calls.median;
const costlier = (x, y) => summary[x].tokens.median >= summary[y].tokens.median * 1.2;
const beats = (x, y) => (better(x, y) && !costlier(x, y)) || (asGood(x, y) && cheaper(x, y));
const relations = {};
for (const x of arms) for (const y of arms) if (x !== y) relations[`${x}>${y}`] = beats(x, y);

function decide() {
	const b = (x, y) => relations[`${x}>${y}`];
	if (!['b', 'c', 'd', 'e'].some((arm) => b(arm, 'a'))) return '1. Stop: no arm beats a';
	if (b('b', 'a') && !['c', 'd', 'e'].some((arm) => b(arm, 'b')))
		return '2. The serving half changes: b beats a and nothing beats b';
	if (b('c', 'a'))
		return `3. Go, the brief as planned${b('e', 'c') ? '; the check joins phase C' : ''}`;
	if (b('d', 'a') && !b('e', 'd')) return '4. The check leads';
	if (b('e', 'a')) return '5. Both together';
	return '6. No clear result';
}

if (process.argv.includes('--json')) {
	console.log(JSON.stringify({ summary, relations, decision: decide(), rows }, null, '\t'));
} else {
	const n = (value) => Math.round(value).toLocaleString('en-US').replaceAll(',', ' ');
	console.log(
		'| Arm | Runs | Score of 75 | Complete | Mounts | Accessible | In manifest | Taxonomy | Median tokens (range) | Median output | Median calls (range) | Total cost |'
	);
	console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const arm of arms) {
		const s = summary[arm];
		console.log(
			`| ${arm} | ${s.runs} | ${s.score} | ${CHECKS.map((check) => s.checks[check]).join(' | ')} | ${n(s.tokens.median)} (${n(s.tokens.min)} to ${n(s.tokens.max)}) | ${n(s.output)} | ${s.calls.median} (${s.calls.min} to ${s.calls.max}) | $${s.cost.toFixed(2)} |`
		);
	}
	console.log();
	console.log(
		`By task: ${arms.map((arm) => `${arm} ${tasks.map((task) => `${task}=${summary[arm].byTask[task]}`).join(' ')}`).join(' | ')}`
	);
	console.log(
		`Beats: ${
			Object.entries(relations)
				.filter(([, yes]) => yes)
				.map(([pair]) => pair)
				.join(', ') || 'none'
		}`
	);
	console.log(`Decision: ${decide()}`);
	const problems = rows.filter((row) => !row.wrote || row.otherChanges || row.reviewError);
	for (const row of problems)
		console.log(
			`note ${row.task}:${row.arm}:${row.run} wrote=${row.wrote} otherChanges=${row.otherChanges} ${row.reviewError ?? ''}`
		);
}
