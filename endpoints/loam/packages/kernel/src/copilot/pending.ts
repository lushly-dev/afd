/**
 * @fileoverview Copilot command constants, continuation copy, and confirmation-replacement tracking
 * (`commands.ts`), kept apart so `commands.ts` stays within the file-size gate. Imports types alone.
 */

import type { CopilotTurnV1 } from './types.js';

/**
 * The chrome's own commands, which move the person's palette or record their editor selection: never the copilot's
 * tools (4.5).
 */
export const CHROME_ONLY: readonly string[] = [
	'palette-open',
	'palette-close',
	'editor-selection-set',
];

export const SUGGESTIONS = {
	PROVIDER_MISSING:
		'Add a provider under [copilot] in loam.deployment.toml, then run deployment write',
	PROVIDER_UNKNOWN: 'Start a new session; the provider is not in this desktop’s configuration',
	SESSION_NOT_FOUND: 'List your sessions with copilot-session-list',
	TURN_RUNNING: 'Wait for the turn, or stop it with copilot-turn-stop',
	PORT_REFUSED: 'None: only the runtime uses the port',
} as const;

/**
 * Never asked or suggested (6.1), beside the human, owner and person-session commands: what moves the person's own view
 * and changes none of their records (a layout, a tab, a selection, an open document), like phase 2's person-session
 * commands; and the overlays and the inbox, the agent's channels to the person, which phase 4 governs per path (its 6.1
 * table, 10.2) with their own agent rates, and whose handlers refuse an agent what it may not do (a modal, an answer).
 * Asking whether an agent may tell the person something would put the question in place of the message.
 */
export const AGENT_CHANNELS: readonly string[] = [
	'view-state-set',
	'layout-set',
	'layout-reset',
	'app-selection-set',
	'status-item-set',
	'editor-activate',
	'editor-close',
	'editor-pin',
	'editor-move',
	'editor-dirty-set',
	'document-open',
	'toast-show',
	'popover-open',
	'dialog-open',
	'modal-open',
	'prompt-open',
	'overlay-dismiss',
	'notification-push',
];

/** The person's records an exempt command can still write: `view-state-set` of the appearance alias (3.6). */
export const writesRecords = (name: string, input: unknown): boolean =>
	name === 'view-state-set' && (input as { id?: unknown } | null)?.id === 'loam.appearance';

/**
 * The confirmations' own reads and withdrawal, which only reach the caller's own (phase 4's 7.2), and the autonomy reads
 * by which an agent learns its mode (phase 4's 4.5): a cap of `suggest` must not keep an agent from knowing it.
 */
export const CONFIRMATION_OWN: readonly string[] = [
	'confirmation-get',
	'confirmation-withdraw',
	'notification-list',
	'autonomy-get',
	'autonomy-list',
];

/** The words a continuation starts with (3.5): Loam's, naming each confirmation's end, never its result. */
export const continuation = (
	ended: ReadonlyArray<{ id: string; command: string; state: string }>
) =>
	[
		'[Loam] The person has answered every confirmation this turn raised.',
		...ended.map(({ id, command, state }) =>
			state === 'confirmed'
				? `- ${command} (${id}): confirmed, and the shell ran it once. Read its result with confirmation-get { "notification": "${id}" }.`
				: state === 'declined'
					? `- ${command} (${id}): declined. Do not call it again.`
					: state === 'withdrawn'
						? `- ${command} (${id}): withdrawn before the person answered.`
						: `- ${command} (${id}): expired; no one answered it within 10 minutes.`
		),
		'Tell the person what happened.',
	].join('\n');

export interface TrackedTurn {
	pending: Map<string, number>;
	turn: CopilotTurnV1;
}

/**
 * Tracks kernel-verified confirmations raised by each copilot session and in-place reshow replacements (#2307).
 * Bounded so long-lived sessions never leak memory; cleared on a change of person.
 */
export function createConfirmationTracker() {
	const replacements = new Map<string, { id: string; expiresAt: number }>();
	const raised = new Map<string, Set<string>>();

	/** Follow any reshow chain from `id` to its latest replacement id and expiry. */
	function latest(id: string, expiresAt = 0): { id: string; expiresAt: number } {
		let current = id;
		let expiry = expiresAt;
		for (let hops = 0; hops < 16; hops += 1) {
			const next = replacements.get(current);
			if (!next || next.id === current) break;
			current = next.id;
			expiry = next.expiresAt;
		}
		return { id: current, expiresAt: expiry };
	}

	function noteRaised(session: string, id: string): void {
		let ids = raised.get(session);
		if (!ids) {
			ids = new Set();
			raised.set(session, ids);
			if (raised.size > 64) raised.delete(raised.keys().next().value as string);
		}
		ids.add(id);
	}

	function hasRaised(session: string, id: string): boolean {
		return raised.get(session)?.has(id) === true;
	}

	/**
	 * Record a changed-preview replacement (`oldId -> next`) and swap any live running/waiting turn
	 * holding `oldId` before any await so a concurrent check never resumes on the withdrawn card.
	 */
	function replace(
		session: string,
		oldId: string,
		next: { id: string; expiresAt: number },
		targets: ReadonlyArray<TrackedTurn | undefined>
	): void {
		replacements.set(oldId, next);
		if (replacements.size > 256) replacements.delete(replacements.keys().next().value as string);
		noteRaised(session, next.id);
		for (const target of targets) {
			if (!target) continue;
			if (target.pending.delete(oldId)) {
				target.pending.set(next.id, next.expiresAt);
				for (const call of target.turn.calls)
					if (call.notification === oldId) call.notification = next.id;
			}
		}
	}

	function clear(): void {
		replacements.clear();
		raised.clear();
	}

	return { latest, noteRaised, hasRaised, replace, clear };
}
