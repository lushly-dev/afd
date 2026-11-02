/**
 * @fileoverview The rules `path-inside-root` and `files` of spec/plugin-manifest.md, over a map of
 * files rather than a disk, so `checkApp` stays pure. Also Loam's built files: `native.entry`,
 * `view.handlers` and `ui.resources[].path`. No Node.js builtin.
 */

/** A package's files as data. Paths are relative to the root, so `../x` is beside it. */
export interface AppTree {
	files: Readonly<Record<string, string>>;
	/** A link's path to its target, relative to the link's directory, as on disk. */
	symlinks: Readonly<Record<string, string>>;
}

export interface FileFinding {
	code: string;
	pointer: string;
	message: string;
	suggestion: string;
}

type Json = Record<string, unknown>;

/** A symlink cycle stops here, as the operating system's own limit does. */
const MAX_LINK_HOPS = 40;
const DRIVE = /^[A-Za-z]:/;
const LEAVES = 'Keep the path inside the plugin root: it is a symbolic link that leaves it.';
const OUTSIDE = 'Keep the path inside the plugin root.';
const DANGLING = 'The path is a symbolic link to nothing; fix or remove it.';

/** Stands in for a schema that could not be read, so its one refusal is all the author sees. */
const PLACEHOLDER = { type: 'object', additionalProperties: false };

interface Resolved {
	path: string;
	linked: boolean;
}

/** Follows every link on the way, as `realpath` does. Undefined when a cycle never ends. */
function resolve(path: string, symlinks: AppTree['symlinks']): Resolved | undefined {
	let pending = path.split('/');
	const done: string[] = [];
	let linked = false;
	let hops = 0;
	while (pending.length > 0) {
		const part = pending.shift() as string;
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (done.length > 0 && done.at(-1) !== '..') done.pop();
			else done.push('..');
			continue;
		}
		const target = symlinks[[...done, part].join('/')];
		if (target === undefined) {
			done.push(part);
			continue;
		}
		linked = true;
		hops += 1;
		if (hops > MAX_LINK_HOPS) return undefined;
		// An absolute target is outside by definition; `readAppTree` rewrites those it can place.
		if (target.startsWith('/') || DRIVE.test(target)) return { path: '../<absolute>', linked };
		pending = [...target.split('/'), ...pending];
	}
	return { path: done.join('/'), linked };
}

function exists(tree: AppTree, path: string): boolean {
	if (path === '') return true;
	if (tree.files[path] !== undefined) return true;
	const prefix = `${path}/`;
	return Object.keys(tree.files).some((file) => file.startsWith(prefix));
}

const isOutside = (path: string): boolean => path === '..' || path.startsWith('../');

function escapeFinding(pointer: string, suggestion: string): FileFinding {
	return {
		code: 'MANIFEST_PATH_ESCAPE',
		pointer,
		message: 'This path does not stay inside the plugin root.',
		suggestion,
	};
}

function missingFinding(pointer: string, message: string, suggestion: string): FileFinding {
	return { code: 'MANIFEST_FILE_MISSING', pointer, message, suggestion };
}

/** `path-inside-root`. A resolved path that exists, or nothing: the caller decides what absence is. */
function checkPath(
	tree: AppTree,
	path: string,
	pointer: string
): { resolved: Resolved } | { finding: FileFinding } {
	if (DRIVE.test(path)) return { finding: escapeFinding(pointer, OUTSIDE) };
	const resolved = resolve(path, tree.symlinks);
	if (!resolved) return { finding: escapeFinding(pointer, DANGLING) };
	if (resolved.linked && !exists(tree, resolved.path)) {
		return { finding: escapeFinding(pointer, DANGLING) };
	}
	if (isOutside(resolved.path)) {
		return { finding: escapeFinding(pointer, resolved.linked ? LEAVES : OUTSIDE) };
	}
	return { resolved };
}

/**
 * The core's `jsonPath`, which the reader cannot apply: it sees the schema that replaced the path.
 * Held equal to the core by a test.
 */
export const JSON_PATH = /^[^/\\\0][^\\\0]*\.json$/;
export const DOT_DOT_SEGMENT = /(^|\/)\.\.(\/|$)/;

function readSchema(
	tree: AppTree,
	path: string,
	pointer: string
): { schema: unknown } | { finding: FileFinding } {
	if (DOT_DOT_SEGMENT.test(path) || path.startsWith('/')) {
		return { finding: escapeFinding(pointer, OUTSIDE) };
	}
	if (!JSON_PATH.test(path)) {
		return {
			finding: {
				code: 'MANIFEST_INVALID',
				pointer,
				message: `\`${path}\` is not a relative path to a JSON file.`,
				suggestion: 'Name a `.json` file relative to the plugin root, with `/` between its parts.',
			},
		};
	}
	const checked = checkPath(tree, path, pointer);
	if ('finding' in checked) return checked;
	const text = tree.files[checked.resolved.path];
	if (text === undefined) {
		return {
			finding: missingFinding(
				pointer,
				`\`${path}\` does not exist.`,
				'Add the file, or correct the path.'
			),
		};
	}
	let schema: unknown;
	try {
		schema = JSON.parse(text);
	} catch {
		return {
			finding: missingFinding(pointer, `\`${path}\` is not JSON.`, 'The file must hold JSON.'),
		};
	}
	if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
		return {
			finding: missingFinding(
				pointer,
				`\`${path}\` does not hold an object.`,
				'The file must hold a JSON Schema object.'
			),
		};
	}
	return { schema };
}

