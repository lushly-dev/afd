/** Host-verified confirmation carrier and shared error suggestions for Specimen AFD commands. */
import type { CommandContext } from '@lushly-dev/afd-core';

/**
 * Context key carrying a host-minted {@link SpecimenRelayConfirmation} after `HumanRelay.resume`
 * approves a host-verified call (`spec/command-metadata.md`). Plain JSON values under this key are
 * ignored because {@link readSpecimenRelayConfirmation} verifies membership in a private `WeakSet`.
 */
export const SPECIMEN_RELAY_CONTEXT_KEY = 'dev.afd.specimen/relayConfirmed' as const;

/**
 * Context key carrying a host-minted server-derived change author for `AUTHOR_CANNOT_DECIDE`.
 * Plain strings or JSON values under this key are ignored unless minted via {@link markSpecimenChangeAuthor}.
 */
export const SPECIMEN_CHANGE_AUTHOR_CONTEXT_KEY = 'dev.afd.specimen/changeAuthor' as const;

/** Host-verified confirmation proof minted exclusively by {@link markSpecimenRelayConfirmed}. */
export interface SpecimenRelayConfirmation {
	readonly decisionId?: string;
	readonly confirmedBy?: string;
	readonly channel?: 'review-page' | 'cli' | 'mcp-relay';
	readonly command?: string;
	readonly inputDigest?: string;
	readonly cardDigests?: Readonly<Record<string, string>>;
}

/** Server-derived change author proof minted exclusively by {@link markSpecimenChangeAuthor}. */
export interface SpecimenChangeAuthorProof {
	readonly author: string;
}

export const HUMAN_CONFIRMED = Symbol('specimen.humanConfirmed');
export const SERVER_CHANGE_AUTHOR = Symbol('specimen.serverChangeAuthor');

export interface SpecimenCommandContext extends CommandContext {
	[HUMAN_CONFIRMED]?: {
		confirmedBy?: string;
		channel?: 'review-page' | 'cli' | 'mcp-relay';
	};
	[SERVER_CHANGE_AUTHOR]?: string;
}

const MINTED_RELAY_CONFIRMATIONS = new WeakSet<object>();
const MINTED_CHANGE_AUTHORS = new WeakSet<object>();

