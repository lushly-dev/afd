/**
 * Pure Node parsers for `check-test-discovery.mjs`: globs, runner configs (Vitest, Vite,
 * Playwright, Jest, pytest, Cargo, CMake), workspace manifests and CI/hook shell commands.
 */
import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { maskSource } from './check-test-quarantine.mjs';

export const CPP_TEST_FILE = /\.(?:cpp|cc|cxx)$/;

/** Non-hook top-level keys in `lefthook.yml`. */
const LEFTHOOK_META_KEYS = new Set([
	'assert_lefthook_installed',
	'colors',
	'extends',
	'min_version',
	'no_tty',
	'output',
	'rc',
	'remote',
	'remotes',
	'skip_output',
	'source_dir',
	'source_dir_local',
	'templates',
]);

/** Normalizes a repository-relative path to git's forward-slash form with no leading `./`. */
export const gitPath = (value) =>
	value
		.replaceAll('\\', '/')
		.replace(/^(\.\/)+/, '')
		.replace(/\/+$/, '');

export const joinPosix = (base, rel) => {
	const cleaned = rel.replaceAll('\\', '/');
	const joined =
		!base || base === '.' ? posix.normalize(cleaned) : posix.normalize(`${base}/${cleaned}`);
	return joined === '.' ? '' : joined.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
};

export const under = (file, prefix) => !prefix || file === prefix || file.startsWith(`${prefix}/`);

export const dirOf = (file) => {
	const dir = posix.dirname(file);
	return dir === '.' ? '' : dir;
};

export function readText(root, file) {
	try {
		return readFileSync(resolve(root, file), 'utf8');
	} catch {
		return null;
	}
}

export function findMatching(text, openIndex, openChar, closeChar) {
	let depth = 0;
	for (let i = openIndex; i < text.length; i++) {
		if (text[i] === openChar) depth += 1;
		else if (text[i] === closeChar && --depth === 0) return i;
	}
	return -1;
}

export function splitTopLevel(text, sep) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '{' || c === '(' || c === '[') depth += 1;
		else if (c === '}' || c === ')' || c === ']') depth -= 1;
		else if (c === sep && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}

/** Converts a glob pattern (`**`, `*`, `?`, `{a,b}`, `?(a|b)`, `@(a|b)`, `[...]`) to a RegExp. */
export function globToRegExp(glob) {
	const clean = gitPath(glob);
	const convert = (src) => {
		let out = '';
		for (let i = 0; i < src.length; i++) {
			const c = src[i];
			if (c === '*' && src[i + 1] === '*') {
				const slash = src[i + 2] === '/' && (i === 0 || src[i - 1] === '/');
				out += slash ? '(?:.*/)?' : '.*';
				i += slash ? 2 : 1;
			} else if ((c === '?' || c === '@') && src[i + 1] === '(') {
				const close = findMatching(src, i + 1, '(', ')');
				if (close !== -1) {
					const alts = splitTopLevel(src.slice(i + 2, close), '|').map(convert);
					out += c === '?' ? `(?:${alts.join('|')})?` : `(?:${alts.join('|')})`;
					i = close;
				} else {
					out += c === '?' ? '[^/]' : '@';
				}
			} else if (c === '{') {
				const close = findMatching(src, i, '{', '}');
				if (close !== -1) {
					const alts = splitTopLevel(src.slice(i + 1, close), ',').map(convert);
					out += `(?:${alts.join('|')})`;
					i = close;
				} else {
					out += '\\{';
				}
			} else if (c === '[') {
				const close = src.indexOf(']', i + 1);
				if (close !== -1) {
					out += src.slice(i, close + 1);
					i = close;
				} else {
					out += '\\[';
				}
			} else if (c === '*') out += '[^/]*';
			else if (c === '?') out += '[^/]';
			else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
		}
		return out;
	};
	return new RegExp(`^${convert(clean)}$`);
}

// ---------------------------------------------------------------------------
// JS/TS literal & object extractors (masked structure, raw string slices)
// ---------------------------------------------------------------------------

export function extractQuotedString(raw, masked) {
	const start = masked.search(/\S/);
	if (start === -1) return null;
	const end = masked.trimEnd().length;
	const token = raw.slice(start, end);
	if (
		token.length >= 2 &&
		((token.startsWith("'") && token.endsWith("'")) ||
			(token.startsWith('"') && token.endsWith('"')) ||
			(token.startsWith('`') && token.endsWith('`') && !token.includes('${')))
	) {
		return token.slice(1, -1);
	}
	return null;
}

