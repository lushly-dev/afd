#!/usr/bin/env node
/**
 * What a merge queue needs of the workflows, as a check: `ci-ok` is required on main, so the
 * queue asks for it on the commit it builds, and `ci-ok` there waits for every workflow that has
 * the `merge_group` trigger. A workflow that tests pull requests but lacks the trigger would test
 * nothing in the queue, silently; one with the trigger and no gate would run its whole suite for
 * every queued pull request, since no `paths` filter applies to a merge group.
 *
 * For every workflow file:
 *   - `pull_request` to main and `merge_group` come together, each implying the other;
 *   - with `pull_request.paths`, its first job is the `queue` job below, word for word, and every
 *     other job runs only when `queue` says so: it needs `queue` and its `if` opens with the
 *     gate, or it needs a job that does and has no status function to run past a skipped one;
 *   - without `paths` it has no `queue` job;
 *   - its concurrency group does not collide between merge groups, which have no pull request
 *     number;
 *   - `AFD_BASE` and `AFD_SCOPE`, where set, are the expressions that give a merge group its base.
 *
 *   node scripts/merge-group-contract.mjs      check .github/workflows; exit 1 with each problem
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AFD_BASE =
	"AFD_BASE: ${{ github.event_name == 'pull_request' && 'HEAD^1' || github.event.merge_group.base_sha || github.event.before }}";
export const AFD_SCOPE =
	"AFD_SCOPE: ${{ (github.event_name == 'pull_request' || github.event_name == 'push' || github.event_name == 'merge_group') && 'affected' || 'all' }}";
/** The condition that opens the `if` of a job that needs `queue`. */
export const GATE = "needs.queue.outputs.run == 'true'";

/** The `queue` job of a path-filtered workflow, which names its own file. */
export const queueJob = (file) => `  queue:
    # A merge group starts every workflow, whatever its \`paths\`. The jobs below run for one only
    # when the files it changes match this workflow's own pull_request.paths; every other event
    # passes straight through (scripts/affected.mjs trigger).
    name: Merge queue paths
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      run: \${{ steps.paths.outputs.run }}
    steps:
      - if: github.event_name == 'merge_group'
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          filter: blob:none
      - id: paths
        env:
          ${AFD_BASE}
        run: |
          if [ "$GITHUB_EVENT_NAME" = merge_group ]; then
            node scripts/affected.mjs trigger ${file}
          else
            echo "run=true" >> "$GITHUB_OUTPUT"
          fi`;