export function normalizeOptionalId(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Mint an unforgeable host-verified confirmation token for `HumanRelay.approvedContext`.
 * Only tokens created by this function are recognized as person provenance in `decision-record`
 * and `design-release`.
 */
export function markSpecimenRelayConfirmed(
	confirmation: SpecimenRelayConfirmation
): SpecimenRelayConfirmation {
	const confirmedBy = normalizeOptionalId(confirmation.confirmedBy);
	const decisionId = normalizeOptionalId(confirmation.decisionId);
	const command = normalizeOptionalId(confirmation.command);
	const inputDigest = normalizeOptionalId(confirmation.inputDigest);
	const cardDigests = confirmation.cardDigests
		? Object.freeze({ ...confirmation.cardDigests })
		: undefined;
	const token: SpecimenRelayConfirmation = Object.freeze({
		...(decisionId ? { decisionId } : {}),
		...(confirmedBy ? { confirmedBy } : {}),
		...(confirmation.channel ? { channel: confirmation.channel } : {}),
		...(command ? { command } : {}),
		...(inputDigest ? { inputDigest } : {}),
		...(cardDigests ? { cardDigests } : {}),
	});
	MINTED_RELAY_CONFIRMATIONS.add(token);
	return token;
}

/** Mint an unforgeable server-derived change author proof for in-process Mode 3 settlements. */
export function markSpecimenChangeAuthor(author: string): SpecimenChangeAuthorProof {
	const normalized = normalizeOptionalId(author);
	if (!normalized) {
		throw new TypeError('markSpecimenChangeAuthor: author must be a non-empty string');
	}
	const proof: SpecimenChangeAuthorProof = Object.freeze({ author: normalized });
	MINTED_CHANGE_AUTHORS.add(proof);
	return proof;
}

/** Read a host-verified confirmation token from `context` (never trusting plain JSON objects). */
export function readSpecimenRelayConfirmation(
	context: CommandContext,
	expectedCommand?: string
): SpecimenRelayConfirmation | undefined {
	const viaRelay = context[SPECIMEN_RELAY_CONTEXT_KEY];
	if (
		viaRelay !== null &&
		typeof viaRelay === 'object' &&
		MINTED_RELAY_CONFIRMATIONS.has(viaRelay)
	) {
		const token = viaRelay as SpecimenRelayConfirmation;
		if (expectedCommand && token.command && token.command !== expectedCommand) {
			return undefined;
		}
		return token;
	}
	const viaSymbol = (context as SpecimenCommandContext)[HUMAN_CONFIRMED];
	if (viaSymbol) {
		return {
			...(viaSymbol.confirmedBy ? { confirmedBy: viaSymbol.confirmedBy } : {}),
			channel: viaSymbol.channel ?? 'mcp-relay',
		};
	}
	return undefined;
}

/** Read a host-minted server-derived change author from `context` (never trusting plain JSON). */
export function readSpecimenChangeAuthor(context: CommandContext): string | undefined {
	const viaContext = context[SPECIMEN_CHANGE_AUTHOR_CONTEXT_KEY];
	if (
		viaContext !== null &&
		typeof viaContext === 'object' &&
		MINTED_CHANGE_AUTHORS.has(viaContext)
	) {
		return (viaContext as SpecimenChangeAuthorProof).author;
	}
	return normalizeOptionalId((context as SpecimenCommandContext)[SERVER_CHANGE_AUTHOR]);
}

/** Per-error-code recovery suggestions (`docs/features/active/patterns/spec.md` §5.5 & AFD Phase C2). */
export const ERROR_SUGGESTIONS: Readonly<Record<string, string>> = {
	TARGET_NOT_FOUND:
		'Run specimen-list or name a { role, name } target (or Pointing point) that matches an accessible element in the rendered specimen.',
	TARGET_AMBIGUOUS:
		'Narrow the target with name, nameStartsWith, or nameContains (or pass a Pointing point) so it matches one element.',
	SPECIMEN_NOT_FOUND:
		'Use one of the nearest specimen ids listed in details, or run specimen-list.',
	ALREADY_EXISTS: 'Choose another copy name, or pass replace: true to overwrite the existing copy.',
	PATTERN_UNKNOWN:
		'Use one of the nearest local patterns in specimens/patterns/, or pass createPattern: true to start a new pattern.',
	COPY_NOT_FOUND:
		'Run specimen-pattern-save in capture mode (id + target/point) before re-verifying in place.',
	COPY_DOWNGRADE_REFUSED:
		'Fix the stripped items or remount errors so the copy stays complete, or pass allowDowngrade: true to demote it to draft.',
	COPY_REFRESH_UNSUPPORTED:
		'Update .html/.css on disk and run specimen-pattern-save with { pattern, name, replace: true } (copy was edited in place or lacks a durable origin.target).',
	PATTERN_SETUP_MISSING:
		'Add the missing setup case (run specimen-suggest with the reported pattern: obligation) or declare a contexts limit on the implementation.',
	POINT_STALE: 'Run specimen-point again to capture a fresh point id before saving.',
	MODALITY_FORBIDDEN:
		'Remove forbidden tools and run with only the tools permitted for the persona modality.',
	JOB_NOT_FOUND: "Pass a job id present in the product's scenarios/ directory.",
	PERSONA_NOT_FOUND: "Pass a persona id declared in the product's persona set.",
	WALK_NOT_FOUND: 'Run panel-walk first to produce a baseline walk id.',
	CARD_NOT_FOUND: 'List open decision cards with design-card-list to check the card id.',
	CARD_ALREADY_DECIDED:
		'Inspect design-card-list for active open, deferred, or changes-requested cards.',
	STALE_CARD:
		'Card content changed after confirmation began; review the updated card in design-card-list and confirm again.',
	PERSON_REQUIRED:
		'Ask a person to confirm this decision through the host relay; agents and scripts cannot approve design cards or releases.',
	REFUSAL_SCOPE_REQUIRED:
		'Pass refusalScope ("unsafe", "wrong-for-context", or "not-a-priority") when recording chosen: "reject" on a decision card.',
	REGRESSION_ACK_REQUIRED:
		'Approve regression cards individually with regressionAccepted: true and an explicit reason.',
	UPSTREAM_CHANGED:
		'Re-run specimen-pattern-compare and specimen-pattern-merge against the current upstream pattern before approving.',
	REFUSED_AS_UNSAFE:
		'Inspect the blocking safety refusal in decision-list and provide both supersedes and remediation once the safety issue is fixed.',
	AUTHOR_CANNOT_DECIDE:
		'Have an independent panel reviewer or a person record the decision rather than the author of the change.',
	UNAPPROVED_CARDS_OPEN:
		'Review and decide all open and changes-requested cards in design-card-list before releasing.',
	DECISION_NOT_APPROVED:
		'Pass only active, non-superseded, non-provisional person-approved decisions to design-release.',
};
