#!/usr/bin/env node
/**
 * loam-lint-tokens: the token-only lint (phase 0 specification, section 2.7).
 *
 *   loam-lint-tokens <glob>...
 *
 * Reads CSS from `.css` files and from `css` tagged templates in `.ts` files, and fails on:
 *
 * - raw-color: hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), color(), or a named
 *   color other than `transparent` and `currentColor`; CSS system colors only inside
 *   `@media (forced-colors: active)`.
 * - raw-length: px, rem, em, pt and the other absolute or font-relative units, except 0 and
 *   1px (hairlines). At-rule conditions are not checked: they cannot read custom properties.
 * - unknown-property: `var(--x)` where `--x` is neither a contract property nor a private
 *   alias `--_name`.
 * - private-alias: a private alias neither declared in the same stylesheet from a contract id
 *   (or from another such alias) nor listed in the package's state properties.
 * - primitive: any `ref.*` token (`--ref-*`).
 * - shell-token: a `shell.*` token outside `@lushly-dev/loam-chrome`.
 *
 * The contract is the theme's `dist/contract.json` (theme:build writes it). The linted package
 * is the `package.json` in the working directory: its `name` decides whether shell tokens are
 * allowed, and `loamLintTokens.stateProperties` lists the properties its controller sets through
 * CSSOM from layout state (the chrome's `STATE_PROPERTIES`).
 */
import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHROME_PACKAGE = '@lushly-dev/loam-chrome';

const NAMED_COLORS = new Set(
	`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
	brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
	darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
	darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
	darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
	fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred
	indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
	lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
	lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
	maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
	mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
	navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
	paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple
	red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
	slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
	wheat white whitesmoke yellow yellowgreen`.split(/\s+/)
);

// The current system colors and the deprecated ones, less `Background`, which as a value is far
// more often the property name (`transition-property: background`).
const SYSTEM_COLORS = new Set(
	`accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field
	fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext
	visitedtext activeborder activecaption appworkspace buttonhighlight buttonshadow captiontext
	inactiveborder inactivecaption inactivecaptiontext infobackground infotext menu menutext
	scrollbar threeddarkshadow threedface threedhighlight threedlightshadow threedshadow window
	windowframe windowtext`.split(/\s+/)
);

