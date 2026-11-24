#!/usr/bin/env node
/**
 * A draft of AFD's own theme for the shared components, as a theme set.
 *
 * The components in foundations/fast-af take a theme as data
 * (`installVioletThemeSet`). Their built-in default carries the palette they
 * were first drawn in, which is Lushly's. This writes a set built from the
 * design system the AFD site already has: every colour is a primitive from
 * site/css/tokens-m2.css, read from that file by name, or one of the few
 * listed under ADDED because the site has no such value yet.
 *
 * It is a draft to look at, on the FAST-AF page. Once the values are agreed
 * they belong in Loam's theme tree (endpoints/loam/packages/theme), which is
 * where the built-in default is generated from.
 *
 *   node scripts/build-site-afd-theme.mjs
 *   node scripts/build-site-afd-theme.mjs --check
 *
 * Writes site/fast-af/afd-theme.json, and afd-theme.<name>.json for each
 * candidate in site/fast-af/themes/<name>.json: the same theme with that
 * file's changes over it, for a design pass to compare. afd-themes.json lists
 * them for the review sheets. Nothing is written when any theme misses an id
 * of the components' token interface, keeps a built-in colour or shadow token,
 * or misses a contrast floor. With --check, verifies that every theme builds
 * cleanly and matches the committed files without writing.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Values the site's palette lacks. Each is a tint or shade of a site colour,
// or a warning colour, which the site has never needed.
const ADDED = {
	'red-50': ['#fde6e1', 'a pale tint of red, behind an error message'],
	'red-800': ['#ad2416', 'a shade of red-ink, a destructive button under the pointer'],
	'red-900': ['#96200f', 'a shade of red-ink, a destructive button pressed'],
	'mint-50': ['#dff6ec', 'a pale tint of mint, a selected row or a success message'],
	'amber-50': ['#fdebcc', 'warning background; the site has no warning colour'],
	'amber-300': ['#e5b566', 'warning border'],
	'amber-200': ['#f3d6a3', 'warning text on dark'],
	'amber-800': ['#92400e', 'warning text'],
};

// Text on a surface needs 4.5 to 1; a control's edge or mark needs 3 to 1.
const PAIRS = [
	['color.text.primary', 'color.surface.page', 4.5],
	['color.text.secondary', 'color.surface.page', 4.5],
	['color.text.muted', 'color.surface.page', 4.5],
	['color.text.muted', 'color.surface.card', 4.5],
	['color.text.muted', 'color.surface.subtle', 4.5],
	['color.text.primary', 'color.surface.selected', 4.5],
	['color.text.muted', 'color.surface.selected', 4.5],
	['color.text.primary', 'color.surface.floating', 4.5],
	['color.accent.text', 'color.accent.background', 4.5],
	['color.accent.text', 'color.surface.page', 4.5],
	['color.action.primary.text', 'color.action.primary.background', 4.5],
	['color.action.primary.text', 'color.action.primary.hover', 4.5],
	['color.action.primary.text', 'color.action.primary.pressed', 4.5],
	['color.action.secondary.text', 'color.action.secondary.background', 4.5],
	['color.action.secondary.text', 'color.action.secondary.hover', 4.5],
	['color.action.secondary.text', 'color.action.secondary.pressed', 4.5],
	['color.action.danger.text', 'color.action.danger.background', 4.5],
	['color.action.danger.text', 'color.action.danger.hover', 4.5],
	['color.action.danger.text', 'color.action.danger.pressed', 4.5],
	['color.field.text', 'color.field.background', 4.5],
	['color.field.placeholder', 'color.field.background', 4.5],
	['color.state.danger.text', 'color.state.danger.background', 4.5],
	['color.state.success.text', 'color.state.success.background', 4.5],
	['color.state.warning.text', 'color.state.warning.background', 4.5],
	['color.control.selected.foreground', 'color.control.selected.background', 3],
	['color.control.selected.foreground', 'color.surface.page', 3],
	['color.field.border', 'color.field.background', 3],
	['color.field.border.invalid', 'color.field.background', 3],
	['color.border.strong', 'color.surface.page', 3],
	['color.focus.ring', 'color.surface.page', 3],
];

const BRAND = /^(color|shadow)\./;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function rgb(hex) {
	return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}
function parse(value) {
	if (value.startsWith('#')) return [...rgb(value), 1];
	const parts = value.match(/[\d.]+/g).map(Number);
	return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
/** A colour as it is seen: one with an alpha is laid over the surface behind it. */
function over(value, behind) {
	const [r, g, b, a] = parse(value);
	const [br, bg, bb] = parse(behind);
	return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}