function skillFindings(tree: AppTree, path: string, pointer: string): FileFinding[] {
	const checked = checkPath(tree, path, pointer);
	if ('finding' in checked) return [checked.finding];
	const manifest = resolve(`${path.replace(/\/+$/, '')}/SKILL.md`, tree.symlinks);
	if (manifest && !isOutside(manifest.path) && tree.files[manifest.path] !== undefined) return [];
	return [
		missingFinding(
			pointer,
			`\`${path}\` is not a directory holding \`SKILL.md\`.`,
			'Add SKILL.md to the skill directory.'
		),
	];
}

const list = (value: unknown): Json[] =>
	Array.isArray(value)
		? value.filter((item): item is Json => typeof item === 'object' && item !== null)
		: [];

const table = (value: unknown): Json =>
	typeof value === 'object' && value !== null ? (value as Json) : {};

/**
 * Runs both rules over the paths the core names, and returns the manifest with each schema path
 * replaced by the schema it names, the only form `readManifest` takes.
 */
export function inlineSchemas(
	raw: unknown,
	tree: AppTree
): { inlined: Json; findings: FileFinding[] } {
	const inlined = structuredClone(table(raw));
	const findings: FileFinding[] = [];
	const inlineKey = (holder: Json, key: string, pointer: string): void => {
		const path = holder[key];
		if (typeof path !== 'string') return;
		const read = readSchema(tree, path, `${pointer}/${key}`);
		if ('finding' in read) {
			findings.push(read.finding);
			holder[key] = { ...PLACEHOLDER };
		} else holder[key] = read.schema;
	};
	for (const section of ['commands', 'pipelines']) {
		list(inlined[section]).forEach((entry, index) => {
			inlineKey(entry, 'input_schema', `/${section}/${index}`);
			inlineKey(entry, 'returns', `/${section}/${index}`);
		});
	}
	inlineKey(table(inlined.config), 'schema', '/config');
	list(inlined.skills).forEach((skill, index) => {
		if (typeof skill.path === 'string') {
			findings.push(...skillFindings(tree, skill.path, `/skills/${index}/path`));
		}
	});
	return { inlined, findings };
}

/** Each path of Loam's built files in the manifest, by the pointer that names it. */
export function builtPaths(raw: unknown): Array<{ path: string; pointer: string }> {
	const manifest = table(raw);
	const found: Array<{ path: string; pointer: string }> = [];
	const add = (value: unknown, pointer: string): void => {
		if (typeof value === 'string') found.push({ path: value, pointer });
	};
	add(table(manifest.native).entry, '/native/entry');
	add(table(manifest.view).handlers, '/view/handlers');
	list(table(manifest.ui).resources).forEach((resource, index) => {
		add(resource.path, `/ui/resources/${index}/path`);
	});
	return found;
}

/** Inline code is not a reference, so it is removed before looking; a style's `@import` is one. */
function externalReferences(html: string): boolean {
	const bare = html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(
			/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi,
			(_match, open: string) => `${open}</script>`
		);
	const styles = [...bare.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
	if (styles.some(([, css]) => /@import\b/i.test(css as string))) return true;
	return (
		/<script\b[^>]*(?<![\w-])src\s*=/i.test(bare) ||
		/<link\b(?=[^>]*\brel\s*=\s*["']?[^"'>]*\bstylesheet)[^>]*>/i.test(bare)
	);
}

/**
 * Loam's built files: inside the root, and `ENTRY_NOT_BUILT` when not there yet. An HTML file that is
 * there is one file, since a view's frame has nothing else to load.
 */
export function builtFileFindings(
	raw: unknown,
	tree: AppTree
): { refusals: FileFinding[]; warnings: FileFinding[] } {
	const refusals: FileFinding[] = [];
	const warnings: FileFinding[] = [];
	for (const { path, pointer } of builtPaths(raw)) {
		const checked = checkPath(tree, path, pointer);
		if ('finding' in checked) {
			refusals.push(checked.finding);
			continue;
		}
		const text = tree.files[checked.resolved.path];
		if (text === undefined) {
			warnings.push({
				code: 'ENTRY_NOT_BUILT',
				pointer,
				message: `\`${path}\` does not exist yet.`,
				suggestion: 'Build the app; `loam app pack` refuses a file that is not there.',
			});
		} else if (pointer !== '/native/entry' && externalReferences(text)) {
			refusals.push({
				code: 'VIEW_NOT_SINGLE_FILE',
				pointer,
				message: `\`${path}\` references an external script or stylesheet.`,
				suggestion:
					"Inline them with `singleFileHtml()` from `@lushly-dev/loam-cli/vite`: a view's frame loads nothing else.",
			});
		}
	}
	return { refusals, warnings };
}
