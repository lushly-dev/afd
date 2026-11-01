/**
 * `theme:check` (2.1, 2.3): rebuild the outputs in memory and compare them with the committed
 * files and the kernel. `dist/` is build output and never compared.
 *
 * - `contract/tokens.json` must equal the contract the tree gives, id for id, and every node
 *   must resolve to exactly the contract's ids.
 * - No token may have a broken reference.
 * - The shell size defaults must equal the kernel's `LAYOUT_DEFAULTS_V0` (5.2), which the
 *   caller passes in: `scripts/theme.mjs` imports it from `@lushly-dev/loam-kernel`, a
 *   development dependency. Until step 5 of the phase 0 specification adds that constant, it is
 *   undefined and the comparison is skipped with a note.
 *
 * - With the component paths (2.4), the committed `violet-elements` export must equal the one
 *   the tree gives, byte for byte, and every literal fallback of a component id in
 *   `violet-elements/src` must equal its light value after normalization.
 */
import { readdir, readFile } from 'node:fs/promises';
import { type ComponentExport, lightValuesByProperty, scanFallbacks } from './components.js';
import { buildOutputs, type Contract, type ResolvedTree, type ThemeOutputs } from './outputs.js';
import { LAYOUT_DEFAULT_TOKENS, NODE_IDS } from './tree/index.js';

export interface CheckReport {
	errors: string[];
	notes: string[];
}

/** Every difference between the committed contract and the tree's. */
export function compareContract(committed: unknown, built: Contract): string[] {
	const fix = 'run `pnpm -F @lushly-dev/loam-theme theme:check --write` and review the diff';
	if (typeof committed !== 'object' || committed === null || Array.isArray(committed))
		return [`contract/tokens.json is not a JSON object; ${fix}`];
	const file = committed as Partial<Contract>;
	const errors: string[] = [];
	if (file.contractVersion !== built.contractVersion)
		errors.push(
			`contract/tokens.json has contractVersion ${String(file.contractVersion)}, the tree ${built.contractVersion}`
		);
	const listed = file.tokens ?? {};
	for (const id of Object.keys(built.tokens))
		if (!(id in listed)) errors.push(`'${id}' is in the tree but not in the contract; ${fix}`);
	for (const [id, entry] of Object.entries(listed)) {
		const expected = built.tokens[id];
		if (!expected) errors.push(`'${id}' is in the contract but not in the tree; ${fix}`);
		else if (JSON.stringify(entry) !== JSON.stringify(expected))
			errors.push(
				`'${id}' is ${JSON.stringify(entry)} in the contract and ${JSON.stringify(expected)} in the tree; ${fix}`
			);
	}
	return errors;
}

const at = (value: unknown, path: string): unknown =>
	path
		.split('.')
		.reduce<unknown>(
			(current, key) =>
				typeof current === 'object' && current !== null
					? (current as Record<string, unknown>)[key]
					: undefined,
			value
		);

/** Every shell size, in every node, that disagrees with a `LAYOUT_DEFAULTS_V0`-shaped value. */
export function compareLayoutDefaults(resolved: ResolvedTree, defaults: unknown): string[] {
	const errors: string[] = [];
	for (const [path, tokenId] of Object.entries(LAYOUT_DEFAULT_TOKENS)) {
		const expected = at(defaults, path);
		if (typeof expected !== 'number') {
			errors.push(`LAYOUT_DEFAULTS_V0.${path} is not a number`);
			continue;
		}
		for (const nodeId of NODE_IDS) {
			const value = resolved.nodes.get(nodeId)?.get(tokenId);
			if (value !== `${expected}px`)
				errors.push(
					`${tokenId} is ${String(value)} in ${nodeId}, but LAYOUT_DEFAULTS_V0.${path} is ${expected}; change one so they agree`
				);
		}
	}
	return errors;
}

/**
 * Every id a theme or density node has that the contract lacks, or the reverse. Violet treats
 * an `override` of an id no ancestor has as an `add`, so a misspelt override shows up here.
 */
export function compareNodeIds(resolved: ResolvedTree, contract: Contract): string[] {
	const errors: string[] = [];
	for (const [nodeId, tokens] of resolved.nodes) {
		for (const id of tokens.keys())
			if (!(id in contract.tokens))
				errors.push(`'${id}' is in ${nodeId} but not in the contract; is an override misspelt?`);
		for (const id of Object.keys(contract.tokens))
			if (!tokens.has(id)) errors.push(`'${id}' is in the contract but not in ${nodeId}`);
	}
	return errors;
}

const EXPORT_FIX =
	'run `pnpm -F @lushly-dev/loam-theme theme:export-components`, then `pnpm -F @lushly-dev/violet-elements theme:build` and `cem:analyze` (the manifest records the generated theme), and record every changed file in foundations/fast-af/provenance/adaptations.json';

