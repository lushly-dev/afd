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
 *   - past that gate nothing names the `merge_group` event, and a job that can tell a pull
 *     request from its merge group (the event's name, the pull request's own fields) is listed
 *     in PULL_REQUEST_ONLY with its reason;
 *   - its paths use only the pattern syntax the queue job implements, and read the same two ways;
 *   - its concurrency group does not collide between merge groups, which have no pull request
 *     number;
 *   - `AFD_BASE` and `AFD_SCOPE`, where set, are the expressions that give a merge group its base.
 *
 *   node scripts/merge-group-contract.mjs      check .github/workflows; exit 1 with each problem
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesFilters, readTrigger } from './affected/suites.mjs';

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

/** The verdict's own workflow, which reads the event to know which commits and runs to check. */
const VERDICT = 'ci-ok.yml';
/** Pattern syntax GitHub reads in a path or branch filter that `filterPattern` does not. */
const UNSUPPORTED = /[?+[\]{}\\]/;
/** Comparisons that are false for a pull request and for its merge group alike. */
const BOTH_ALIKE = /github\.event_name\s*==\s*'(schedule|workflow_dispatch)'/g;
/** What can tell a pull request from its merge group: the event's name, or what only one has. */
const SETS_APART =
	/event_name|EVENT_NAME|github\.event\.pull_request\b|github\.(head|base)_ref\b|GITHUB_(HEAD|BASE)_REF/;
