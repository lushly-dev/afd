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
 * The component token export of 2.4 joins the comparison with step 3, which commits it.
 */
import { readFile } from 'node:fs/promises';
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

export interface CheckOptions {
	/** Outputs already built; built here when absent. */
	outputs?: ThemeOutputs;
	/** The kernel's `LAYOUT_DEFAULTS_V0`, or undefined while the kernel does not export it. */
	layoutDefaults?: unknown;
}

export async function checkTheme(
	contractPath: URL,
	{ outputs, layoutDefaults }: CheckOptions = {}
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
		notes.push(
			'Skipped the shell sizes against LAYOUT_DEFAULTS_V0: @lushly-dev/loam-kernel does not export it yet (step 5 of the phase 0 specification adds it and removes this skip)'
		);
	else errors.push(...compareLayoutDefaults(built.resolved, layoutDefaults));

	return { errors, notes };
}
