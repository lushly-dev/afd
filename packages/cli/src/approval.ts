/**
 * @fileoverview The `afd call` approval flow (`spec/command-metadata.md`, "Approvals").
 *
 * When a call fails with `APPROVAL_REQUIRED`, the CLI shows the summary and expiry, gets a
 * decision (a terminal prompt, or `--approve`), and retries the same command and input with the
 * server's `details.approvalToken` as the context's approval evidence. The CLI never makes a
 * token: it only hands back the one the server issued for this call, and the server checks that
 * the token is bound to the command, input and actor.
 *
 * The evidence must reach the server outside the tool arguments (rule 1), so this flow runs only
 * where the CLI owns the context: a registry loaded in-process with `--module`. Over MCP there is
 * no trusted channel for it yet (#418), so the result is returned unchanged.
 */

import { createInterface } from 'node:readline/promises';
import type { CommandResult } from '@lushly-dev/afd-core';
import { isYes } from './elicitation.js';
import { sanitizeForTerminal } from './terminal.js';

/** `error.details` of an `APPROVAL_REQUIRED` result. */
export interface ApprovalDetails {
	approvalToken?: string;
	expiresAt?: string;
	summary?: string;
	/** Why a supplied token was not accepted, such as `expired` or `input-mismatch`. */
	reason?: string;
}

/** The approval details of an `APPROVAL_REQUIRED` result, or `undefined` for any other result. */
export function approvalDetails(result: CommandResult): ApprovalDetails | undefined {
	if (result.success || result.error?.code !== 'APPROVAL_REQUIRED') return undefined;
	const details = result.error.details;
	if (!details || typeof details !== 'object') return {};
	const pick = (key: keyof ApprovalDetails) =>
		typeof details[key] === 'string' ? { [key]: details[key] as string } : {};
	return {
		...pick('approvalToken'),
		...pick('expiresAt'),
		...pick('summary'),
		...pick('reason'),
	};
}

/** The lines shown before asking for a decision, sanitized for the terminal. */
export function describeApproval(command: string, details: ApprovalDetails): string {
	const lines = [`${sanitizeForTerminal(command)} needs approval before it runs.`];
	if (details.reason) {
		lines.push(`The previous approval was not accepted (${sanitizeForTerminal(details.reason)}).`);
	}
	if (details.summary) lines.push(`Action: ${sanitizeForTerminal(details.summary)}`);
	if (details.expiresAt) lines.push(`Approval expires: ${sanitizeForTerminal(details.expiresAt)}`);
	return `${lines.join('\n')}\n`;
}

/** Asks a human whether to approve. Resolves `true` only on a yes. */
export type ApprovalPrompt = (command: string, details: ApprovalDetails) => Promise<boolean>;

export interface TerminalApprovalOptions {
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
}

/** A prompt that asks `Approve? [y/N]` at the terminal, on stderr so stdout keeps the result. */
export function createTerminalApproval(options: TerminalApprovalOptions = {}): ApprovalPrompt {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stderr;
	return async () => {
		const rl = createInterface({ input, output, terminal: false });
		// End of input (Ctrl-D) closes the interface without answering: that is a no.
		const closed = new Promise<string>((resolve) => rl.once('close', () => resolve('')));
		try {
			return isYes(await Promise.race([rl.question('Approve? [y/N] '), closed]));
		} finally {
			rl.close();
		}
	};
}

/** The terminal prompt when stdin and stderr are both terminals; none otherwise. */
export function interactiveApproval(): ApprovalPrompt | undefined {
	return process.stdin.isTTY && process.stderr.isTTY ? createTerminalApproval() : undefined;
}

/** Rejections a fresh approval can get past; any other means retrying would not help. */
const RETRYABLE_REJECTIONS = new Set(['expired', 'already-used']);

export interface ApprovalFlowOptions {
	/** Approve without asking (`--approve`): once, and only with a token the server returned. */
	approve?: boolean;
	/** Asks the human; without it and without `approve`, the held result is returned unchanged. */
	prompt?: ApprovalPrompt;
	/** Where the summary and expiry are written. Default: stderr. */
	output?: NodeJS.WritableStream;
}

/**
 * Run a call, and while it is held for approval and a decision allows it, retry it with the
 * token the server returned. `execute` must run the same command, input and context every time,
 * adding only `approval` as the context's approval evidence.
 *
 * Returns the last result: the command's own result after an accepted approval, or the
 * `APPROVAL_REQUIRED` result unchanged when nobody approved, the result had no token, or the
 * server rejected the token. `--approve` retries once; a prompt asks again after a token
 * expired or was already used, since each retry then needs another yes.
 */
export async function callWithApproval(
	command: string,
	execute: (approval?: string) => Promise<CommandResult>,
	options: ApprovalFlowOptions = {}
): Promise<CommandResult> {
	const output = options.output ?? process.stderr;
	let result = await execute();
	let autoApproved = false;
	for (;;) {
		const details = approvalDetails(result);
		if (!details) return result;
		output.write(describeApproval(command, details));
		// Only a token that ran out or was spent can be fixed by asking again.
		if (details.reason !== undefined && !RETRYABLE_REJECTIONS.has(details.reason)) return result;
		if (!details.approvalToken) {
			output.write('The server delivers this approval to the approver another way.\n');
			return result;
		}
		let approved: boolean;
		if (options.approve) {
			if (autoApproved) return result;
			autoApproved = true;
			approved = true;
		} else if (options.prompt) {
			approved = await options.prompt(command, details);
		} else {
			output.write('Not approved: no terminal to ask on. Rerun with --approve to approve it.\n');
			return result;
		}
		if (!approved) return result;
		result = await execute(details.approvalToken);
	}
}
