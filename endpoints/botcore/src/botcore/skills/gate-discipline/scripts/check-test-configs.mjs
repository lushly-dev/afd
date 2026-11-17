#!/usr/bin/env node
/**
 * Refuses a test runner that may pass having run no tests.
 *
 * Vitest's `passWithNoTests` turns "no test file matched" into a pass, so a broken `include`,
 * a moved directory or a renamed suffix leaves a package green with nothing run. A package
 * with no tests yet adds its first test with its config instead. This reads every Vitest or
 * Vite config git tracks or would track, and fails on the option; and every package.json,
 * GitHub workflow and Lefthook config, which start runners, and fails on the CLI flag.
 *
 * Needs only Node and git. Usage:
 *   node check-test-configs.mjs [--root <dir>] [<path>...]
 * Each path (a file or a directory) adds more files that start runners, such as a repository's
 * own scripts, to the scan for the flag. A path that lists no file fails.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG =
	/(^|\/)(vitest|vite)(\.[\w-]+)?\.config(\.[\w-]+)?\.[cm]?[jt]s$|(^|\/)vitest\.(workspace|projects)\.[cm]?[jt]s$/;
const LAUNCHER = /(^|\/)package\.json$|^\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)lefthook\.ya?ml$/;
// A key, quoted or not, with any value but a literal `false` (`true`, `!0` and a variable may
// all enable it), or shorthand `{ passWithNoTests }`. A commented line is flagged too: fails safe.
const OPTION = /\bpassWithNoTests['"]?\s*(:(?!\s*false\b)|[,}])/;
const FLAG = /--pass-?[Ww]ith-?[Nn]o-?[Tt]ests\b/;

/** A path as git prints it: forward slashes, no leading `./`, no trailing slash. */
const gitPath = (path) =>
	path
		.replaceAll('\\', '/')
		.replace(/^(\.\/)+/, '')
		.replace(/\/+$/, '');
const under = (file, path) => file === path || file.startsWith(`${path}/`);

/** Every file git tracks, or would track, under `root`. */
function listedFiles(root) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
	const out = execFileSync(
		'git',
		['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
		{
			cwd: root,
			encoding: 'utf8',
			env,
			maxBuffer: 64 * 1024 * 1024,
		}
	);
	return out.split('\0').filter(Boolean);
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

export function check(root, given = []) {
	const extra = given.map(gitPath);
	const listed = listedFiles(root);
	const files = listed.filter(
		(file) => CONFIG.test(file) || LAUNCHER.test(file) || extra.some((path) => under(file, path))
	);
	// A path that lists nothing (a typo, a moved directory) would scan less and still pass.
	const problems = extra
		.filter((path) => !listed.some((file) => under(file, path)))
		.map((path) => `${path}: git lists no file there, so nothing was scanned`);
	for (const file of files) {
		let text;
		try {
			text = readFileSync(resolve(root, file), 'utf8');
		} catch {
			continue; // listed by git but deleted in the working tree
		}
		problems.push(...findings(file, text));
	}
	return { files: files.length, problems };
}

// Compare real paths: run through a symlinked skills folder, argv names the link while
// import.meta.url names the target, and a plain comparison would skip the check and exit 0.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	let root = process.cwd();
	const extra = [];
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--root') root = resolve(argv[++i]);
		else extra.push(argv[i]);
	}
	const { files, problems } = check(root, extra);
	if (problems.length > 0) {
		console.error(`Test config check failed:\n- ${problems.join('\n- ')}`);
		console.error(
			'Remove it. A package with no tests yet adds its first test with its config; a runner that finds none must fail.'
		);
		process.exit(1);
	}
	console.log(`Test config check passed (${files} configs and launchers)`);
}
