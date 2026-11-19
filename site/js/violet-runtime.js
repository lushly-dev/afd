// The Violet pages are Violet apps. The token tree on the page is a real
// in-memory Violet store, and every edit runs a real command on the
// @lushly-dev/violet-afd registry (bundled in vendor/). A person's edits and
// Alfred's go through the same call(); listeners render what comes back.

import { createMemoryDatabase, initializeWorkerCore, registry } from './vendor/violet.js';
import { seedTree } from './violet-seed.js';

initializeWorkerCore();

let db = createMemoryDatabase();
const listeners = new Set();

/** Every command the Violet registry exposes: { name, description, category }. */
export const listCommands = () => registry.list();

/** The JSON Schema of a command's input, the one its MCP tool carries. */
export const inputSchema = (name) => registry.getInputJsonSchema(name);

/** How many commands the Violet registry exposes. */
export const commandCount = listCommands().length;

/**
 * Run one Violet command. `actor` is who asked: 'you' or 'alfred'. Reads the
 * page makes to redraw itself pass `quiet`, so they stay out of the trail.
 */
export async function call(name, input = {}, { actor = 'you', quiet = false } = {}) {
	const result = await registry.execute(name, input, { db, actor });
	if (!quiet) for (const listener of listeners) listener({ name, input, result, actor });
	return result;
}

/** A read the page makes for itself. */
export const read = (name, input = {}) => call(name, input, { quiet: true });

/** Hear about every command that was not quiet. Returns a function that stops listening. */
export function onCommand(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Throw the tree away and build the starting one again. */
export async function start() {
	db = createMemoryDatabase();
	return seedTree((name, input) => registry.execute(name, input, { db, actor: 'seed' }));
}

/**
 * Everything the page draws, read in one pass: each node with its resolved
 * tokens, the rules that apply to it and how its tokens did against them.
 */
export async function snapshot() {
	const graph = (await read('nodes.graph')).data;
	const nodes = await Promise.all(
		graph.nodes.map(async (node) => {
			const [resolved, rules, checked] = await Promise.all([
				read('tokens.resolve', { nodeId: node.id }),
				read('constraints.list', { nodeId: node.id }),
				read('constraints.validate', { nodeId: node.id }),
			]);
			const failures = (checked.data?.results ?? []).flatMap((result) =>
				result.violations.map((violation) => ({ tokenId: result.tokenId, ...violation }))
			);
			return {
				id: node.id,
				type: node.type,
				parentId: node.parentId,
				depth: node.depth,
				removed: node.subtractedTokens ?? [],
				chain: resolved.data?.ancestryChain ?? [],
				tokens: resolved.data?.tokens ?? [],
				rules: rules.data?.constraints ?? [],
				failures,
			};
		})
	);
	return { nodes, byId: Object.fromEntries(nodes.map((node) => [node.id, node])) };
}
