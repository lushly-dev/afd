/**
 * narrowZodFromJsonSchema: a Vite plugin that keeps `z.fromJSONSchema` from widening the first-paint
 * chunk (phase 1 specification, 9.5). It changes no behaviour, only what a bundler can see.
 *
 * Zod's `from-json-schema.js` builds `const z = { ..._schemas, ..._checks, iso: _iso }`. A spread
 * uses every export, and a module splits whole, so a lazily loaded reader would pull the whole classic
 * API into the chunk the shell loads before first paint. This writes the object out with the names the
 * file reads, so the rest tree-shakes. A name it cannot place stops the build, so a change in Zod is
 * found here and not at run time.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TARGET = /[\\/]zod[\\/]v4[\\/]classic[\\/]from-json-schema\.js(\?.*)?$/;
const SPREAD = /const z = \{\s*\.\.\._schemas,\s*\.\.\._checks,\s*iso: _iso,?\s*\};/;

/** The names a module exports, from `export function name`, `export const name` or `as name`. */
function exportsOf(source) {
	const names = new Set();
	for (const match of source.matchAll(
		/export (?:async )?(?:function\*?|const|let|var|class) (\w+)/g
	))
		names.add(match[1]);
	for (const block of source.matchAll(/export \{([^}]*)\}/g)) {
		for (const item of block[1].split(',')) {
			const name = item
				.trim()
				.split(/\s+as\s+/)
				.at(-1);
			if (name) names.add(name);
		}
	}
	return names;
}

/** `source`, the file at `directory`, with the spread written out; `_checks` wins, as in the spread. */
export function narrowFromJsonSchema(source, directory) {
	if (!SPREAD.test(source)) {
		throw new Error(
			"narrow-zod: Zod's from-json-schema.js no longer builds `z` from a spread; review scripts/narrow-zod.mjs"
		);
	}
	const schemas = exportsOf(readFileSync(join(directory, 'schemas.js'), 'utf8'));
	const checks = exportsOf(readFileSync(join(directory, 'checks.js'), 'utf8'));
	const used = new Set(
		[...source.matchAll(/\bz\s*\.\s*([A-Za-z_$][\w$]*)/g)]
			.map((match) => match[1])
			.filter((name) => name !== 'iso')
	);
	if (/\bz\s*\[/.test(source) || /[(,=]\s*z\s*[,)]/.test(source)) {
		throw new Error(
			'narrow-zod: from-json-schema.js reads `z` by a computed name, or passes it on'
		);
	}
	const members = [...used].map((name) => {
		if (checks.has(name)) return `${name}: _checks.${name}`;
		if (schemas.has(name)) return `${name}: _schemas.${name}`;
		throw new Error(`narrow-zod: z.${name} is in neither schemas.js nor checks.js`);
	});
	return source.replace(SPREAD, `const z = { ${members.join(', ')}, iso: _iso };`);
}

const CONFIG = /\.__zod_globalConfig = \{\}\)/;
const CONFIG_FILE = /[\\/]zod[\\/]v4[\\/]core[\\/]core\.js(\?.*)?$/;

/** `source`, Zod's core, whose shared configuration starts `jitless`. */
export function jitlessByDefault(source) {
	if (!CONFIG.test(source)) {
		throw new Error(
			"narrow-zod: Zod's core.js no longer creates `__zod_globalConfig`; review scripts/narrow-zod.mjs"
		);
	}
	return source.replace(CONFIG, '.__zod_globalConfig = { jitless: true })');
}

/**
 * zodJitlessByDefault: a Vite plugin that starts Zod `jitless` in the page. Zod's parsers compile with
 * `new Function` unless told not to, and its probe for that is a CSP violation under `script-src 'self'`,
 * whichever module builds the first object schema. A shared chunk runs before the entry's own code, so
 * `config({ jitless: true })` in the entry comes too late as soon as code is split (phase 1 specification,
 * 9.5). This holds in every chunk, and in any second copy of Zod, which reads the same global.
 */
export function zodJitlessByDefault() {
	return {
		name: 'loam-zod-jitless-by-default',
		enforce: 'pre',
		transform(code, id) {
			if (!CONFIG_FILE.test(id)) return null;
			return { code: jitlessByDefault(code), map: null };
		},
	};
}

export function narrowZodFromJsonSchema() {
	return {
		name: 'loam-narrow-zod-from-json-schema',
		enforce: 'pre',
		transform(code, id) {
			if (!TARGET.test(id)) return null;
			return { code: narrowFromJsonSchema(code, dirname(id.replace(/\?.*$/, ''))), map: null };
		},
	};
}
