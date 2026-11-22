/**
 * @fileoverview A mounted command only a person may run (phase 5 specification, 7.2; D146), the shell's part, in `late`
 * beside phase 4's confirmations, which it extends through their deps and gate:
 *
 * - **Asked of every caller.** A command the entry releases (`approvals = "shell"` and a preview) and its server holds
 *   is asked for whoever calls it, an agent, an app's `calls` grant or the person's own palette, in the shell's words.
 *   One the shell cannot release is refused before anything is asked, `MOUNT_APPROVAL_UNAVAILABLE`.
 * - **The preview.** Read as the person before the confirmation is raised, with its canonical digest (SHA-256 of its
 *   data's canonical JSON, base64url), and its data for the person alone.
 * - **The release.** On the person's confirm: the instance is held, the preview read again, and the call sent only when
 *   its digest matches what the person saw; otherwise `{ changed }`, and the confirmation is shown again. The send's
 *   one retry with the server's token is the mounted chunk's (`apps/mounted-release.ts`). The hold ends with the outcome,
 *   or after 60 s with `MOUNT_UNREACHABLE`.
 * - **Never sent unasked.** Every command with a preview is asked before it is sent, whatever its server reported, so
 *   a released command never reaches its server without a person's confirm, and 7.2's held call no person confirmed
 *   cannot arise; a held answer outside a confirmed run is `MOUNT_APPROVAL_UNAVAILABLE`, its token dropped.
 *
 * A replay asks nothing of a server: it reads no preview and holds nothing, since its mounted calls answer from their
 * records.
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { MountReleaseV1 } from '../apps/mounted-release.js';
import type { AppsRuntime } from '../apps-runtime.js';
import { kernelFailure } from '../errors.js';
import { canonicalJson } from '../trust-records.js';
import type { AskedFor, AskedPreviewV1 } from './confirmation-parts.js';
import type { Confirmations } from './confirmations.js';
import { RESHOW, type ReshowV1 } from './reshow.js';

/** The mounted chunk's `RELEASING`, by `Symbol.for`, so `late` imports nothing of that chunk. */
const RELEASING = Symbol.for('dev.loam/releasing');

/** The largest preview the shell shows whole, as JSON, and its most values: past either, nothing is asked. */
export const PREVIEW_MAX_BYTES = 64 * 1024;
export const PREVIEW_VALUES_MAX = 200;

/** How many values a preview's data holds, containers counted too, by a walk with no recursion, stopping past `limit`. */
function valuesIn(value: unknown, limit: number): number {
	let count = 0;
	const stack: unknown[] = [value];
	while (stack.length > 0 && count <= limit) {
		const item = stack.pop();
		count += 1;
		if (typeof item === 'object' && item !== null) stack.push(...Object.values(item));
	}
	return count;
}

export interface MountedApprovalsDeps {
	apps(): AppsRuntime;
	replaying(): boolean;
}

/** The base64url SHA-256 of a value's canonical JSON: 43 characters. */
export async function previewDigest(value: unknown): Promise<string> {
	const bytes = new Uint8Array(
		await globalThis.crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(canonicalJson(value ?? null))
		)
	);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

const unavailable = (message: string, suggestion: string): CommandResult<never> =>
	kernelFailure('MOUNT_APPROVAL_UNAVAILABLE', message, suggestion, { retryable: false });

/** Why the shell cannot release a held command, in the kernel's words, or undefined when it can (7.2). */
function unreleasable(release: MountReleaseV1 | undefined): CommandResult<never> | undefined {
	const blocked = release ? release.blocked() : 'entry';
	if (!blocked) return undefined;
	return unavailable(
		blocked === 'era'
			? "This command needs a person's approval at its server, and this instance's lane carries none: only the desktop's `stdio` lane on MCP 2026-07-28 does"
			: blocked === 'preview'
				? "This command needs a person's approval at its server, and its entry's preview names no read of this instance callable on its own, or reads by a key the command's input does not name"
				: 'This command needs a person\'s approval at its server, and its entry does not say `approvals = "shell"` and give it a preview, so Loam does not present one',
		blocked === 'era'
			? 'Run the command at the server\'s own terminal, or mount it on the desktop over `stdio`, which speaks MCP 2026-07-28 for an `approvals = "shell"` instance.'
			: blocked === 'preview'
				? "Name a read of the same instance, not itself held, as the command's `preview.command`, and list under `preview.input` only keys of the command's own input."
				: 'Run the command at the server\'s own terminal, or give its instance entry `approvals = "shell"` and the command a `preview` naming a read of the same instance, for a server that accepts Loam as an approver.'
	);
}