function extractStringArray(raw, masked, constArrays = new Map()) {
	const values = [];
	const innerRaw = raw.slice(1, -1);
	const innerMasked = masked.slice(1, -1);
	let offset = 0;
	for (const itemMasked of splitTopLevel(innerMasked, ',')) {
		const itemRaw = innerRaw.slice(offset, offset + itemMasked.length);
		offset += itemMasked.length + 1;
		const trimmed = itemMasked.trim();
		if (!trimmed) continue;
		const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)$/.exec(trimmed);
		if (spread) {
			const expanded = constArrays.get(spread[1]);
			if (expanded) values.push(...expanded);
			continue;
		}
		const str = extractQuotedString(itemRaw, itemMasked);
		if (str !== null) values.push(str);
	}
	return values;
}

function extractConstStringArrays(raw, masked) {
	const result = new Map();
	for (const match of masked.matchAll(
		/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\[/g
	)) {
		const open = match.index + match[0].length - 1;
		const close = findMatching(masked, open, '[', ']');
		if (close === -1) continue;
		result.set(
			match[1],
			extractStringArray(raw.slice(open, close + 1), masked.slice(open, close + 1), result)
		);
	}
	return result;
}

function findTopLevelColon(masked) {
	let depth = 0;
	for (let i = 0; i < masked.length; i++) {
		const c = masked[i];
		if (c === '(' || c === '[' || c === '{') depth += 1;
		else if (c === ')' || c === ']' || c === '}') depth -= 1;
		else if (c === ':' && depth === 0) return i;
	}
	return -1;
}

function extractObjectProperties(raw, masked) {
	const props = new Map();
	const spreads = [];
	const bodyRaw = raw.slice(1, -1);
	const bodyMasked = masked.slice(1, -1);
	let offset = 0;
	for (const segMasked of splitTopLevel(bodyMasked, ',')) {
		const segRaw = bodyRaw.slice(offset, offset + segMasked.length);
		offset += segMasked.length + 1;
		const trimmed = segMasked.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith('...')) {
			spreads.push(trimmed.slice(3).trim());
			continue;
		}
		const colon = findTopLevelColon(segMasked);
		if (colon === -1) continue;
		const key = segRaw
			.slice(0, colon)
			.trim()
			.replace(/^['"]|['"]$/g, '');
		props.set(key, { raw: segRaw.slice(colon + 1), masked: segMasked.slice(colon + 1) });
	}
	return { props, spreads };
}

/**
 * Finds the exported config object literal, handling plain objects, `defineConfig({ ... })` and
 * top-level arrow/function callbacks (`defineConfig(({ mode }) => ({ ... }))`) without being
 * misled by arrow functions nested inside config properties (e.g. `onConsoleLog: () => false`).
 */
function findDefaultObject(raw, masked) {
	const exp = /\bexport\s+default\b|\bmodule\.exports\s*=/.exec(masked);
	let pos = exp ? exp.index + exp[0].length : 0;
	// Skip optional wrapper call such as `defineConfig(`.
	const wrapper = /^\s*(?:[A-Za-z_$][\w$.]*\s*\(\s*)?/.exec(masked.slice(pos));
	if (wrapper) pos += wrapper[0].length;

	const rest = masked.slice(pos);
	// Check whether the exported value itself is a callback (`(params) => ...`, `env => ...`, `function(...)`).
	const fnCallback = /^(?:async\s+)?function\b[^(]*\(/.exec(rest);
	if (fnCallback) {
		const closeParen = findMatching(masked, pos + fnCallback[0].length - 1, '(', ')');
		if (closeParen !== -1) {
			const ret = /\breturn\s*\{/.exec(masked.slice(closeParen + 1));
			if (ret) pos = closeParen + 1 + ret.index + ret[0].length - 1;
		}
	} else {
		const asyncPrefix = /^(?:async\s+)?/.exec(rest)?.[0].length ?? 0;
		const head = pos + asyncPrefix;
		let afterArrow = -1;
		if (masked[head] === '(') {
			const closeParen = findMatching(masked, head, '(', ')');
			const arrow =
				closeParen === -1 ? null : /^\s*(?::[^{=]+)?=>/.exec(masked.slice(closeParen + 1));
			if (arrow) afterArrow = closeParen + 1 + arrow[0].length;
		} else {
			const identArrow = /^[A-Za-z_$][\w$]*\s*=>/.exec(masked.slice(head));
			if (identArrow) afterArrow = head + identArrow[0].length;
		}
		if (afterArrow !== -1) {
			pos = afterArrow;
			if (masked.slice(pos).trimStart().startsWith('{')) {
				const ret = /\breturn\s*\{/.exec(masked.slice(pos));
				if (ret) pos += ret.index + ret[0].length - 1;
			}
		}
	}

	const brace = masked.indexOf('{', pos);
	if (brace === -1) return null;
	const close = findMatching(masked, brace, '{', '}');
	if (close === -1) return null;
	return { raw: raw.slice(brace, close + 1), masked: masked.slice(brace, close + 1) };
}

function extractDefaultImports(raw, masked) {
	const imports = new Map();
	for (const match of masked.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"][^'"]*['"])/g)) {
		const spec = /from\s+['"]([^'"]+)['"]/.exec(
			raw.slice(match.index, match.index + match[0].length)
		);
		if (spec) imports.set(match[1], spec[1]);
	}
	return imports;
}

export function resolveRelativeJsFile(root, fromFile, spec, fileSet) {
	if (!spec.startsWith('.')) return null;
	const base = joinPosix(dirOf(fromFile), spec);
	const stripped = base.replace(/\.[cm]?[jt]sx?$/, '');
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.mts`,
		`${base}.js`,
		`${base}.mjs`,
		`${stripped}.ts`,
		`${stripped}.mts`,
		`${stripped}.js`,
		`${stripped}.mjs`,
		`${base}/index.ts`,
		`${base}/index.js`,
	]) {
		if (fileSet ? fileSet.has(candidate) : existsSync(resolve(root, candidate))) return candidate;
	}
	return null;
}

const readArrayProp = (prop, constArrays) => {
	if (!prop) return null;
	const open = prop.masked.indexOf('[');
	const close = open === -1 ? -1 : findMatching(prop.masked, open, '[', ']');
	return close === -1
		? null
		: extractStringArray(
				prop.raw.slice(open, close + 1),
				prop.masked.slice(open, close + 1),
				constArrays
			);
};

// ---------------------------------------------------------------------------
// Runner config parsers
// ---------------------------------------------------------------------------

export function parseVitestConfig(text, file = '', rootDir = null, visited = new Set()) {
	const masked = maskSource(text);
	const isStorybook = /\bstorybookTest\s*\(/.test(masked);
	const constArrays = extractConstStringArrays(text, masked);
	const imports = extractDefaultImports(text, masked);
	const outer = findDefaultObject(text, masked);
	if (!outer) {
		const exp = /\bexport\s+default\b/.exec(masked);
		const open = exp ? masked.indexOf('[', exp.index) : -1;
		const close = open === -1 ? -1 : findMatching(masked, open, '[', ']');
		if (close !== -1) {
			const entries = extractStringArray(
				text.slice(open, close + 1),
				masked.slice(open, close + 1),
				constArrays
			).map((value) => ({ kind: 'path', value }));
			return {
				hasTest: true,
				isStorybook,
				root: null,
				include: null,
				exclude: [],
				projects: entries,
			};
		}
		return { hasTest: false, isStorybook, root: null, include: null, exclude: [], projects: [] };
	}

	const { props: outerProps } = extractObjectProperties(outer.raw, outer.masked);
	const rootProp = outerProps.get('root');
	const configRoot = rootProp ? extractQuotedString(rootProp.raw, rootProp.masked) : null;
	const testProp = outerProps.get('test');
	if (!testProp) {
		return {
			hasTest: false,
			isStorybook,
			root: configRoot,
			include: null,
			exclude: [],
			projects: [],
		};
	}
	const openBrace = testProp.masked.indexOf('{');
	const closeBrace = openBrace === -1 ? -1 : findMatching(testProp.masked, openBrace, '{', '}');
	if (closeBrace === -1) {
		return {
			hasTest: true,
			isStorybook,
			root: configRoot,
			include: null,
			exclude: [],
			projects: [],
		};
	}

	const { props: testProps, spreads } = extractObjectProperties(
		testProp.raw.slice(openBrace, closeBrace + 1),
		testProp.masked.slice(openBrace, closeBrace + 1)
	);

	let inheritedInclude = null;
	let inheritedExclude = [];
	if (rootDir && file && !visited.has(file)) {
		visited.add(file);
		for (const spread of spreads) {
			const ident = /^([A-Za-z_$][\w$]*)\.test\b/.exec(spread)?.[1];
			if (!ident || !imports.has(ident)) continue;
			const target = resolveRelativeJsFile(rootDir, file, imports.get(ident), null);
			const baseText = target ? readText(rootDir, target) : null;
			if (!baseText) continue;
			const baseParsed = parseVitestConfig(baseText, target, rootDir, visited);
			if (baseParsed.include) inheritedInclude = baseParsed.include;
			if (baseParsed.exclude.length > 0) inheritedExclude = [...baseParsed.exclude];
		}
	}

	const projects = [];
	const projectsProp = testProps.get('projects');
	if (projectsProp) {
		const open = projectsProp.masked.indexOf('[');
		const close = open === -1 ? -1 : findMatching(projectsProp.masked, open, '[', ']');
		if (close !== -1) {
			const innerRaw = projectsProp.raw.slice(open + 1, close);
			const innerMasked = projectsProp.masked.slice(open + 1, close);
			let offset = 0;
			for (const itemMasked of splitTopLevel(innerMasked, ',')) {
				const itemRaw = innerRaw.slice(offset, offset + itemMasked.length);
				offset += itemMasked.length + 1;
				if (!itemMasked.trim()) continue;
				const str = extractQuotedString(itemRaw, itemMasked);
				if (str !== null) {
					projects.push({ kind: 'path', value: str });
					continue;
				}
				const bOpen = itemMasked.indexOf('{');
				const bClose = bOpen === -1 ? -1 : findMatching(itemMasked, bOpen, '{', '}');
				if (bClose === -1) continue;
				const { props: pProps } = extractObjectProperties(
					itemRaw.slice(bOpen, bClose + 1),
					itemMasked.slice(bOpen, bClose + 1)
				);
				const pRoot = pProps.get('root')
					? extractQuotedString(pProps.get('root').raw, pProps.get('root').masked)
					: null;
				const pTest = pProps.get('test');
				let targetProps = pProps;
				if (pTest) {
					const tOpen = pTest.masked.indexOf('{');
					const tClose = tOpen === -1 ? -1 : findMatching(pTest.masked, tOpen, '{', '}');
					if (tClose !== -1) {
						targetProps = extractObjectProperties(
							pTest.raw.slice(tOpen, tClose + 1),
							pTest.masked.slice(tOpen, tClose + 1)
						).props;
					}
				}
				const tRoot = targetProps.get('root')
					? extractQuotedString(targetProps.get('root').raw, targetProps.get('root').masked)
					: null;
				projects.push({
					kind: 'inline',
					root: tRoot ?? pRoot,
					include: readArrayProp(targetProps.get('include'), constArrays),
					exclude: readArrayProp(targetProps.get('exclude'), constArrays) ?? [],
				});
			}
		}
	}

	const testRootProp = testProps.get('root');
	return {
		hasTest: true,
		isStorybook,
		root:
			(testRootProp && extractQuotedString(testRootProp.raw, testRootProp.masked)) ?? configRoot,
		include: readArrayProp(testProps.get('include'), constArrays) ?? inheritedInclude,
		exclude: readArrayProp(testProps.get('exclude'), constArrays) ?? inheritedExclude,
		projects,
	};
}

export function parsePlaywrightConfig(text) {
	const masked = maskSource(text);
	const constArrays = extractConstStringArrays(text, masked);
	const outer = findDefaultObject(text, masked);
	if (!outer) return { testDir: '.', testMatch: null, testIgnore: [] };
	const { props } = extractObjectProperties(outer.raw, outer.masked);
	const dirProp = props.get('testDir');
	const parseMatcher = (prop) => {
		if (!prop) return null;
		const str = extractQuotedString(prop.raw, prop.masked);
		if (str !== null) return [{ kind: 'glob', value: str }];
		const arr = readArrayProp(prop, constArrays);
		if (arr) return arr.map((value) => ({ kind: 'glob', value }));
		const regexMatch = /^\/(.+)\/([a-z]*)$/.exec(prop.raw.trim());
		return regexMatch ? [{ kind: 'regex', value: new RegExp(regexMatch[1], regexMatch[2]) }] : null;
	};
	return {
		testDir: (dirProp && extractQuotedString(dirProp.raw, dirProp.masked)) ?? '.',
		testMatch: parseMatcher(props.get('testMatch')),
		testIgnore: parseMatcher(props.get('testIgnore')) ?? [],
	};
}

export function parseJestConfig(text) {
	const masked = maskSource(text);
	const constArrays = extractConstStringArrays(text, masked);
	const outer = findDefaultObject(text, masked);
	if (!outer) return { roots: ['.'], testMatch: null, testPathIgnorePatterns: [] };
	const { props } = extractObjectProperties(outer.raw, outer.masked);
	return {
		roots: (readArrayProp(props.get('roots'), constArrays) ?? ['.']).map(
			(r) => r.replace(/^<rootDir>\/?/, '') || '.'
		),
		testMatch: readArrayProp(props.get('testMatch'), constArrays)?.map((g) =>
			g.replace(/^<rootDir>\/?/, '')
		),
		testPathIgnorePatterns: readArrayProp(props.get('testPathIgnorePatterns'), constArrays) ?? [],
	};
}

export function parsePytestConfig(text, filename) {
	if (filename.endsWith('.toml')) {
		const section = /\[tool\.pytest\.ini_options\]([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1];
		if (!section) return { configured: false, testpaths: null, norecursedirs: null };
		const readList = (key) => {
			const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm').exec(section);
			return match ? [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => gitPath(m[1])) : null;
		};
		return {
			configured: true,
			testpaths: readList('testpaths'),
			norecursedirs: readList('norecursedirs'),
		};
	}
	const section = /\[(?:pytest|tool:pytest)\]([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1];
	if (!section) return { configured: false, testpaths: null, norecursedirs: null };
	const readIniList = (key) => {
		const m = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm').exec(section)?.[1];
		return m
			? m
					.trim()
					.split(/[\s,]+/)
					.filter(Boolean)
					.map(gitPath)
			: null;
	};
	return {
		configured: true,
		testpaths: readIniList('testpaths'),
		norecursedirs: readIniList('norecursedirs'),
	};
}

export function parseCargoToml(text) {
	const cleaned = text
		.split(/\r?\n/)
		.map((line) => line.replace(/#.*$/, ''))
		.join('\n');
	const pkgSection = /\[package\]([\s\S]*?)(?=\n\[|$)/.exec(cleaned)?.[1] ?? '';
	const wsSection = /\[workspace\]([\s\S]*?)(?=\n\[|$)/.exec(cleaned)?.[1] ?? '';
	const readArr = (sec, key) => {
		const m = new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm').exec(sec);
		return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => gitPath(x[1])) : [];
	};
	const explicitTests = [];
	for (const match of cleaned.matchAll(/\[\[test\]\]([\s\S]*?)(?=\n\[|$)/g)) {
		const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(match[1])?.[1] ?? null;
		const path = /^\s*path\s*=\s*"([^"]+)"/m.exec(match[1])?.[1];
		if (path) explicitTests.push({ name, path: gitPath(path) });
	}
	return {
		name: /^\s*name\s*=\s*"([^"]+)"/m.exec(pkgSection)?.[1] ?? null,
		autotests: /^\s*autotests\s*=\s*(true|false)\b/m.exec(pkgSection)?.[1] !== 'false',
		explicitTests,
		members: readArr(wsSection, 'members'),
		exclude: readArr(wsSection, 'exclude'),
	};
}

export function parseCmakeTestSources(root, projectDir, listedSet) {
	let hasAddTest = false;
	const testTargets = new Set();
	const targetSources = new Map();
	const targetDeps = new Map();
	const visited = new Set();

	const unwrapTarget = (token) => {
		const gen = /^\$<TARGET_FILE:([^>]+)>$/i.exec(token);
		return gen ? gen[1] : token;
	};

	const visitDir = (dir) => {
		const cmakeFile = joinPosix(dir, 'CMakeLists.txt');
		if (visited.has(cmakeFile) || !listedSet.has(cmakeFile)) return;
		visited.add(cmakeFile);
		const raw = readText(root, cmakeFile);
		if (!raw) return;
		const text = raw
			.split(/\r?\n/)
			.map((line) => line.replace(/#.*$/, ''))
			.join('\n');
		const pattern =
			/\b(add_subdirectory|add_executable|add_library|target_sources|add_test|gtest_discover_tests|catch_discover_tests|doctest_discover_tests|add_dependencies|target_link_libraries)\s*\(([^()]*)\)/gi;
		for (const match of text.matchAll(pattern)) {
			const fn = match[1].toLowerCase();
			const tokens = match[2]
				.trim()
				.split(/\s+/)
				.map((t) => t.replace(/^["']|["']$/g, ''))
				.filter(Boolean);
			if (tokens.length === 0) continue;
			if (fn === 'add_subdirectory' && !tokens[0].includes('$')) {
				visitDir(joinPosix(dir, tokens[0]));
			} else if (fn === 'add_executable' || fn === 'add_library' || fn === 'target_sources') {
				const set = targetSources.get(tokens[0]) ?? new Set();
				targetSources.set(tokens[0], set);
				for (const tok of tokens.slice(1)) {
					if (CPP_TEST_FILE.test(tok)) set.add(joinPosix(dir, tok));
				}
			} else if (fn === 'add_test') {
				hasAddTest = true;
				const cmdIdx = tokens.findIndex((t) => t.toUpperCase() === 'COMMAND');
				const rawTarget = cmdIdx !== -1 ? tokens[cmdIdx + 1] : tokens[1];
				if (rawTarget) testTargets.add(unwrapTarget(rawTarget));
			} else if (
				fn === 'gtest_discover_tests' ||
				fn === 'catch_discover_tests' ||
				fn === 'doctest_discover_tests'
			) {
				hasAddTest = true;
				testTargets.add(unwrapTarget(tokens[0]));
			} else if (fn === 'add_dependencies' || fn === 'target_link_libraries') {
				const set = targetDeps.get(tokens[0]) ?? new Set();
				targetDeps.set(tokens[0], set);
				for (const dep of tokens.slice(1)) set.add(dep);
			}
		}
	};

	visitDir(projectDir);
	if (!hasAddTest) return { hasTest: false, sources: new Set() };
	const sources = new Set();
	const seen = new Set();
	const queue = [...testTargets];
	while (queue.length > 0) {
		const target = queue.shift();
		if (seen.has(target)) continue;
		seen.add(target);
		for (const src of targetSources.get(target) ?? []) sources.add(src);
		for (const dep of targetDeps.get(target) ?? []) queue.push(dep);
	}
	return { hasTest: true, sources };
}

// ---------------------------------------------------------------------------
// Workflow, hook, shell & workspace extractors
// ---------------------------------------------------------------------------

/**
 * Extracts `{ cwd, cmd, source }` commands from a GitHub Actions workflow YAML file.
 * Buffers each step so `working-directory:` applies regardless of key order relative to `run:`.
 */
export function extractWorkflowCommands(text, source) {
	const commands = [];
	const lines = text.split(/\r?\n/);
	let inJobs = false;
	let jobIndent = null;
	let stepsIndent = null;
	let stepItemIndent = null;
	let jobDefaultCwd = '';
	let currentStep = null;
	const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

	const flushStep = () => {
		if (!currentStep) return;
		const cwd = currentStep.cwd ?? jobDefaultCwd;
		for (const cmd of currentStep.runs) commands.push({ cwd, cmd, source });
		currentStep = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || /^\s*#/.test(line)) continue;
		const indent = line.length - line.trimStart().length;
		if (indent === 0) {
			flushStep();
			inJobs = /^jobs:\s*(#.*)?$/.test(line);
			jobIndent = null;
			stepsIndent = null;
			stepItemIndent = null;
			continue;
		}
		if (!inJobs) continue;
		if (jobIndent === null || indent === jobIndent) {
			if (/^[A-Za-z0-9_-]+:\s*(#.*)?$/.test(line.trim())) {
				flushStep();
				jobIndent = indent;
				stepsIndent = null;
				stepItemIndent = null;
				jobDefaultCwd = '';
				continue;
			}
		}
		if (stepsIndent !== null && indent <= stepsIndent) {
			flushStep();
			stepsIndent = null;
			stepItemIndent = null;
		}
		if (/^steps:\s*(#.*)?$/.test(line.trim())) {
			flushStep();
			stepsIndent = indent;
			stepItemIndent = null;
			continue;
		}
		if (stepsIndent === null) {
			const wdMatch = /^working-directory:\s*(.+)$/.exec(line.trim());
			if (wdMatch) jobDefaultCwd = gitPath(unquote(wdMatch[1].replace(/\s+#.*$/, '')));
			continue;
		}
		if (line.trimStart().startsWith('- ')) {
			if (stepItemIndent === null || indent === stepItemIndent) {
				flushStep();
				stepItemIndent = indent;
				currentStep = { cwd: null, runs: [] };
			}
		}
		if (!currentStep) continue;
		const wdMatch = /^(?:-\s+)?working-directory:\s*(.+)$/.exec(line.trim());
		if (wdMatch) {
			currentStep.cwd = gitPath(unquote(wdMatch[1].replace(/\s+#.*$/, '')));
			continue;
		}
		const runMatch = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
		if (!runMatch) continue;
		const baseIndent = runMatch[1].length + (line.trimStart().startsWith('- ') ? 2 : 0);
		const rest = runMatch[2].trim();
		if (/^[|>][+-]?$/.test(rest)) {
			const block = [];
			let j = i + 1;
			while (j < lines.length) {
				const next = lines[j];
				if (!next.trim()) {
					block.push('');
					j += 1;
					continue;
				}
				if (next.length - next.trimStart().length <= baseIndent) break;
				block.push(next.trim());
				j += 1;
			}
			i = j - 1;
			currentStep.runs.push(rest.startsWith('>') ? block.join(' ') : block.join('\n'));
		} else if (rest) {
			currentStep.runs.push(rest);
		}
	}
	flushStep();
	return commands;
}

/**
 * Extracts `{ section, cwd, cmd, source }` commands from all hook sections of `lefthook.yml`,
 * respecting per-command `root:` regardless of key order relative to `run:`.
 */
export function extractLefthookCommands(text, source) {
	const commands = [];
	const lines = text.split(/\r?\n/);
	let section = '';
	let inCommands = false;
	let commandsIndent = 0;
	let cmdNameIndent = null;
	let current = null;
	const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

	const flush = () => {
		if (current?.cmd) {
			commands.push({ section, cwd: current.root ?? '', cmd: current.cmd, source });
		}
		current = null;
	};

	for (const line of lines) {
		if (!line.trim() || /^\s*#/.test(line)) continue;
		const indent = line.length - line.trimStart().length;
		if (indent === 0) {
			flush();
			const top = /^([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
			section = top && !LEFTHOOK_META_KEYS.has(top[1]) ? top[1] : '';
			inCommands = false;
			cmdNameIndent = null;
			continue;
		}
		if (!section) continue;
		if (/^commands:\s*(#.*)?$/.test(line.trim())) {
			flush();
			inCommands = true;
			commandsIndent = indent;
			cmdNameIndent = null;
			continue;
		}
		if (!inCommands) continue;
		if (indent <= commandsIndent) {
			flush();
			inCommands = false;
			cmdNameIndent = null;
			continue;
		}
		if (cmdNameIndent === null || indent === cmdNameIndent) {
			if (/^[A-Za-z0-9_.-]+:\s*(#.*)?$/.test(line.trim())) {
				flush();
				cmdNameIndent = indent;
				current = { root: '', cmd: null };
				continue;
			}
		}
		if (!current) continue;
		const rootMatch = /^root:\s*(.+)$/.exec(line.trim());
		if (rootMatch) {
			current.root = gitPath(unquote(rootMatch[1].replace(/\s+#.*$/, '')));
			continue;
		}
		const runMatch = /^run:\s*(.+)$/.exec(line.trim());
		if (runMatch) current.cmd = unquote(runMatch[1].trim());
	}
	flush();
	return commands;
}

export function expandShellBlock(block) {
	const lines = block.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/);
	const expanded = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line.startsWith('#')) continue;
		const forMatch = /^for\s+(\w+)\s+in\s+([^;]+);\s*do\s*(.*)$/.exec(line);
		if (forMatch) {
			const [, varName, itemList, inlineBody] = forMatch;
			const bodyParts = [];
			if (inlineBody) {
				const doneIdx = inlineBody.indexOf('done');
				bodyParts.push(doneIdx === -1 ? inlineBody : inlineBody.slice(0, doneIdx));
			}
			if (!inlineBody.includes('done')) {
				while (++i < lines.length) {
					const bLine = lines[i].trim();
					if (bLine === 'done' || bLine.startsWith('done;') || bLine.startsWith('done ')) break;
					bodyParts.push(bLine);
				}
			}
			const body = bodyParts.join('\n');
			for (const item of itemList.trim().split(/\s+/).filter(Boolean)) {
				expanded.push(
					body
						.replaceAll(`"$${varName}"`, item)
						.replaceAll(`"\${${varName}}"`, item)
						.replaceAll(`$${varName}`, item)
						.replaceAll(`\${${varName}}`, item)
				);
			}
			continue;
		}
		expanded.push(line);
	}
	const segments = [];
	for (const text of expanded) {
		for (const subline of text.split(/\r?\n/)) {
			const stripped = stripShellComment(subline);
			if (stripped) segments.push(...splitShellSegments(stripped));
		}
	}
	return segments;
}

function stripShellComment(line) {
	let quote = null;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '\\' && quote !== "'") {
			i += 1;
			continue;
		}
		if (!quote && (c === "'" || c === '"')) quote = c;
		else if (quote === c) quote = null;
		else if (!quote && c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
			return line.slice(0, i).trim();
		}
	}
	return line.trim();
}

function splitShellSegments(line) {
	const out = [];
	let quote = null;
	let start = 0;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '\\' && quote !== "'") {
			i += 1;
			continue;
		}
		if (!quote && (c === "'" || c === '"')) quote = c;
		else if (quote === c) quote = null;
		else if (!quote) {
			if ((c === '&' && line[i + 1] === '&') || (c === '|' && line[i + 1] === '|')) {
				const seg = line.slice(start, i).trim();
				if (seg) out.push(seg);
				i += 1;
				start = i + 1;
			} else if (c === ';') {
				const seg = line.slice(start, i).trim();
				if (seg) out.push(seg);
				start = i + 1;
			}
		}
	}
	const tail = line.slice(start).trim();
	if (tail) out.push(tail);
	return out;
}

export function tokenizeShell(segment) {
	const tokens = [];
	let cur = '';
	let quote = null;
	for (let i = 0; i < segment.length; i++) {
		const c = segment[i];
		if (c === '\\' && quote !== "'" && i + 1 < segment.length) cur += segment[++i];
		else if (!quote && (c === "'" || c === '"')) quote = c;
		else if (quote === c) quote = null;
		else if (!quote && /\s/.test(c)) {
			if (cur) {
				tokens.push(cur);
				cur = '';
			}
		} else cur += c;
	}
	if (cur) tokens.push(cur);
	return tokens;
}

export function loadPackages(root, listed, listedSet) {
	let wsPatterns = null;
	if (listedSet.has('pnpm-workspace.yaml')) {
		const text = readText(root, 'pnpm-workspace.yaml') ?? '';
		const section = /^packages:\s*\r?\n((?:[ \t]*-.*|[ \t]*#.*|\s*)\r?\n?)*/m.exec(text)?.[0] ?? '';
		const pats = [...section.matchAll(/^\s*-\s+(['"]?)([^'"#\s]+)\1/gm)].map((m) => gitPath(m[2]));
		if (pats.length > 0) wsPatterns = pats;
	} else if (listedSet.has('package.json')) {
		try {
			const pkg = JSON.parse(readText(root, 'package.json') ?? '{}');
			const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
			if (Array.isArray(ws) && ws.length > 0) wsPatterns = ws.map(gitPath);
		} catch {}
	}
	const wsMatchers = wsPatterns?.map((pat) => ({
		negated: pat.startsWith('!'),
		re: globToRegExp(pat.startsWith('!') ? pat.slice(1) : pat),
	}));
	const inWorkspace = (dir) => {
		if (!wsMatchers) return dir === '';
		let matched = false;
		for (const { negated, re } of wsMatchers) if (re.test(dir)) matched = !negated;
		return matched;
	};
	const packages = [];
	const byName = new Map();
	const byDir = new Map();
	for (const file of listed) {
		if (posix.basename(file) !== 'package.json') continue;
		let data;
		try {
			data = JSON.parse(readText(root, file) ?? '');
		} catch {
			continue;
		}
		const dir = dirOf(file);
		const pkg = {
			file,
			dir,
			name: typeof data.name === 'string' ? data.name : null,
			scripts: typeof data.scripts === 'object' && data.scripts ? data.scripts : {},
			jest: typeof data.jest === 'object' && data.jest ? data.jest : null,
			workspace: inWorkspace(dir),
		};
		packages.push(pkg);
		if (pkg.name) byName.set(pkg.name, pkg);
		byDir.set(dir, pkg);
	}
	return { packages, byName, byDir, hasWorkspace: wsPatterns !== null };
}
