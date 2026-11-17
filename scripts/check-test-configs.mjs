#!/usr/bin/env node
/**
 * Refuses a test runner that may pass having run no tests.
 *
 * Vitest's `passWithNoTests` turns "no test file matched" into a pass, so a broken `include`,
 * a moved directory or a renamed suffix leaves a package green with nothing run. Every package
 * here has tests, so the flag is never needed: a new package adds its first test with its
 * config. This reads every Vitest or Vite config git tracks or would track, and fails on the
 * option; and every package.json, workflow, hook config and `scripts/affected` module, which
 * start runners, and fails on the CLI flag.
 *
 * Run: node scripts/check-test-configs.mjs [--root <dir>]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG =
	/(^|\/)(vitest|vite)(\.[\w-]+)?\.config(\.[\w-]+)?\.[cm]?[jt]s$|(^|\/)vitest\.(workspace|projects)\.[cm]?[jt]s$/;
const LAUNCHER =
	/(^|\/)package\.json$|^\.github\/workflows\/[^/]+\.ya?ml$|^lefthook\.ya?ml$|^scripts\/affected\/[^/]+\.mjs$/;
// A key, quoted or not, with any value but a literal `false` (`true`, `!0` and a variable may
// all enable it), or shorthand `{ passWithNoTests }`. A commented line is flagged too: fails safe.
const OPTION = /\bpassWithNoTests['"]?\s*(:(?!\s*false\b)|[,}])/;
const FLAG = /--pass-?[Ww]ith-?[Nn]o-?[Tt]ests\b/;

/** Files git tracks, or would track, under `root`. */
export function candidateFiles(root) {
	const out = execFileSync(
		'git',
		['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
		{
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		}
	);
	return out.split('\0').filter((file) => file && (CONFIG.test(file) || LAUNCHER.test(file)));
}

/** The findings for one file's text: each names the line and what it allows. */
export function findings(file, text) {
	const result = [];
	const config = CONFIG.test(file);
	text.split(/\r?\n/).forEach((line, index) => {
		const where = `${file}:${index + 1}`;
		if (config && OPTION.test(line)) {
			result.push(`${where}: passWithNoTests lets the suite pass when no test file matches`);
		}
		if (FLAG.test(line)) {
			result.push(`${where}: --passWithNoTests lets the suite pass when no test file matches`);
		}
	});
	return result;
}

export function check(root) {
	const files = candidateFiles(root);
	const problems = files.flatMap((file) => {
		let text;
		try {
			text = readFileSync(resolve(root, file), 'utf8');
		} catch {
			return []; // listed by git but deleted in the working tree
		}
		return findings(file, text);
	});
	return { files: files.length, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const rootIndex = process.argv.indexOf('--root');
	const root = rootIndex > -1 ? resolve(process.argv[rootIndex + 1]) : process.cwd();
	const { files, problems } = check(root);
	if (problems.length > 0) {
		console.error(`Test config check failed:\n- ${problems.join('\n- ')}`);
		console.error(
			'Remove it. A package with no tests yet adds its first test with its config; a runner that finds none must fail.'
		);
		process.exit(1);
	}
	console.log(`Test config check passed (${files} configs and launchers)`);
}