export function createMountedApprovals(deps: MountedApprovalsDeps) {
	const ownerOf = (name: string) => deps.apps().owners.get(name);

	/** The shell's words for a released command (7.2): its name, never its server's title or text. */
	function askedFor(name: string): Omit<AskedFor, 'enforced'> | undefined {
		const owner = ownerOf(name);
		if (!owner?.release || owner.release.blocked()) return undefined;
		const definition = deps.apps().commands.find((each) => each.name === name);
		return {
			instance: owner.instance,
			title: name,
			prompt:
				'Its server holds it for your approval. Below is what its server says it will do; Loam presents your approval only if that is still so when you confirm.',
			danger: definition?.destructive === true,
		};
	}

	async function previewOf(
		release: MountReleaseV1,
		input: unknown,
		context: CommandContext,
		holder?: string,
		signal?: AbortSignal
	): Promise<AskedPreviewV1 | CommandResult<never>> {
		const read = await release.read(input, context, holder, signal);
		if (!read.ok) {
			return unavailable(
				read.code === 'preview-input'
					? `The call does not name every key the preview \`${release.preview.command}\` reads by, so the person could see another target; nothing was asked`
					: `The preview \`${release.preview.command}\` could not be read (${read.code}), so nothing was asked`,
				read.code === 'preview-input'
					? "Give the call every key its entry's `preview.input` lists, or correct that list in the deployment."
					: 'Check that the instance is running and the preview names a read of it, then call again.'
			);
		}
		const { data, labels, command } = read.read;
		// Shown whole, or not asked at all (the trust review's B6): no value of it is ever cut from the person's view.
		if (
			new TextEncoder().encode(canonicalJson(data ?? null)).length > PREVIEW_MAX_BYTES ||
			valuesIn(data, PREVIEW_VALUES_MAX) > PREVIEW_VALUES_MAX
		) {
			return unavailable(
				`The preview \`${command}\` is more than the shell shows whole (64 KiB, ${PREVIEW_VALUES_MAX} values), so nothing was asked`,
				"Name a preview that shows what the command will do in less, or run it at the server's own terminal."
			);
		}
		return { command, digest: await previewDigest(data), data, labels };
	}

	/** 7.2's preview, read as the person before a released command is asked. */
	async function previewFor(
		name: string,
		input: unknown,
		context: CommandContext
	): Promise<AskedPreviewV1 | CommandResult<never> | undefined> {
		const release = ownerOf(name)?.release;
		if (!release || deps.replaying()) return undefined;
		return unreleasable(release) ?? previewOf(release, input, context);
	}

	/**
	 * 7.2's steps 2 to 6 around a confirmed run: hold, preview again, send, store the outcome (`after`), release. A preview
	 * that changed is the kernel's own `RESHOW` mark, which no result can carry; nothing ran.
	 */
	async function release(
		name: string,
		input: unknown,
		context: CommandContext,
		shown: AskedPreviewV1 | undefined,
		run: () => Promise<CommandResult>,
		after: (result: CommandResult) => Promise<void>
	): Promise<CommandResult | ReshowV1> {
		const owned = ownerOf(name)?.release;
		const confirmation = (context as { confirmation?: unknown }).confirmation;
		if (!owned || deps.replaying() || typeof confirmation !== 'string') {
			const result = await run();
			await after(result);
			return result;
		}
		const refused = unreleasable(owned);
		if (refused) {
			await after(refused);
			return refused;
		}
		let hold: { release(): void; signal: AbortSignal };
		try {
			hold = await owned.hold(confirmation);
		} catch {
			const ended = held(false);
			await after(ended);
			return ended;
		}
		const call = context as unknown as Record<symbol, unknown>;
		try {
			// Step 3: the preview again, by this confirmation, which its own hold lets through, within the hold's deadline.
			const again = await previewOf(owned, input, context, confirmation, hold.signal);
			if (hold.signal.aborted) {
				const ended = held(false);
				await after(ended);
				return ended;
			}
			if ('success' in again) {
				await after(again);
				return again;
			}
			if (shown === undefined || again.digest !== shown.digest)
				return { [RESHOW]: { ...again, changed: true } };
			// Steps 4 and 5: the input confirmed, with the one retry its token allows, before the hold's deadline.
			call[RELEASING] = { confirmation, signal: hold.signal };
			const ended = new Promise<CommandResult>((resolve) => {
				hold.signal.addEventListener('abort', () => resolve(held(true)), { once: true });
			});
			const result = await Promise.race([run(), ended]);
			// Step 6: the outcome stored on the confirmation, then the hold released.
			await after(result);
			return result;
		} finally {
			delete call[RELEASING];
			hold.release();
		}
	}

	/**
	 * The confirmations' gate with 7.2 before it: a held command the shell cannot release is refused before anything is
	 * asked. A released one is asked of every caller by `askedFor`, so the kernel never sends it without a person's
	 * confirm, and 7.2's "held call no person confirmed" cannot arise for it.
	 */
	function wrap(confirmations: Confirmations): Confirmations {
		const gate: CommandMiddleware = async (name, input, context, next) => {
			const owner = ownerOf(name);
			// Whatever its server reported: a command with a preview is asked of every caller, or refused (B5).
			if ((owner?.approval === 'required' || owner?.release) && !deps.replaying()) {
				const refused = unreleasable(owner.release);
				if (refused) return refused;
			}
			return confirmations.gate(name, input, context, next);
		};
		return { ...confirmations, gate };
	}

	return { askedFor, previewFor, release, wrap };
}

/**
 * A hold that ended before the outcome (7.2's 60 s). Once the call was sent (`sent`), it may have run at the server, so
 * the person is told to look before asking again, and nothing retries it (the trust review's B8, I5).
 */
function held(sent: boolean): CommandResult<never> {
	return sent
		? kernelFailure(
				'MOUNT_UNREACHABLE',
				'The instance did not answer within the 60 seconds a held call may take: it may or may not have run at the server',
				'Check at the server what happened (for mail, its sent list) before you ask for it again; Loam does not retry it.',
				{ retryable: false }
			)
		: kernelFailure(
				'MOUNT_UNREACHABLE',
				'The instance stayed held by another approval, or did not answer, within 60 seconds, so nothing was sent',
				'Check that the instance is running, then ask for it again.',
				{ retryable: true }
			);
}
