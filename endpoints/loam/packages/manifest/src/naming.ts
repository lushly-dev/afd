/**
 * @fileoverview The two pure rules of the core a loader needs: `mutation` from `effects`, and a
 * mounted tool's command name (spec/plugin-manifest.md, K3 and Instances).
 */

import { COMMAND_NAME_PATTERN } from './_generated/facts.js';

const COMMAND_NAME = new RegExp(COMMAND_NAME_PATTERN, 'u');

/** `true` unless `effects` is exactly `["inspect"]`. */
export function deriveMutation(effects: readonly string[]): boolean {
	return !(effects.length === 1 && effects[0] === 'inspect');
}

function normalizeTool(tool: string): string {
	return tool
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.split('-')
		.map((segment) => (/^[0-9]/.test(segment) ? `n${segment}` : segment))
		.join('-');
}

/**
 * The command name of a mounted tool, or `{ unnameable: tool }` when the renaming rule gives none,
 * which the loader reports and does not register.
 */
export function mountCommandName(
	manifestPrefix: string,
	prefix: string,
	tool: string,
	override?: string
): string | { unnameable: string } {
	let command: string;
	if (override !== undefined) command = `${prefix}-${override}`;
	else {
		const normalized = normalizeTool(tool);
		if (normalized === '') return { unnameable: tool };
		command = normalized.startsWith(`${manifestPrefix}-`)
			? `${prefix}-${normalized.slice(manifestPrefix.length + 1)}`
			: `${prefix}-${normalized}`;
	}
	return COMMAND_NAME.test(command) ? command : { unnameable: tool };
}
