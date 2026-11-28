#!/usr/bin/env node
/**
 * Refuses a test runner that may pass having run no tests.
 *
 * Vitest's `passWithNoTests` turns "no test file matched" into a pass, so a broken `include`,
 * a moved directory or a renamed suffix leaves a package green with nothing run. A package
 * with no tests yet adds its first test with its config instead. This reads every Vitest or
 * Vite config git tracks or would track, every root `vitest*` or `vite*` module and every module
 * a config imports by a relative path (a shared factory such as `vitest.package-config.ts` sets
 * the option for every config that calls it), and fails on the option; and every package.json,
 * GitHub workflow and Lefthook config, which start runners, and fails on the CLI flag.
 *
 * Needs only Node and git. Usage:
 *   node check-test-configs.mjs [--root <dir>] [<path>...]
 * Each path (a file or a directory) adds more files, such as a repository's own scripts or
 * config helpers, to the scan for the option and the flag. A path that lists no file fails.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG =
	/(^|\/)(vitest|vite)(\.[\w-]+)?\.config(\.[\w-]+)?\.[cm]?[jt]s$|(^|\/)vitest\.(workspace|projects)\.[cm]?[jt]s$/;
/** A Vitest or Vite module at the root that is not a config by name, such as a shared factory. */
const ROOT_MODULE = /^(vitest|vite)[\w.-]*\.[cm]?[jt]s$/;
const LAUNCHER = /(^|\/)package\.json$|^\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)lefthook\.ya?ml$/;
// A key, quoted, computed (`['passWithNoTests']`) or neither, or an assignment
// (`config.test.passWithNoTests = x`, `||=`, `??=`), with any value but a bare `false` (`true`, `!0`, a variable
// and `false || x` may all enable it), or shorthand `{ passWithNoTests }`. A bare `false` may be
// followed by block comments, then `,`, `}`, `;`, a line comment or the line's end. A commented
// line is flagged too: fails safe.
const OPTION =
	/\bpassWithNoTests['"`]?\s*\]?\s*((?::|(?:\|\||\?\?|&&)?=(?![=>]))(?!\s*false\s*(?:\/\*(?:[^*]|\*(?!\/))*\*\/\s*)*(?:[,};]|\/\/|$))|[,}])/;
// A relative specifier in an import, a re-export, a dynamic import or a require.
const RELATIVE_IMPORT =
	/(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*(['"])(\.{1,2}\/[^'"]*)\1/g;
const EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
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

/** The listed files that `file`'s relative imports name, resolved as Node and bundlers would. */
export function relativeImports(file, text, listed) {
	const result = [];
	for (const match of text.matchAll(RELATIVE_IMPORT)) {
		const target = posix.normalize(posix.join(posix.dirname(file), match[2])).replace(/\/+$/, '');
		if (target === '..' || target.startsWith('../')) continue; // outside the root
		const bare = target.replace(/\.[cm]?js$/, '');
		const found = [
			target,
			target.replace(/\.([cm]?)js$/, '.$1ts'), // `./x.js` names `x.ts` in TypeScript
			...EXTENSIONS.map((extension) => `${bare}${extension}`),
			...EXTENSIONS.map((extension) => `${target === '.' ? '' : `${target}/`}index${extension}`),
		].find((candidate) => listed.has(candidate));
		if (found) result.push(found);
	}
	return result;
}

/**
 * The findings for one file's text: each names the line and what it allows. The option counts in
 * a config or a root Vitest module by default; `check` also asks for it in a module a config
 * imports and in a path the caller adds.
 */
export function findings(file, text, option = CONFIG.test(file) || ROOT_MODULE.test(file)) {
	const result = [];
	text.split(/\r?\n/).forEach((line, index) => {
		const where = `${file}:${index + 1}`;
		if (option && OPTION.test(line)) {
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
	const texts = new Map();
	const read = (file) => {
		if (!texts.has(file)) {
			try {
				texts.set(file, readFileSync(resolve(root, file), 'utf8'));
			} catch {
				texts.set(file, null); // listed by git but deleted in the working tree
			}
		}
		return texts.get(file);
	};
	const added = (file) => extra.some((path) => under(file, path));
	const configLike = (file) => CONFIG.test(file) || ROOT_MODULE.test(file);
	// Read for the option: configs, root Vitest modules, added paths, and every module a config or
	// root module imports, followed to the end so a factory's own helpers are read too. An added
	// path is read but not followed, unless a config imports it.
	const option = new Set(listed.filter((file) => configLike(file) || added(file)));
	const listedSet = new Set(listed);
	const queue = listed.filter(configLike);
	const followed = new Set(queue);
	while (queue.length > 0) {
		const file = queue.pop();
		const text = read(file);
		if (text === null) continue;
		for (const imported of relativeImports(file, text, listedSet)) {
			if (followed.has(imported)) continue;
			followed.add(imported);
			option.add(imported);
			queue.push(imported);
		}
	}
	const files = listed.filter((file) => option.has(file) || LAUNCHER.test(file));
	// A path that lists nothing (a typo, a moved directory) would scan less and still pass.
	const problems = extra
		.filter((path) => !listed.some((file) => under(file, path)))
		.map((path) => `${path}: git lists no file there, so nothing was scanned`);
	for (const file of files) {
		const text = read(file);
		if (text !== null) problems.push(...findings(file, text, option.has(file)));
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
		if (problems.some((problem) => problem.includes('passWithNoTests')))
			console.error(
				'Remove passWithNoTests. A package with no tests yet adds its first test with its config; a runner that finds none must fail.'
			);
		process.exit(1);
	}
	console.log(`Test config check passed (${files} configs and launchers)`);
}
