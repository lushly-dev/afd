#!/usr/bin/env node
// Step C5's rerun of phase 0's tasks: phase 0's harness (../prototype/run.mjs), with arm a as it
// was and arm c calling the real `components-brief` over MCP, served by
// scripts/umbel-components.mjs from this repository, one Umbel workspace per slot. Each session
// runs in a worktree of `--repo` reset to `--base`: a repository holding one commit, a snapshot of
// this one without docs/features/active/component-briefs, so no session can read the tasks or what
// is counted, in the tree or in its history.
//
//   node run.mjs --repo <snapshot repo> --base <commit> --work <dir> --out <dir> --binary <path>
//                [--slots 5] [--runs 5] [--only t2:c:1,...]
//
// A job whose meta.json already exists is skipped, so a stopped run resumes.
import { spawn, spawnSync } from 'node:child_process';
import {
	copyFileSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const TIMEOUT_MS = 25 * 60 * 1000;
const option = (name, fallback) => {
	const index = process.argv.indexOf(`--${name}`);
	return index < 0 ? fallback : process.argv[index + 1];
};
const repo = resolve(option('repo'));
const work = resolve(option('work'));
const BASE = option('base');
const binary = resolve(option('binary'));
const out = resolve(option('out'));
const slots = Number(option('slots', 5));
const runs = Number(option('runs', 5));
const only = option('only')?.split(',');

const { preamble, tasks } = JSON.parse(
	readFileSync(join(import.meta.dirname, '../prototype/tasks.json'), 'utf8')
);
const { arms } = JSON.parse(readFileSync(join(import.meta.dirname, 'arms.json'), 'utf8'));
const launcher = resolve(import.meta.dirname, '../../../../../scripts/umbel-components.mjs');

/** Arm c's MCP configuration for one slot: the repository's launcher, a workspace of its own. */
function mcpConfig(slot) {
	const path = join(work, `mcp-${slot}.json`);
	const server = {
		command: process.execPath,
		args: [launcher],
		env: {
			UMBEL_FIRST_PARTY: binary,
			UMBEL_COMPONENTS_WORKSPACE: join(work, `umbel-${slot}`),
		},
	};
	writeFileSync(path, JSON.stringify({ mcpServers: { umbel: server } }, null, '\t'));
	return path;
}

const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

function worktree(slot) {
	const path = join(work, `w${slot}`);
	if (!existsSync(path)) {
		const added = git(repo, 'worktree', 'add', '--detach', path, BASE);
		if (added.status !== 0) throw new Error(added.stderr);
	}
	// Reset and clean discard work, so only ever in a worktree of its own that this repository
	// registered: a plain directory here would make git act on the checkout that encloses it.
	const top = git(path, 'rev-parse', '--show-toplevel').stdout.trim();
	const registered = git(repo, 'worktree', 'list', '--porcelain').stdout.split('\n');
	if (!top || realpathSync(top) !== realpathSync(path) || !registered.includes(`worktree ${top}`))
		throw new Error(`${path} is not a worktree of ${repo}; refusing to reset it`);
	for (const args of [
		['reset', '--hard', '-q', BASE],
		['clean', '-fdxq'],
	]) {
		const done = git(path, ...args);
		if (done.status !== 0)
			throw new Error(`git ${args.join(' ')} failed in ${path}: ${done.stderr}`);
	}
	return path;
}

function runJob({ task, arm, run }, slot) {
	const directory = join(out, task, arm, String(run));
	mkdirSync(directory, { recursive: true });
	const cwd = worktree(slot);
	const prompt = [preamble, tasks[task].text, arms[arm]].filter(Boolean).join('\n\n');
	const args = [
		'-p',
		...['--model', 'sonnet', '--effort', 'medium'],
		...['--output-format', 'stream-json', '--verbose', '--no-session-persistence'],
		...['--setting-sources', 'project', '--strict-mcp-config', '--permission-mode', 'acceptEdits'],
		...['--disallowedTools', 'Agent', 'Task', 'WebFetch', 'WebSearch', 'Workflow'],
		'--allowedTools',
		...['Read', 'Glob', 'Grep', 'Write', 'Edit'],
		...['node', 'ls', 'cat', 'grep', 'rg', 'find', 'head', 'tail', 'wc', 'sed', 'git'].map(
			(command) => `Bash(${command}:*)`
		),
		...(arm === 'c' ? ['mcp__umbel', '--mcp-config', mcpConfig(slot)] : []),
	];
	const env = { ...process.env };
	for (const name of Object.keys(env)) if (/^CLAUDE_?CODE|^CLAUDECODE/.test(name)) delete env[name];

	return new Promise((done) => {
		const started = Date.now();
		const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
		const stream = createWriteStream(join(directory, 'stream.jsonl'));
		let text = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			text += chunk;
			stream.write(chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.stdin.end(prompt);
		const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
		child.on('close', (code) => {
			clearTimeout(timer);
			stream.end();
			const toolCalls = {};
			let result;
			let model;
			for (const line of text.split('\n')) {
				if (!line.trim()) continue;
				let event;
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				if (event.type === 'assistant')
					for (const block of event.message?.content ?? [])
						if (block.type === 'tool_use') toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
				if (event.type === 'system' && event.subtype === 'init') model = event.model;
				if (event.type === 'result') result = event;
			}
			const produced = join(cwd, tasks[task].file);
			const wrote = existsSync(produced);
			if (wrote) copyFileSync(produced, join(directory, 'page.stories.ts'));
			const usage = result?.usage ?? {};
			const input =
				(usage.input_tokens ?? 0) +
				(usage.cache_creation_input_tokens ?? 0) +
				(usage.cache_read_input_tokens ?? 0);
			const meta = {
				task,
				arm,
				run,
				model,
				exit: code,
				wrote,
				otherChanges: git(cwd, 'status', '--porcelain')
					.stdout.split('\n')
					.filter((line) => line && !line.includes('src/phase0/')),
				elapsedMs: Date.now() - started,
				turns: result?.num_turns,
				tokens: {
					input,
					output: usage.output_tokens ?? 0,
					total: input + (usage.output_tokens ?? 0),
				},
				usage,
				costUsd: result?.total_cost_usd,
				toolCalls,
				toolCallCount: Object.values(toolCalls).reduce((sum, count) => sum + count, 0),
				final: result?.result?.slice(0, 600),
				error: result
					? result.is_error
						? result.subtype
						: undefined
					: stderr.slice(0, 600) || 'no result',
			};
			writeFileSync(join(directory, 'meta.json'), JSON.stringify(meta, null, '\t'));
			console.log(
				`${task}:${arm}:${run} exit ${code} wrote ${wrote} tokens ${meta.tokens.total} calls ${meta.toolCallCount} ${Math.round(meta.elapsedMs / 1000)}s`
			);
			done(meta);
		});
	});
}

// Every job, interleaved so no arm runs all at one time of day: run by run, task by task, arm by arm.
const jobs = [];
for (let run = 1; run <= runs; run++)
	for (const task of Object.keys(tasks))
		for (const arm of Object.keys(arms)) jobs.push({ task, arm, run });
const wanted = jobs.filter(
	(job) =>
		(!only || only.includes(`${job.task}:${job.arm}:${job.run}`)) &&
		!existsSync(join(out, job.task, job.arm, String(job.run), 'meta.json'))
);
console.log(`${wanted.length} jobs to run, ${slots} at a time`);

let next = 0;
await Promise.all(
	Array.from({ length: Math.min(slots, wanted.length) }, async (_, slot) => {
		while (next < wanted.length) await runJob(wanted[next++], slot + 1);
	})
);
console.log('done');