/** The lines of a job that can tell a pull request from its merge group. */
const settingApart = (block) =>
	block
		.split('\n')
		// AFD_BASE and AFD_SCOPE name the events to give a merge group its base; their own rule
		// holds them word for word.
		.filter((line) => !/^\s*(#|AFD_(BASE|SCOPE): )/.test(line))
		.filter((line) => SETS_APART.test(line.replace(BOTH_ALIKE, '')))
		.map((line) => line.trim());
/**
 * Jobs that run for a pull request and cannot run for its merge group, by workflow: the reason,
 * and the expression in the job that makes it so (`reads`). An entry fails once its job is gone,
 * no longer tells the two events apart, or no longer reads that.
 */
export const PULL_REQUEST_ONLY = {
	'umbel.yml': {
		'plugin-isolation': {
			reason:
				'checks the isolation statement in the pull request body; a merge group has no body, and the statement was checked on the pull request',
			reads: 'github.event.pull_request.body',
		},
	},
};

/** A status function in a job's `if` runs it although a job it needs was skipped. */
const STATUS_FUNCTION = /\b(always|cancelled|failure|success)\s*\(/;

/** A value without the comment that trails it; a value that is only a comment is empty. */
function uncommented(value) {
	let quote = null;
	for (let index = 0; index < value.length; index++) {
		const char = value[index];
		if (quote) {
			if (char === quote) quote = null;
		} else if (char === "'" || char === '"') quote = char;
		// A comment starts at a # that opens the value or follows white space, outside quotes.
		else if (char === '#' && (index === 0 || /\s/.test(value[index - 1])))
			return value.slice(0, index).trim();
	}
	return value.trim();
}

/**
 * A block's keys at `indent` spaces, each with its own line's value and the lines under it. A line
 * at that depth that is not a plain `key:` (a quoted key, a flow mapping, a list item) is refused:
 * skipped, it would hide a trigger or a job from every rule below.
 */
function entries(lines, indent) {
	const found = [];
	const key = new RegExp(`^ {${indent}}([\\w-]+):(\\s.*)?$`);
	const sibling = new RegExp(`^ {${indent}}[^\\s#]`);
	for (const line of lines) {
		const match = key.exec(line);
		if (match) found.push({ key: match[1], value: uncommented(match[2] ?? ''), lines: [] });
		else if (sibling.test(line)) throw new Error(`a key this check cannot read: "${line.trim()}"`);
		else if (found.length > 0) found.at(-1).lines.push(line);
		// Content before the first key sits at a depth this check does not read: keys indented
		// four spaces where it looks for two would all go unseen.
		else if (!/^\s*(#.*)?$/.test(line))
			throw new Error(`content this check cannot place: "${line.trim()}"`);
	}
	return found;
}

/** A YAML list written `[a, b]`, as one scalar, or as `- a` lines under the key. */
function list(entry) {
	// An alias or an anchor names a value written elsewhere, and a scalar holding white space is
	// more than one item: neither is the list it appears to be.
	const item = (value) => {
		const raw = value.trim();
		if (/^[*&]/.test(raw) || (!/^(['"]).*\1$/.test(raw) && /\s/.test(raw)))
			throw new Error(`a list item this check cannot read: "${raw}"`);
		return raw.replace(/^(['"])(.*)\1$/, '$2');
	};
	const flow = /^\[(.*)\]$/.exec(entry.value);
	if (flow) return flow[1].split(',').map(item).filter(Boolean);
	if (entry.value) return [item(entry.value)];
	const items = [];
	for (const line of entry.lines) {
		if (/^\s*(#.*)?$/.test(line)) continue;
		const listed = /^\s+- (.*)$/.exec(line);
		if (!listed) throw new Error(`a list this check cannot read: "${line.trim()}"`);
		items.push(item(uncommented(listed[1])));
	}
	return items;
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
	for (const name of ['pull_request', 'pull_request_target', 'merge_group'])
		if (triggers.get(name)?.value) throw new Error(`${name}: is not a block`);
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
	if (branches?.length === 0) throw new Error('pull_request.branches lists nothing');
	for (const pattern of branches ?? [])
		if (UNSUPPORTED.test(pattern))
			throw new Error(`the branch pattern ${pattern} uses syntax this check does not implement`);
	return {
		// A branch filter is a list of patterns, as a path filter is: `'**'` and `'mai*'` reach main.
		main: branches === null || matchesFilters(branches, 'main'),
		filtered: keys.has('paths'),
		paths: keys.has('paths') ? list(keys.get('paths')) : null,
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
		let pull;
		let read;
		try {
			workflow = readWorkflow(text);
			pull = pullRequest(workflow.triggers);
			// The queue job's own reader, which refuses a list it cannot read.
			read = readTrigger(text)?.paths ?? [];
		} catch (error) {
			say(`unreadable (${error.message})`);
			continue;
		}
		const { triggers, jobs, group } = workflow;
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
			// The queue job answers with scripts/affected/suites.mjs, so its reading is the one that
			// counts: it must be this one's, and hold no pattern syntax it does not implement.
			if (JSON.stringify(read) !== JSON.stringify(pull.paths))
				say(
					`its pull_request.paths read two ways differ: ${read.length} by the queue job's reader, ${pull.paths.length} listed`
				);
			for (const pattern of pull.paths.filter((candidate) => UNSUPPORTED.test(candidate)))
				say(
					`its path ${pattern} uses pattern syntax the queue job does not implement: only *, ** and a leading !`
				);
			for (const id of jobs.keys())
				if (id !== 'queue' && !gated(id, jobs))
					say(
						`job ${id} runs for every merge group: give it \`needs: queue\` and an \`if\` that opens with ` +
							`\`${GATE}\`, or let it need a job that has them and use no status function`
					);
		} else if (jobs.has('queue')) {
			say('has a `queue` job but no pull_request.paths for it to read');
		}

		// Past the gate, a merge group is treated as a pull request is. A condition that names the
		// event can run a job for the one and not the other while every rule above still holds.
		if (file !== VERDICT) {
			const rest = text
				.replace(jobs.get('queue')?.block ?? '\0', '')
				.split('\n')
				.filter((line) => !/^\s*#/.test(line) && !/^ {2}merge_group:\s*$/.test(line))
				.filter((line) => ![AFD_BASE, AFD_SCOPE].includes(line.trim()));
			for (const line of rest.filter((candidate) => candidate.includes('merge_group')))
				say(`names the merge_group event outside its queue job: "${line.trim()}"`);
		}
		const allowed = file === VERDICT ? {} : (PULL_REQUEST_ONLY[file] ?? {});
		for (const [id, job] of jobs) {
			if (id === 'queue' || file === VERDICT) continue;
			const apart = settingApart(job.block);
			const entry = allowed[id];
			if (!entry)
				for (const line of apart)
					say(
						`job ${id} can tell a pull request from its merge group: "${line}". Drop that, or list the job in PULL_REQUEST_ONLY with its reason`
					);
			else if (apart.length === 0 || !job.block.includes(entry.reads))
				say(
					`job ${id} is listed in PULL_REQUEST_ONLY but no longer reads ${entry.reads}: remove the entry`
				);
		}
		for (const id of Object.keys(allowed))
			if (!jobs.has(id))
				say(`PULL_REQUEST_ONLY lists job ${id}, which it does not have: remove the entry`);

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
