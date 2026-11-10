#!/usr/bin/env node
// Phase 0, acceptance check 5: a fresh reviewer per page, given only the page and the attribute
// taxonomy, lists uses that a `doNotUseFor` entry rules out. Blind: the reviewer sees a random
// directory name and the file as `page.ts`. Throwaway.
//
//   node review.mjs <results dir> <attribute-taxonomy.jsonc> <scratch dir> [--slots 5]
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [results, taxonomy, scratch] = process.argv.slice(2, 5).map((path) => resolve(path));
const slotsAt = process.argv.indexOf('--slots');
const slots = slotsAt < 0 ? 5 : Number(process.argv[slotsAt + 1]);

const PROMPT = `Two files are in this directory: page.ts, a page built with a web component library, and attribute-taxonomy.jsonc, the library's rules for what each shared attribute name means.

Each entry under "attributes" in the taxonomy may have a "doNotUseFor" list. Read both files. List every place where page.ts uses one of those attributes on a library component (a tag starting with "violet-") for a purpose that the attribute's own "doNotUseFor" list rules out. Count only uses that a "doNotUseFor" item clearly rules out; a use you merely find unusual does not count, and neither does anything the taxonomy does not mention.

Reply with JSON only, no prose and no code fence:
{"violations":[{"line":<line number in page.ts>,"attribute":"<name>","quote":"<the line of page.ts>","rule":"<the doNotUseFor item it breaks>"}]}
If there are none, reply {"violations":[]}.`;

const jobs = [];
for (const task of readdirSync(results))
	for (const arm of readdirSync(join(results, task)))
		for (const run of readdirSync(join(results, task, arm))) {
			const directory = join(results, task, arm, run);
			if (
				!existsSync(join(directory, 'page.stories.ts')) ||
				existsSync(join(directory, 'review.json'))
			)
				continue;
			jobs.push(directory);
		}
// Random order, so nothing about a page's place in the queue tells its arm.
jobs.sort(() => randomBytes(1)[0] - 128);
console.log(`${jobs.length} pages to review`);

function review(directory) {
	const cwd = join(scratch, randomBytes(6).toString('hex'));
	mkdirSync(cwd, { recursive: true });
	copyFileSync(join(directory, 'page.stories.ts'), join(cwd, 'page.ts'));
	copyFileSync(taxonomy, join(cwd, 'attribute-taxonomy.jsonc'));
	const env = { ...process.env };
	for (const name of Object.keys(env)) if (/^CLAUDE_?CODE|^CLAUDECODE/.test(name)) delete env[name];
	const args = [
		'-p',
		...[
			'--model',
			'sonnet',
			'--effort',
			'medium',
			'--output-format',
			'json',
			'--no-session-persistence',
		],
		...['--setting-sources', 'project', '--strict-mcp-config', '--allowedTools', 'Read'],
		...['--disallowedTools', 'Agent', 'Task', 'WebFetch', 'WebSearch', 'Bash', 'Write', 'Edit'],
	];
	return new Promise((done) => {
		const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
		let text = '';
		child.stdout.on('data', (chunk) => {
			text += chunk;
		});
		child.stdin.end(PROMPT);
		const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
		child.on('close', () => {
			clearTimeout(timer);
			let verdict = { error: 'no answer' };
			try {
				const answer = JSON.parse(text).result ?? '';
				const body = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
				verdict = JSON.parse(body);
			} catch (error) {
				verdict = { error: String(error).slice(0, 200), raw: text.slice(0, 400) };
			}
			writeFileSync(join(directory, 'review.json'), JSON.stringify(verdict, null, '\t'));
			console.log(
				`${directory.split('/').slice(-3).join(':')} ${verdict.error ? 'ERROR' : verdict.violations.length}`
			);
			done();
		});
	});
}

let next = 0;
await Promise.all(
	Array.from({ length: Math.min(slots, jobs.length) }, async () => {
		while (next < jobs.length) await review(jobs[next++]);
	})
);
console.log('done');
