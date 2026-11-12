import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentSchema } from './plugin.js';

/**
 * A guide source: Specimen's fifth plugin point, and the only one that runs in Node. It turns data
 * a library already keeps, such as an attribute taxonomy, into shared rules, so a rule is stated
 * once for every component it applies to. Its rules join those of the guide files before any check,
 * so `specimen-validate` checks them, `guides@1` counts them, and `specimen-pack-export` rebuilds
 * them with no browser.
 *
 * It runs in Node, not in the page with the other four: rules are text, not something a render
 * shows, and in Node export can recheck them and a guide's checks need no browser.
 */
export interface GuideSourceRule {
	/** A stable id, as a guide file's rule has: `^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$`. */
	id: string;
	/** At most 240 characters, on one line. */
	text: string;
	/** The components it names, and any component with a named attribute. */
	appliesTo: { tags?: string[]; attributes?: string[] };
}
export interface GuideSourceContext {
	/** The project root. */
	root: string;
	/** The directory the configuration file is in, which a source's paths are relative to. */
	base: string;
	/** What the manifest says, by tag. A page plugin's schema additions are not here. */
	schemas: Readonly<Record<string, ComponentSchema>>;
	/** Read a text file, by a path relative to the configuration; one outside the root is refused. */
	read(path: string): Promise<string>;
}
export interface GuideSource {
	id: string;
	/** Recorded nowhere; for the source's own messages. */
	version?: string;
	rules(
		context: GuideSourceContext
	): readonly GuideSourceRule[] | Promise<readonly GuideSourceRule[]>;
}

/** Declare a guide source with its type checked. */
export function defineGuideSource(source: GuideSource): GuideSource {
	return source;
}

const isSource = (value: unknown): value is GuideSource =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as GuideSource).id === 'string' &&
	typeof (value as GuideSource).rules === 'function';

/** Whether `path` is the root or below it. */
function within(root: string, path: string): boolean {
	const fromRoot = relative(root, path);
	return !(fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot));
}

/**
 * Run one guide source module: its default export is a source or an array of them. Returns each
 * source's rules, unchecked; the caller checks them as it checks a guide file's.
 */
export async function runGuideSource(
	root: string,
	base: string,
	module: string,
	schemas: Readonly<Record<string, ComponentSchema>>
): Promise<unknown[]> {
	// Node keeps a module once imported: a query of its digest loads an edited module again in a
	// long-lived process. What the module itself imports is not reloaded.
	const version = createHash('sha256')
		.update(await readFile(module))
		.digest('hex');
	const loaded = (await import(`${pathToFileURL(module).href}?${version}`)) as {
		default?: unknown;
	};
	const sources = Array.isArray(loaded.default) ? loaded.default : [loaded.default];
	if (!sources.length || !sources.every(isSource))
		throw new Error('its default export is not a guide source: an object with an id and rules()');
	const context: GuideSourceContext = {
		root,
		base,
		schemas,
		async read(path) {
			const target = await realpath(resolve(base, path));
			if (!within(root, target)) throw new Error(`'${path}' is outside the root`);
			return readFile(target, 'utf8');
		},
	};
	const rules: unknown[] = [];
	for (const source of sources) {
		const produced = await source.rules(context);
		if (!Array.isArray(produced))
			throw new Error(
				`guide source '${source.id}' returned ${typeof produced}, not an array of rules`
			);
		rules.push(...produced);
	}
	return rules;
}
