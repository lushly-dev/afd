/**
 * @fileoverview Answer server elicitations at the terminal, such as an AFD server's confirmation
 * of a command with `confirmPrompt` (`spec/command-metadata.md`, "Confirmations").
 *
 * Only yes/no forms are asked: every property of the requested schema must be a boolean. Any
 * other form is cancelled, because the CLI cannot collect it safely. The prompt goes to stderr so
 * that stdout keeps only the command's output.
 */

import { createInterface } from 'node:readline/promises';
import type { ElicitationHandler } from '@lushly-dev/afd-client';
import { sanitizeForTerminal } from './terminal.js';

export interface TerminalElicitationOptions {
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
}

/** The boolean property names of a form schema, or `undefined` for any other form. */
function booleanProperties(schema: Record<string, unknown>): string[] | undefined {
	const properties = schema.properties;
	if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined;
	const entries = Object.entries(properties as Record<string, unknown>);
	if (entries.length === 0) return undefined;
	const allBoolean = entries.every(
		([, property]) =>
			!!property &&
			typeof property === 'object' &&
			(property as { type?: unknown }).type === 'boolean'
	);
	return allBoolean ? entries.map(([name]) => name) : undefined;
}

/** Whether an answer is a yes: `y` or `yes`, in any case. Anything else, including empty, is no. */
export function isYes(answer: string): boolean {
	return /^y(es)?$/i.test(answer.trim());
}

/**
 * An elicitation handler that asks at the terminal. A yes accepts with every boolean set to
 * `true`; anything else declines.
 */
export function createTerminalElicitation(
	options: TerminalElicitationOptions = {}
): ElicitationHandler {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stderr;
	return async (request) => {
		const names = booleanProperties(request.requestedSchema);
		const message = sanitizeForTerminal(request.message);
		if (!names) {
			output.write(`The server asked for input the CLI cannot collect: ${message}\n`);
			return { action: 'cancel' };
		}
		const rl = createInterface({ input, output, terminal: false });
		try {
			const answer = await rl.question(`${message} [y/N] `);
			if (!isYes(answer)) return { action: 'decline' };
			return { action: 'accept', content: Object.fromEntries(names.map((name) => [name, true])) };
		} finally {
			rl.close();
		}
	};
}

/** The terminal handler when stdin and stderr are both terminals; none otherwise. */
export function interactiveElicitation(): ElicitationHandler | undefined {
	return process.stdin.isTTY && process.stderr.isTTY ? createTerminalElicitation() : undefined;
}