/** A status function in a job's `if` runs it although a job it needs was skipped. */
const STATUS_FUNCTION = /\b(always|cancelled|failure|success)\s*\(/;

/** A block's keys at `indent` spaces, each with its own line's value and the lines under it. */
function entries(lines, indent) {
	const found = [];
	const key = new RegExp(`^ {${indent}}([\\w-]+):(.*)$`);
	for (const line of lines) {
		const match = key.exec(line);
		if (match) found.push({ key: match[1], value: match[2].trim(), lines: [] });
		else if (found.length > 0) found.at(-1).lines.push(line);
	}
	return found;
}

/** A YAML list written `[a, b]`, as one scalar, or as `- a` lines under the key. */
function list(entry) {
	const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
	const flow = /^\[(.*)\]$/.exec(entry.value);
	if (flow) return flow[1].split(',').map(unquote).filter(Boolean);
	if (entry.value && !entry.value.startsWith('#')) return [unquote(entry.value)];
	return entry.lines
		.map((line) => /^\s+- (.*?)(\s+#.*)?$/.exec(line)?.[1])
		.filter(Boolean)
		.map(unquote);
}

/** A scalar written on its key's line, or folded (`>-`, `|`) onto the lines under it. */
function scalar(entry) {
	const text = /^[>|][+-]?$/.test(entry.value)
		? entry.lines.map((line) => line.trim()).join(' ')
		: entry.value;
	return text
		.trim()
		.replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1')
		.trim();
}

/** The parts of a workflow this contract reads. Throws on a shape it cannot read. */
export function readWorkflow(text) {
	const lines = text.replaceAll('\r\n', '\n').split('\n');
	const top = entries(lines, 0);
	const one = (name) => {
		const found = top.filter((entry) => entry.key === name);
		if (found.length > 1) throw new Error(`more than one top-level ${name}:`);
		return found[0];
	};
	const on = one('on');
	if (!on || on.value) throw new Error('`on:` is not a block of triggers');
	const triggers = new Map(entries(on.lines, 2).map((entry) => [entry.key, entry]));
	const jobs = new Map();
	for (const entry of entries(one('jobs')?.lines ?? [], 2)) {
		const keys = entries(entry.lines, 4);
		const key = (name) => keys.find((candidate) => candidate.key === name);
		jobs.set(entry.key, {
			block: [`  ${entry.key}:`, ...entry.lines].join('\n').trimEnd(),
			needs: key('needs') ? list(key('needs')) : [],
			if: key('if') ? scalar(key('if')) : null,
		});
	}
	if (jobs.size === 0) throw new Error('no jobs');
	const concurrency = one('concurrency');
	const group = concurrency
		? concurrency.value ||
			entries(concurrency.lines, 2).find((entry) => entry.key === 'group')?.value
		: null;
	return { triggers, jobs, group };
}

/** Whether the pull_request trigger covers pull requests into main, and how it filters them. */
function pullRequest(triggers) {
	const trigger = triggers.get('pull_request');
	if (!trigger) return null;
	const keys = new Map(entries(trigger.lines, 4).map((entry) => [entry.key, entry]));
	const branches = keys.has('branches') ? list(keys.get('branches')) : null;
	return {
		main: branches === null || branches.includes('main'),
		filtered: keys.has('paths'),
		unreadable: ['paths-ignore', 'branches-ignore'].filter((name) => keys.has(name)),
	};
}

/** Whether `rest`, what follows the gate and `&&`, can only narrow it: no `||` beside the gate. */
function narrows(rest) {
	if (!rest.includes('||')) return true;
	if (!rest.startsWith('(')) return false;
	let depth = 0;
	for (let index = 0; index < rest.length; index++) {
		if (rest[index] === '(') depth++;
		else if (rest[index] === ')' && --depth === 0) return index === rest.length - 1;
	}
	return false;
}

/** Whether a job runs only when `queue` passed the merge group, directly or through its needs. */
function gated(id, jobs, seen = new Set()) {
	const job = jobs.get(id);
	if (!job || seen.has(id)) return false;
	seen.add(id);
	const condition = job.if ?? '';
	if (job.needs.includes('queue'))
		return (
			condition === GATE ||
			(condition.startsWith(`${GATE} && `) && narrows(condition.slice(GATE.length + 4)))
		);
	return (
		!STATUS_FUNCTION.test(condition) && job.needs.some((need) => gated(need, jobs, new Set(seen)))
	);
}

/**
 * Every way the workflows fall short of the contract.
 * @param {Record<string, string>} workflows file name to text
 */
export function mergeGroupProblems(workflows) {
	const problems = [];
	for (const [file, text] of Object.entries(workflows).sort(([a], [b]) => a.localeCompare(b))) {
		const say = (problem) => problems.push(`${file}: ${problem}`);
		let workflow;
		try {
			workflow = readWorkflow(text);
		} catch (error) {
			say(`unreadable (${error.message})`);
			continue;
		}
		const { triggers, jobs, group } = workflow;
		const pull = pullRequest(triggers);
		const queued = triggers.has('merge_group');
		if (pull?.main && !queued)
			say(
				'runs on pull requests to main but has no merge_group trigger, so a merge queue would not run it'
			);
		if (queued && !pull?.main)
			say(
				'has the merge_group trigger without a pull_request trigger on main to take its paths from'
			);
		if (!queued) {
			if (jobs.has('queue') && /affected\.mjs trigger/.test(jobs.get('queue').block))
				say('has a queue job but no merge_group trigger');
			continue;
		}
		if (/^\s+branches(-ignore)?:/m.test(triggers.get('merge_group').lines.join('\n')))
			say('filters merge_group by branch; the queue for main must always start it');
		for (const name of pull?.unreadable ?? [])
			say(`filters pull requests with ${name}, which the queue job cannot read: use paths`);

		if (pull?.filtered) {
			if (jobs.get('queue')?.block !== queueJob(file))
				say(
					'its `queue` job is missing or differs from the one scripts/merge-group-contract.mjs gives'
				);
			if ([...jobs.keys()][0] !== 'queue') say('`queue` is not its first job');
			for (const id of jobs.keys())
				if (id !== 'queue' && !gated(id, jobs))
					say(
						`job ${id} runs for every merge group: give it \`needs: queue\` and an \`if\` that opens with ` +
							`\`${GATE}\`, or let it need a job that has them and use no status function`
					);
		} else if (jobs.has('queue')) {
			say('has a `queue` job but no pull_request.paths for it to read');
		}

		if (group != null) {
			const numbered = group.includes('github.event.pull_request.number');
			const unique = /github\.(sha|run_id)\b|github\.event\.merge_group\.head_sha/.test(group);
			if (!unique || (numbered && !/github\.event\.pull_request\.number \|\| /.test(group)))
				say(
					'its concurrency group is the same for every merge group: fall back to github.sha where ' +
						'there is no pull request number'
				);
		}
		for (const [name, canonical] of [
			['AFD_BASE', AFD_BASE],
			['AFD_SCOPE', AFD_SCOPE],
		])
			for (const line of text.match(new RegExp(`^\\s*${name}: .*$`, 'gm')) ?? [])
				if (line.trim() !== canonical) say(`${name} is not \`${canonical}\``);
	}
	return problems;
}

/** The repository's workflows, by file name. */
export function readWorkflows(root) {
	const directory = join(root, '.github/workflows');
	return Object.fromEntries(
		readdirSync(directory)
			.filter((file) => /\.ya?ml$/.test(file))
			.map((file) => [file, readFileSync(join(directory, file), 'utf8')])
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const workflows = readWorkflows(root);
	const problems = mergeGroupProblems(workflows);
	for (const problem of problems) console.error(`merge-group-contract: ${problem}`);
	if (problems.length > 0) process.exitCode = 1;
	else console.log(`merge-group-contract: ${Object.keys(workflows).length} workflow(s) hold`);
}