/** Every difference between the committed component export and the tree's. */
export function compareComponentExport(committedText: string, built: ThemeOutputs): string[] {
	if (committedText === built.componentExportJson) return [];
	let committed: Partial<ComponentExport>;
	try {
		committed = JSON.parse(committedText);
	} catch (error) {
		return [`violet-theme.export.json is not JSON (${(error as Error).message}); ${EXPORT_FIX}`];
	}
	const errors: string[] = [];
	const expected = built.componentExport;
	if (
		committed.contractVersion !== expected.contractVersion ||
		committed.source !== expected.source
	)
		errors.push(
			`violet-theme.export.json has contractVersion ${String(committed.contractVersion)} and source ${String(committed.source)}, the tree ${expected.contractVersion} and ${expected.source}`
		);
	const committedPresets: Record<string, unknown> =
		typeof committed.presets === 'object' && committed.presets !== null ? committed.presets : {};
	for (const theme of Object.keys(committedPresets))
		if (!(theme in expected.presets))
			errors.push(`violet-theme.export.json has a preset '${theme}' that the tree does not`);
	for (const [theme, tokens] of Object.entries(expected.presets)) {
		const preset = committedPresets[theme];
		if (!Array.isArray(preset)) {
			errors.push(`violet-theme.export.json has no ${theme} preset list`);
			continue;
		}
		const listed = new Map(
			(preset as { id: string; value: string }[]).map((token) => [token.id, token.value])
		);
		if (listed.size !== preset.length)
			errors.push(`violet-theme.export.json has a repeated id in ${theme}`);
		for (const { id, value } of tokens)
			if (listed.get(id) !== value)
				errors.push(
					`violet-theme.export.json has ${id} ${JSON.stringify(listed.get(id))} in ${theme}, the tree ${JSON.stringify(value)}`
				);
		for (const id of listed.keys())
			if (!tokens.some((token) => token.id === id))
				errors.push(`violet-theme.export.json has ${id} in ${theme}, which is not a component id`);
	}
	if (errors.length === 0)
		errors.push('violet-theme.export.json has the right content but not the generated formatting');
	errors.push(`To update the export, ${EXPORT_FIX}`);
	return errors;
}

/** The component export and the fallback source of `violet-elements` (2.4). */
export interface ComponentPaths {
	/** `tokens/violet-theme.export.json`. */
	exportPath: URL;
	/** `src/`, whose `.ts` files are scanned for `var(--<component id>, <literal>)`. */
	sourceDirectory: URL;
}

/** Every `.ts` file under `directory`, as paths relative to it, in code-point order. */
export async function sourceFiles(directory: URL): Promise<{ path: string; text: string }[]> {
	const paths = (await readdir(directory, { recursive: true }))
		.filter((path) => path.endsWith('.ts'))
		.map((path) => path.split('\\').join('/'))
		.sort();
	return Promise.all(
		paths.map(async (path) => ({ path, text: await readFile(new URL(path, directory), 'utf8') }))
	);
}

async function checkComponents(built: ThemeOutputs, paths: ComponentPaths): Promise<string[]> {
	const errors: string[] = [];
	try {
		errors.push(...compareComponentExport(await readFile(paths.exportPath, 'utf8'), built));
	} catch (error) {
		errors.push(
			`violet-theme.export.json cannot be read: ${(error as Error).message}; ${EXPORT_FIX}`
		);
	}
	let files: { path: string; text: string }[];
	try {
		files = await sourceFiles(paths.sourceDirectory);
	} catch (error) {
		errors.push(`violet-elements/src cannot be read: ${(error as Error).message}`);
		return errors;
	}
	const mismatches = scanFallbacks(
		files,
		lightValuesByProperty(built.componentExport, built.contract)
	);
	for (const mismatch of mismatches)
		errors.push(
			`violet-elements/src/${mismatch.path}:${mismatch.line}: var(${mismatch.property}, ${mismatch.literal}) differs from the light value ${mismatch.expected}`
		);
	if (mismatches.length > 0)
		errors.push(
			`${mismatches.length} fallbacks differ from the light theme; run \`pnpm -F @lushly-dev/loam-theme theme:export-components --fallbacks\` to rewrite them, then \`pnpm -F @lushly-dev/violet-elements cem:analyze\` (the manifest records the style defaults), and record every edited file in foundations/fast-af/provenance/adaptations.json`
		);
	return errors;
}

export interface CheckOptions {
	/** Outputs already built; built here when absent. */
	outputs?: ThemeOutputs;
	/** The kernel's `LAYOUT_DEFAULTS_V0`; missing is an error. */
	layoutDefaults?: unknown;
	/** `violet-elements`' export and source; the component checks are skipped when absent. */
	components?: ComponentPaths;
}

export async function checkTheme(
	contractPath: URL,
	{ outputs, layoutDefaults, components }: CheckOptions = {}
): Promise<CheckReport> {
	const built = outputs ?? (await buildOutputs());
	const errors: string[] = built.resolved.brokenReferences.map(
		(broken) => `${broken.tokenId} in ${broken.nodeId}: ${broken.message}`
	);
	const notes: string[] = [];

	let committed: unknown;
	try {
		committed = JSON.parse(await readFile(contractPath, 'utf8'));
	} catch (error) {
		errors.push(`contract/tokens.json cannot be read: ${(error as Error).message}`);
	}
	errors.push(...compareNodeIds(built.resolved, built.contract));
	if (committed !== undefined) {
		errors.push(...compareContract(committed, built.contract));
		if (
			errors.length === 0 &&
			(await readFile(contractPath, 'utf8')) !== built.files['contract.json']
		)
			errors.push(
				'contract/tokens.json has the right content but not the generated formatting; run `pnpm -F @lushly-dev/loam-theme theme:check --write`'
			);
	}

	if (layoutDefaults === undefined)
		errors.push(
			'LAYOUT_DEFAULTS_V0 is missing: @lushly-dev/loam-kernel must export it from its root (section 5.2 of the phase 0 specification); build the kernel first'
		);
	else errors.push(...compareLayoutDefaults(built.resolved, layoutDefaults));

	if (components === undefined)
		notes.push(
			'Skipped the component export and the fallback scan: no violet-elements paths given (theme:check gives them)'
		);
	else errors.push(...(await checkComponents(built, components)));

	return { errors, notes };
}