const COLOR_FUNCTION = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const IDENT = /(?<![\w-])[a-z]+(?![\w(-])/gi;
const LENGTH =
	/(?<![\w.#-])[-+]?(\d*\.\d+|\d+)(rcap|ric|rch|rex|rlh|rem|cap|px|em|pt|pc|in|cm|mm|ex|ch|ic|lh|q)(?![\w-])/gi;
const VAR = /var\(\s*(--[\w-]+)/gi;
const CUSTOM_NAME = /--[\w-]+/g;

/** Same-length replacement, so offsets (and lines) still point into the original text. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/** Comments, strings and `url()` contents blanked; what is left is CSS syntax. */
function maskCss(css) {
	let masked = '';
	let index = 0;
	while (index < css.length) {
		const char = css[index];
		if (css.startsWith('/*', index)) {
			const close = css.indexOf('*/', index + 2);
			const end = close === -1 ? css.length : close + 2;
			masked += blank(css.slice(index, end));
			index = end;
		} else if (char === '"' || char === "'") {
			let end = index + 1;
			while (end < css.length && css[end] !== char && css[end] !== '\n')
				end += css[end] === '\\' ? 2 : 1;
			masked += char + blank(css.slice(index + 1, end));
			index = end;
			if (css[index] === char) {
				masked += char;
				index++;
			}
		} else {
			masked += char;
			index++;
		}
	}
	return masked.replace(/url\(([^)]*)\)/gi, (_match, inner) => `url(${blank(inner)})`);
}

/**
 * The `css` and `css.partial` tagged templates of a TypeScript file, each with its offset in the
 * file and its `${…}` interpolations blanked. A template nested in an interpolation is a sheet
 * of its own.
 */
export function extractTaggedTemplates(source) {
	const sheets = [];
	const tag = /(?<![\w.$])css(?:\.partial)?`/g;
	for (let match = tag.exec(source); match; match = tag.exec(source)) {
		const start = match.index + match[0].length;
		let css = '';
		let index = start;
		while (index < source.length && source[index] !== '`') {
			if (source[index] === '\\') {
				css += source.slice(index, index + 2);
				index += 2;
			} else if (source.startsWith('${', index)) {
				const end = interpolationEnd(source, index + 2);
				css += blank(source.slice(index, end));
				index = end;
			} else {
				css += source[index];
				index += 1;
			}
		}
		sheets.push({ css, offset: start });
		// Search on from inside this template, so a nested `css` template is read on its own.
		tag.lastIndex = start;
	}
	return sheets;
}

/** The index just past the `}` closing an interpolation whose body starts at `index`. */
function interpolationEnd(source, index) {
	let depth = 1;
	let quote = null;
	for (let at = index; at < source.length; at++) {
		const char = source[at];
		if (quote) {
			if (char === '\\') at++;
			else if (char === quote) quote = null;
		} else if (char === '"' || char === "'" || char === '`') quote = char;
		else if (char === '{') depth++;
		else if (char === '}' && --depth === 0) return at + 1;
	}
	return source.length;
}

/**
 * Every declaration of a stylesheet, its value masked, with the offsets of its property and value
 * and whether it is inside `@media (forced-colors: active)`. Declarations outside any block count
 * too, as in a `css.partial` fragment.
 */
function declarations(css) {
	const masked = maskCss(css);
	const found = [];
	const stack = [];
	let segmentStart = 0;
	let depth = 0;
	const take = (end) => {
		const text = masked.slice(segmentStart, end);
		const colon = text.indexOf(':');
		if (colon > 0 && !text.trim().startsWith('@')) {
			const property = text.slice(0, colon).trim();
			found.push({
				property,
				propertyOffset: segmentStart + text.indexOf(property),
				masked: text.slice(colon + 1),
				offset: segmentStart + colon + 1,
				forcedColors: stack.some((entry) => entry.forcedColors),
			});
		}
	};
	for (let index = 0; index < masked.length; index++) {
		const char = masked[index];
		if (char === '(') depth++;
		else if (char === ')') depth = Math.max(0, depth - 1);
		else if (depth > 0) continue;
		else if (char === '{') {
			const prelude = masked.slice(segmentStart, index).trim();
			stack.push({
				forcedColors:
					/^@media\b/i.test(prelude) &&
					/forced-colors\s*:\s*active/i.test(prelude) &&
					!/\bnot\b/i.test(prelude),
			});
			segmentStart = index + 1;
		} else if (char === ';' || char === '}') {
			take(index);
			if (char === '}') stack.pop();
			segmentStart = index + 1;
		}
	}
	take(masked.length);
	return found;
}

/**
 * The violations of one stylesheet. `options`: `properties`, the contract's custom properties;
 * `allowShell`, whether `shell.*` tokens may be read; `stateProperties`, the private aliases
 * set from layout state.
 */
export function lintStylesheet(css, { properties, allowShell, stateProperties = [] }) {
	const violations = [];
	const report = (rule, index, message) => violations.push({ rule, index, message });
	const aliases = new Map();
	const aliasUses = [];

	for (const declaration of declarations(css)) {
		const { masked, offset } = declaration;
		const references = [...masked.matchAll(VAR)].map((match) => ({
			name: match[1],
			index: offset + match.index + match[0].indexOf('--'),
		}));
		for (const { name, index } of references) {
			if (name.startsWith('--ref-'))
				report('primitive', index, `${name} is a primitive; read a semantic token instead`);
			else if (name.startsWith('--_')) aliasUses.push({ name, index });
			else if (!properties.has(name))
				report('unknown-property', index, `${name} is not in the token contract`);
			else if (name.startsWith('--shell-') && !allowShell)
				report('shell-token', index, `${name} is a shell token, read only by ${CHROME_PACKAGE}`);
		}
		const { property, propertyOffset } = declaration;
		if (property.startsWith('--ref-'))
			report('primitive', propertyOffset, `${property} is a primitive; no component may set it`);
		else if (property.startsWith('--shell-') && !allowShell)
			report(
				'shell-token',
				propertyOffset,
				`${property} is a shell token, set only by ${CHROME_PACKAGE}`
			);
		// An alias declared more than once is sound when any of its declarations is.
		if (property.startsWith('--_'))
			aliases.set(property, [
				...(aliases.get(property) ?? []),
				...references.map((reference) => reference.name),
			]);

		const scan = masked.replace(CUSTOM_NAME, blank);
		for (const match of scan.matchAll(HEX))
			report('raw-color', offset + match.index, `${match[0]} is a raw color; use a color token`);
		for (const match of scan.matchAll(COLOR_FUNCTION))
			report('raw-color', offset + match.index, `${match[1]}() is a raw color; use a color token`);
		for (const match of scan.matchAll(IDENT)) {
			const word = match[0].toLowerCase();
			if (NAMED_COLORS.has(word))
				report(
					'raw-color',
					offset + match.index,
					`${match[0]} is a named color; use a color token`
				);
			else if (SYSTEM_COLORS.has(word) && !declaration.forcedColors)
				report(
					'raw-color',
					offset + match.index,
					`${match[0]} is a system color, allowed only inside @media (forced-colors: active)`
				);
		}
		for (const match of scan.matchAll(LENGTH)) {
			const amount = Math.abs(Number(match[1]));
			const unit = match[2].toLowerCase();
			if (amount === 0 || (amount === 1 && unit === 'px')) continue;
			report('raw-length', offset + match.index, `${match[0].trim()} is a raw length; use a token`);
		}
	}

	// A private alias is sound when declared from a contract id, from a state property, or from
	// another sound alias.
	const sound = new Set(stateProperties);
	for (let changed = true; changed; ) {
		changed = false;
		for (const [name, sources] of aliases)
			if (
				!sound.has(name) &&
				sources.some(
					(source) =>
						sound.has(source) ||
						(properties.has(source) && (allowShell || !source.startsWith('--shell-')))
				)
			) {
				sound.add(name);
				changed = true;
			}
	}
	for (const { name, index } of aliasUses)
		if (!sound.has(name))
			report(
				'private-alias',
				index,
				aliases.has(name)
					? `${name} is not declared from a contract id`
					: `${name} is neither declared in this stylesheet nor a state property`
			);

	return violations.sort((a, b) => a.index - b.index);
}

function position(text, index) {
	const before = text.slice(0, index).split('\n');
	return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}

/** The violations of one file, with line and column. */
export function lintSource(text, fileName, options) {
	const sheets = fileName.endsWith('.css')
		? [{ css: text, offset: 0 }]
		: extractTaggedTemplates(text);
	return sheets.flatMap(({ css, offset }) =>
		lintStylesheet(css, options).map(({ rule, index, message }) => ({
			rule,
			message,
			...position(text, offset + index),
		}))
	);
}

/** The custom properties a contract file lists. */
export function contractProperties(contract) {
	return new Set(Object.values(contract.tokens ?? {}).map((entry) => entry.property));
}

export function main(patterns, cwd = process.cwd()) {
	const contractPath = fileURLToPath(new URL('../dist/contract.json', import.meta.url));
	if (!existsSync(contractPath)) {
		console.error(
			`loam-lint-tokens: ${contractPath} is missing; run \`pnpm -F @lushly-dev/loam-theme theme:build\` first`
		);
		return 2;
	}
	if (patterns.length === 0) {
		console.error('loam-lint-tokens: give the source globs to lint, like "src/**/*.ts"');
		return 2;
	}
	const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
	const options = {
		properties: contractProperties(JSON.parse(readFileSync(contractPath, 'utf8'))),
		allowShell: manifest.name === CHROME_PACKAGE,
		stateProperties: manifest.loamLintTokens?.stateProperties ?? [],
	};
	const files = [
		...new Set(
			patterns.flatMap((pattern) =>
				globSync(pattern, { cwd, exclude: (name) => name === 'node_modules' || name === 'dist' })
			)
		),
	].sort();
	if (files.length === 0) {
		console.error(`loam-lint-tokens: no file matches ${patterns.join(' ')} in ${cwd}`);
		return 2;
	}
	let count = 0;
	for (const file of files) {
		if (!file.endsWith('.css') && !file.endsWith('.ts')) continue;
		for (const violation of lintSource(readFileSync(join(cwd, file), 'utf8'), file, options)) {
			count++;
			console.error(
				`${relative(cwd, join(cwd, file))}:${violation.line}:${violation.column} ${violation.rule}: ${violation.message}`
			);
		}
	}
	if (count > 0) {
		console.error(`loam-lint-tokens: ${count} violation(s) in ${files.length} file(s)`);
		return 1;
	}
	console.log(`loam-lint-tokens: ${files.length} file(s), no violations`);
	return 0;
}

// Run as a script or through the bin link, whose path is a symlink to this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
	process.exitCode = main(process.argv.slice(2));