function luminance(channels) {
	const [r, g, b] = channels.map((channel) => {
		const s = channel / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(front, back, page) {
	const behind = over(back, page);
	const backHex = `rgba(${behind.join(', ')}, 1)`;
	const [a, b] = [luminance(over(front, backHex)), luminance(behind)].sort((x, y) => y - x);
	return (a + 0.05) / (b + 0.05);
}

function withoutBuilt(theme) {
	const { built: _built, ...rest } = theme;
	return rest;
}

const list = (tokens) => Object.entries(tokens).map(([id, value]) => ({ id, value }));

function buildBasePresets(site) {
	const used = new Set();
	function c(name) {
		const value = site[name] ?? ADDED[name]?.[0];
		if (!value) throw new Error(`no colour named ${name} on the site or in ADDED`);
		used.add(name);
		return value;
	}
	const alpha = (name, opacity) => {
		const [r, g, b] = rgb(c(name));
		return `rgba(${r}, ${g}, ${b}, ${opacity})`;
	};

	const light = {
		// Surfaces: paper, as on the site.
		'color.surface.page': c('paper'),
		'color.surface.card': c('paper-bright'),
		'color.surface.subtle': c('stone-100'),
		'color.surface.floating': c('paper-bright'),
		'color.surface.highlight': c('white'),
		'color.surface.pressed': c('stone-200'),
		'color.surface.selected': c('mint-50'),
		// Accent: the site's agent mint.
		'color.accent.background': c('mint-50'),
		'color.accent.text': c('mint-ink'),
		// Text: ink.
		'color.text.primary': c('ink'),
		'color.text.secondary': c('ink-soft'),
		'color.text.muted': c('stone-600'),
		// Lines: stone. A control's edge is dark enough to find; a divider is quiet.
		'color.border.strong': c('stone-600'),
		'color.border.subtle': c('stone-300'),
		// The main action is the site's ink button.
		'color.action.primary.background': c('ink'),
		'color.action.primary.hover': c('ink-soft'),
		'color.action.primary.pressed': c('stone-700'),
		'color.action.primary.text': c('paper'),
		// The second action is the site's outlined button.
		'color.action.secondary.background': c('paper-bright'),
		'color.action.secondary.border': c('ink'),
		'color.action.secondary.hover': c('stone-100'),
		'color.action.secondary.pressed': c('stone-200'),
		'color.action.secondary.text': c('ink'),
		'color.action.danger.background': c('red-ink'),
		'color.action.danger.hover': c('red-800'),
		'color.action.danger.pressed': c('red-900'),
		'color.action.danger.text': c('white'),
		// What is on, checked or chosen: mint, marked in the site's mint ink.
		'color.control.selected.background': c('mint'),
		'color.control.selected.border': c('mint-ink'),
		'color.control.selected.foreground': c('mint-ink'),
		'color.field.background': c('paper-bright'),
		'color.field.background.readonly': c('stone-100'),
		'color.field.border': c('stone-600'),
		'color.field.border.hover': c('ink'),
		'color.field.border.focus': c('blue-ink'),
		'color.field.border.invalid': c('red-ink'),
		'color.field.placeholder': c('stone-600'),
		'color.field.text': c('ink'),
		// The site's focus colour.
		'color.focus.ring': c('blue-ink'),
		'color.state.danger.background': c('red-50'),
		'color.state.danger.border': c('red-300'),
		'color.state.danger.foreground': c('red-ink'),
		'color.state.danger.text': c('red-ink'),
		'color.state.success.background': c('mint-50'),
		'color.state.success.border': c('mint-600'),
		'color.state.success.foreground': c('mint-ink'),
		'color.state.success.text': c('mint-ink'),
		'color.state.warning.background': c('amber-50'),
		'color.state.warning.border': c('amber-300'),
		'color.state.warning.text': c('amber-800'),
		// Type: the site's two working faces.
		'font.family.body': '"Space Grotesk", "Segoe UI", system-ui, sans-serif',
		'font.family.mono': '"IBM Plex Mono", ui-monospace, Consolas, monospace',
		// Structure: square, ruled, and a hard shadow under what floats.
		'radius.sm': '0px',
		'radius.md': '0px',
		'radius.lg': '0px',
		'size.focus-ring.width': '3px',
		'shadow.control': '0 0 0 0 transparent',
		'shadow.well': '0 0 0 0 transparent',
		'shadow.card': `0 0 0 1px ${c('stone-300')}`,
		'shadow.floating': `0 0 0 1px ${c('ink')}, 4px 4px 0 ${c('ink')}`,
	};

	const dark = {
		// Surfaces: the site's ink field and its deep greens.
		'color.surface.page': c('ink'),
		'color.surface.card': c('ink-raised'),
		'color.surface.subtle': c('green-700'),
		'color.surface.floating': c('green-800'),
		'color.surface.pressed': c('ink-soft'),
		'color.surface.selected': c('green-900'),
		'color.accent.background': c('green-900'),
		'color.accent.text': c('mint'),
		'color.text.primary': c('paper'),
		'color.text.secondary': c('green-200'),
		'color.text.muted': c('stone-400'),
		'color.border.strong': c('stone-500'),
		'color.border.subtle': c('ink-soft'),
		'color.action.primary.background': c('paper'),
		'color.action.primary.hover': c('stone-200'),
		'color.action.primary.pressed': c('stone-300'),
		'color.action.primary.text': c('ink'),
		'color.action.secondary.background': c('ink-raised'),
		'color.action.secondary.border': c('stone-400'),
		'color.action.secondary.hover': c('green-700'),
		'color.action.secondary.pressed': c('ink-soft'),
		'color.action.secondary.text': c('paper'),
		'color.control.selected.background': c('green-900'),
		'color.control.selected.border': alpha('mint', 0.45),
		'color.control.selected.foreground': c('mint'),
		'color.field.background': c('ink'),
		'color.field.background.readonly': c('green-800'),
		'color.field.border': c('stone-500'),
		'color.field.border.hover': c('paper'),
		'color.field.border.focus': c('mint'),
		'color.field.border.invalid': c('red-300'),
		'color.field.placeholder': c('stone-400'),
		'color.field.text': c('paper'),
		'color.focus.ring': c('mint'),
		'color.state.danger.background': alpha('red-ink', 0.32),
		'color.state.danger.border': alpha('red-300', 0.45),
		'color.state.danger.text': c('red-200'),
		'color.state.success.background': alpha('mint', 0.14),
		'color.state.success.border': alpha('mint', 0.4),
		'color.state.success.text': c('mint'),
		'color.state.warning.background': alpha('amber-800', 0.38),
		'color.state.warning.border': alpha('amber-300', 0.45),
		'color.state.warning.text': c('amber-200'),
		'shadow.well': '0 0 0 0 transparent',
		'shadow.card': `0 0 0 1px ${c('ink-soft')}`,
		'shadow.floating': `0 0 0 1px ${c('stone-400')}, 4px 4px 0 ${c('black')}`,
	};

	return { light, dark, used };
}

/**
 * Builds or checks all AFD site themes under `root/site/fast-af`.
 *
 * @param {object} [options]
 * @param {string} [options.root] repository root
 * @param {boolean} [options.check] verify committed files match without writing
 * @param {string} [options.today] ISO date (YYYY-MM-DD) for newly written files
 */
export function buildSiteAfdThemes({
	root = defaultRoot,
	check = false,
	today = new Date().toISOString().slice(0, 10),
} = {}) {
	const libraryDir = join(root, 'foundations/fast-af/packages/violet-elements');
	const tokensCss = readFileSync(join(root, 'site/css/tokens-m2.css'), 'utf8');
	const site = Object.fromEntries(
		[...tokensCss.matchAll(/--afd-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, name, hex]) => [
			name,
			hex,
		])
	);

	const { light, dark, used } = buildBasePresets(site);

	// The ids that carry no brand (sizes, spacing, type scale, motion, layers)
	// keep the built-in values, and high contrast keeps its black and white.
	const builtIn = readJson(join(libraryDir, 'tokens/violet-theme.export.json')).presets;
	const base = Object.fromEntries(builtIn.light.map(({ id, value }) => [id, value]));
	const highContrast = Object.fromEntries(
		builtIn['high-contrast'].filter(({ id }) => BRAND.test(id)).map(({ id, value }) => [id, value])
	);
	highContrast['shadow.floating'] = '0 0 0 2px #000000, 4px 4px 0 #000000';
	const tokenInterface = readJson(join(libraryDir, 'tokens/interface.json')).tokens;

	/**
	 * One theme: the base above, with a candidate's changes over it. A candidate
	 * is a file in site/fast-af/themes/, written for a design pass:
	 *
	 *   { "title", "note", "added": { name: [hex, why] },
	 *     "light": { id: value }, "dark": { id: value }, "high-contrast": { id: value },
	 *     "css": ["what it needs that a token cannot say"],
	 *     "extends": "another candidate, whose changes come first",
	 *     "adds": ["an id the components' interface does not have yet, which this candidate sets"] }
	 *
	 * In a value, `@name` is a colour by name and `@name/0.4` the same at 40%.
	 *
	 * Beside it, <name>.css may hold a patch: changes to the components' own CSS,
	 * to try on the review pages before anyone edits the package. Each part
	 * starts with a comment naming the components it is for, and is added to
	 * their shadow roots as it stands:
	 *
	 *   /* @component violet-switch *\/
	 *   .track { border-radius: 6px; }
	 *   /* @component violet-text-field, violet-text-area *\/
	 *   .label { font-weight: 500; }
	 */
	function build(name, candidate = {}) {
		const extra = candidate.added ?? {};
		// Ids this candidate proposes for the interface: a set may carry ids the interface lacks.
		const adds = new Set(candidate.adds ?? []);
		const seen = new Set(used);
		const colour = (key) => {
			const value = site[key] ?? ADDED[key]?.[0] ?? extra[key]?.[0];
			if (!value) throw new Error(`no colour named ${key}`);
			seen.add(key);
			return value;
		};
		const value = (text) =>
			String(text).replace(/@([a-z0-9-]+)(?:\/([\d.]+))?/g, (_, key, opacity) => {
				const hex = colour(key);
				return opacity ? `rgba(${rgb(hex).join(', ')}, ${opacity})` : hex;
			});
		const changes = (preset) =>
			Object.fromEntries(
				Object.entries(candidate[preset] ?? {}).map(([id, text]) => [id, value(text)])
			);

		const own = {
			light: { ...light, ...changes('light') },
			dark: { ...dark, ...changes('dark') },
			'high-contrast': { ...highContrast, ...changes('high-contrast') },
		};
		const resolved = {
			light: { ...base, ...own.light },
			dark: { ...base, ...own.light, ...own.dark },
			'high-contrast': { ...base, ...own.light, ...own['high-contrast'] },
		};

		const failures = [];
		for (const id of Object.keys(tokenInterface)) {
			if (!(id in resolved.light)) failures.push(`light supplies no ${id}`);
		}
		for (const id of Object.keys(base)) {
			if (BRAND.test(id) && !(id in own.light)) failures.push(`light keeps the built-in ${id}`);
		}
		for (const preset of Object.keys(own)) {
			for (const id of Object.keys(own[preset])) {
				if (!(id in base) && !adds.has(id)) {
					failures.push(`${preset} sets ${id}, which is not a token the components read`);
				}
			}
		}
		const contrast = [];
		for (const [preset, tokens] of Object.entries(resolved)) {
			for (const [front, back, floor] of PAIRS) {
				const measured = ratio(tokens[front], tokens[back], tokens['color.surface.page']);
				contrast.push({ preset, front, back, floor, ratio: Math.round(measured * 100) / 100 });
				if (measured < floor)
					failures.push(`${preset}: ${front} on ${back} is ${measured.toFixed(2)}, under ${floor}`);
			}
		}

		const names = [...seen];
		return {
			failures,
			theme: {
				name,
				title: candidate.title ?? 'AFD',
				note: candidate.note,
				status: 'draft',
				built: today,
				from: 'site/css/tokens-m2.css',
				// What the set is drawn from: the site's own colours, and the few it lacks.
				palette: {
					site: Object.fromEntries(
						names.filter((key) => key in site).map((key) => [key, site[key]])
					),
					added: Object.fromEntries(
						names
							.filter((key) => !(key in site))
							.map((key) => [
								key,
								{ value: (ADDED[key] ?? extra[key])[0], why: (ADDED[key] ?? extra[key])[1] },
							])
					),
				},
				// What the candidate needs that a token cannot say: changes to a component's own CSS.
				css: candidate.css ?? [],
				// The same, tried out: CSS the review pages add to each component's shadow root.
				patch: candidate.patch ?? {},
				contrast,
				// The set itself, as installVioletThemeSet takes it. A preset lists what it
				// sets and inherits the rest from the default.
				set: {
					defaultPreset: 'light',
					presets: {
						light: list(resolved.light),
						dark: list(own.dark),
						'high-contrast': list(own['high-contrast']),
					},
				},
			},
		};
	}

	const outDir = join(root, 'site/fast-af');
	const candidatesDir = join(outDir, 'themes');
	const candidates = existsSync(candidatesDir)
		? readdirSync(candidatesDir)
				.filter((file) => /^[a-z0-9-]+\.json$/.test(file))
				.sort()
		: [];

	if (candidates.length === 0) {
		return {
			ok: false,
			errors: ['no theme candidates found in site/fast-af/themes/'],
			summaries: [],
		};
	}

	/** A candidate's patch file, split into the CSS for each component it names. */
	function patchOf(name) {
		const file = join(candidatesDir, `${name}.css`);
		if (!existsSync(file)) return undefined;
		const parts = readFileSync(file, 'utf8').split(/\/\*\s*@component\s+([a-z0-9-,\s]+?)\s*\*\//);
		const patch = {};
		for (let at = 1; at < parts.length; at += 2) {
			for (const tag of parts[at].split(',').map((item) => item.trim())) {
				patch[tag] = `${patch[tag] ?? ''}${parts[at + 1].trim()}\n`;
			}
		}
		return patch;
	}

	/** A candidate with what it extends underneath it, and its patch. */
	function load(name, seen = []) {
		if (seen.includes(name)) throw new Error(`${name} extends itself`);
		const own = readJson(join(candidatesDir, `${name}.json`));
		const under = own.extends ? load(own.extends, [...seen, name]) : {};
		const merged = { ...under, ...own };
		for (const key of ['added', 'light', 'dark', 'high-contrast'])
			merged[key] = { ...under[key], ...own[key] };
		const patch = patchOf(name);
		merged.patch = patch ?? under.patch ?? {};
		merged.css = own.css ?? [];
		merged.adds = [...(under.adds ?? []), ...(own.adds ?? [])];
		return merged;
	}

	const errors = [];
	const built = [];
	const index = [];
	const summaries = [];

	for (const [name, candidate] of [
		[null, {}],
		...candidates.map((file) => [file.replace(/\.json$/, ''), load(file.replace(/\.json$/, ''))]),
	]) {
		const file = name ? `afd-theme.${name}.json` : 'afd-theme.json';
		let result;
		try {
			result = build(name ?? 'afd', candidate);
		} catch (error) {
			result = { failures: [error.message] };
		}
		if (result.failures.length > 0) {
			errors.push(`${file} was not written:\n  ${result.failures.join('\n  ')}`);
			continue;
		}
		built.push({ file, theme: result.theme });
		index.push({ name, title: name ? result.theme.title : 'AFD (draft)', note: result.theme.note });
		const { contrast, palette } = result.theme;
		const lowest = contrast.reduce((a, b) => (a.ratio - a.floor < b.ratio - b.floor ? a : b));
		summaries.push(
			`${file}: ${Object.keys(palette.site).length} site colours, ${Object.keys(palette.added).length} added, ${contrast.length} pairs measured; closest ${lowest.preset} ${lowest.front} on ${lowest.back}, ${lowest.ratio} (floor ${lowest.floor})`
		);
	}

	if (errors.length > 0) {
		return { ok: false, errors, summaries };
	}

	const expectedFiles = new Set(built.map((entry) => entry.file));
	const indexText = `${JSON.stringify(index, null, '\t')}\n`;

	if (check) {
		for (const { file, theme } of built) {
			const fullPath = join(outDir, file);
			if (!existsSync(fullPath)) {
				errors.push(
					`site/fast-af/${file} is missing; run \`node scripts/build-site-afd-theme.mjs\``
				);
				continue;
			}
			let committed;
			try {
				committed = readJson(fullPath);
			} catch (error) {
				errors.push(`site/fast-af/${file} is not valid JSON: ${error.message}`);
				continue;
			}
			if (typeof committed.built !== 'string' || !ISO_DAY.test(committed.built)) {
				errors.push(
					`site/fast-af/${file} has invalid built date; run \`node scripts/build-site-afd-theme.mjs\``
				);
				continue;
			}
			const expectedText = `${JSON.stringify({ ...theme, built: committed.built }, null, '\t')}\n`;
			const actualText = readFileSync(fullPath, 'utf8');
			if (actualText !== expectedText) {
				errors.push(
					`site/fast-af/${file} is out of date; run \`node scripts/build-site-afd-theme.mjs\``
				);
			}
		}

		const indexPath = join(outDir, 'afd-themes.json');
		if (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== indexText) {
			errors.push(
				'site/fast-af/afd-themes.json is out of date; run `node scripts/build-site-afd-theme.mjs`'
			);
		}

		for (const existing of readdirSync(outDir)) {
			if (/^afd-theme(?:\.[a-z0-9-]+)?\.json$/.test(existing) && !expectedFiles.has(existing)) {
				errors.push(`site/fast-af/${existing} has no matching candidate in site/fast-af/themes/`);
			}
		}

		return { ok: errors.length === 0, errors, summaries };
	}

	for (const { file, theme } of built) {
		const fullPath = join(outDir, file);
		let outputTheme = theme;
		if (existsSync(fullPath)) {
			try {
				const existing = readJson(fullPath);
				if (
					typeof existing.built === 'string' &&
					ISO_DAY.test(existing.built) &&
					JSON.stringify(withoutBuilt(existing)) === JSON.stringify(withoutBuilt(theme))
				) {
					outputTheme = { ...theme, built: existing.built };
				}
			} catch {
				// Unreadable or invalid existing output: overwrite cleanly with today's built date.
			}
		}
		writeFileSync(fullPath, `${JSON.stringify(outputTheme, null, '\t')}\n`);
	}
	// The themes there are to look at, for the review sheets.
	writeFileSync(join(outDir, 'afd-themes.json'), indexText);
	return { ok: true, errors: [], summaries };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const unknown = args.filter((arg) => arg !== '--check');
	if (unknown.length > 0) {
		console.error(`Unknown argument(s): ${unknown.join(', ')}`);
		console.error('Usage: node scripts/build-site-afd-theme.mjs [--check]');
		process.exit(1);
	}
	const check = args.includes('--check');
	const result = buildSiteAfdThemes({ check });
	for (const line of result.summaries) console.log(line);
	for (const error of result.errors) console.error(error);
	if (!result.ok) process.exit(1);
}
