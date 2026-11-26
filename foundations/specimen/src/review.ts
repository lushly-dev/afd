import {
	compareCodeUnits,
	currentChoicesFromRecords,
	readAllDecisions,
	sha256,
	typedError,
} from './decisions-store.js';
import { canonicalJson, diffObservations } from './diff.js';
import type { SpecimenHostError } from './host.js';
import { parseReviewRequest } from './review-validate.js';
import {
	CAPTURE_SETS_DIR,
	readCaptureSetManifest,
	readSetCaptureFromManifest,
	SET_ID_PATTERN,
	SPECIMEN_DATA_DIR,
} from './sets.js';
import {
	type AnswerDecisionRecord,
	CAPTURE_VERSION,
	type CaptureSetEntry,
	type CaptureSetManifest,
	type ChoiceDecisionRecord,
	type DecisionActor,
	type DecisionAnswerCause,
	type DecisionAnswerEntry,
	type DecisionRecord,
	NORMALIZATION_VERSION,
	type Observation,
	type ResolvedReviewItem,
	type ReviewBlockingItem,
	type ReviewCaptureRef,
	type ReviewDecisionRef,
	type ReviewOpenItem,
	type ReviewPageAnswerSummary,
	type ReviewPageCapturePreview,
	type ReviewPageData,
	type ReviewRequest,
	type ReviewResult,
	type ReviewSetSummary,
	type SpecimenContext,
} from './types.js';

export const REVIEW_PAGE_FILE = 'review.html';

const REVIEW_PERSON_NOTE =
	'These are questions for the person; show them, and do not answer them yourself.';

const MAX_SUBSET_SEARCH_MEMBERS = 14;
const MAX_PAIR_SEARCH_MEMBERS = 64;

const CHANGED_ITEM_RE =
	/^changed:([0-9a-zA-Z_-]+):([0-9a-zA-Z_-]+):(set-[0-9a-f]{12})\.\.(set-[0-9a-f]{12})$/;
const CHECK_ITEM_RE = /^check:([^:]+):([^:]+):(set-[0-9a-f]{12})\.\.(set-[0-9a-f]{12})$/;
const INSUFFICIENT_ITEM_RE = /^insufficient:([^:]+):(set-[0-9a-f]{12})\.\.(set-[0-9a-f]{12})$/;

function baseSpecimenId(captureKey: string): string {
	const slash = captureKey.indexOf('/');
	return slash === -1 ? captureKey : captureKey.slice(0, slash);
}

/** Match exact specimen ids or `<id>/<step>` job prefixes against a review `ids` filter. */
export function matchesReviewIdFilter(captureKey: string, filterIds: readonly string[]): boolean {
	for (const id of filterIds) {
		if (captureKey === id || captureKey.startsWith(`${id}/`)) return true;
	}
	return false;
}

function specimenMatchesSubject(captureKey: string, subjectSpecimen: string): boolean {
	return captureKey === subjectSpecimen || captureKey.startsWith(`${subjectSpecimen}/`);
}

/** Deterministic 12-hex cause digest shared by `specimen-review` and `decision-record`. */
export function computeCauseHash(cause: DecisionAnswerCause): string {
	return sha256(canonicalJson(cause)).slice(0, 12);
}

/** Deterministic 12-hex member-scope digest over sorted capture keys. */
export function computeMembersHash(sortedKeys: readonly string[]): string {
	return sha256(canonicalJson(sortedKeys)).slice(0, 12);
}

/** Member-scoped self-describing id for a `changed` review item. */
export function computeChangedItemId(
	causeHash: string,
	sortedKeys: readonly string[],
	beforeSet: string,
	afterSet: string
): string {
	return `changed:${causeHash}:${computeMembersHash(sortedKeys)}:${beforeSet}..${afterSet}`;
}

/** Self-describing id for an `incomplete-check` review item. */
export function computeCheckItemId(
	specimenKey: string,
	checkId: string,
	beforeSet: string,
	afterSet: string
): string {
	return `check:${specimenKey}:${checkId}:${beforeSet}..${afterSet}`;
}

/** Self-describing id for an `insufficient-evidence` review item. */
export function computeInsufficientItemId(
	specimenKey: string,
	beforeSet: string,
	afterSet: string
): string {
	return `insufficient:${specimenKey}:${beforeSet}..${afterSet}`;
}

/** Content fingerprint for a `changed` review item (cause + exact members + before/after hashes). */
export function computeChangedFingerprint(
	cause: DecisionAnswerCause,
	sortedKeys: readonly string[],
	beforeManifest: CaptureSetManifest,
	afterManifest: CaptureSetManifest
): string {
	return sha256(
		canonicalJson({
			cause,
			ids: sortedKeys,
			before: sortedKeys.map((k) => beforeManifest.captures[k]?.hash ?? null),
			after: sortedKeys.map((k) => afterManifest.captures[k]?.hash ?? null),
		})
	).slice(0, 16);
}

function computeInsufficientFingerprint(
	beforeHash: string | null,
	afterHash: string | null,
	limitation: string
): string {
	return sha256(canonicalJson({ before: beforeHash, after: afterHash, limitation })).slice(0, 16);
}

function hasIncompleteRequiredChannel(observation: Observation): boolean {
	for (const channel of ['dom', 'a11y', 'layout', 'styles'] as const) {
		const completion = observation.completeness[channel];
		const ariaOnly =
			channel === 'a11y' &&
			completion.status === 'partial' &&
			completion.reasons.length > 0 &&
			completion.reasons.every((reason) => reason === 'AXE_NOT_RUN');
		if (completion.status !== 'complete' && !ariaOnly) return true;
	}
	return false;
}

function formatChangedQuestion(cause: DecisionAnswerCause, ids: readonly string[]): string {
	const detail = cause.property
		? `${cause.channel}.${cause.property}`
		: cause.target
			? `${cause.channel} (${cause.target})`
			: cause.channel;
	const valueChange =
		cause.left !== undefined || cause.right !== undefined
			? ` (${formatShortValue(cause.left)} -> ${formatShortValue(cause.right)})`
			: '';
	return `Accept or reject ${detail}${valueChange} change on ${ids.join(', ')}?`;
}

function formatShortValue(value: unknown): string {
	if (typeof value === 'string') {
		return value.length > 48 ? `${value.slice(0, 45)}...` : value;
	}
	try {
		const json = JSON.stringify(value);
		if (!json) return String(value);
		return json.length > 48 ? `${json.slice(0, 45)}...` : json;
	} catch {
		return String(value);
	}
}

function formatIncompleteCheckQuestion(
	specimenKey: string,
	checkId: string,
	targets: readonly string[],
	help: string
): string {
	const targetPart = targets.length > 0 ? ` (${targets.join(', ')})` : '';
	const helpPart = help.trim().length > 0 ? `: ${help.trim()}` : '';
	return `Accept or reject incomplete ${checkId} check on ${specimenKey}${targetPart}${helpPart}?`;
}

function formatInsufficientQuestion(
	specimenKey: string,
	beforeSet: string,
	afterSet: string,
	limitation: string
): string {
	const detail = limitation.trim().length > 0 ? ` (${limitation.trim()})` : '';
	return `Accept or reject insufficient evidence for ${specimenKey} between ${beforeSet} and ${afterSet}${detail}?`;
}

function incomparableReviewError(
	message: string,
	details: Record<string, unknown>
): SpecimenHostError {
	return typedError(
		'CAPTURES_INCOMPARABLE',
		message,
		'Capture both sets under the same conditions with specimen-capture before running specimen-review.',
		details
	);
}

function validateSetCompatibility(
	beforeManifest: CaptureSetManifest,
	afterManifest: CaptureSetManifest
): void {
	for (const manifest of [beforeManifest, afterManifest]) {
		if (manifest.captureVersion !== CAPTURE_VERSION) {
			throw incomparableReviewError(
				`Unsupported capture version ${manifest.captureVersion} in set ${manifest.set}; recapture with version ${CAPTURE_VERSION}.`,
				{
					field: 'captureVersion',
					expected: CAPTURE_VERSION,
					found: manifest.captureVersion,
					set: manifest.set,
				}
			);
		}
		if (manifest.normalizationVersion !== NORMALIZATION_VERSION) {
			throw incomparableReviewError(
				`Unsupported normalization version ${manifest.normalizationVersion} in set ${manifest.set}; recapture with version ${NORMALIZATION_VERSION}.`,
				{
					field: 'normalizationVersion',
					expected: NORMALIZATION_VERSION,
					found: manifest.normalizationVersion,
					set: manifest.set,
				}
			);
		}
	}
	if (canonicalJson(beforeManifest.browser) !== canonicalJson(afterManifest.browser)) {
		throw incomparableReviewError(
			`Incompatible capture sets ${beforeManifest.set} and ${afterManifest.set}: browser differs.`,
			{ field: 'browser', before: beforeManifest.browser, after: afterManifest.browser }
		);
	}
	const checkpointOf = (m: CaptureSetManifest) => ({
		name: m.checkpoint.name,
		actionMode: m.checkpoint.actionMode,
		baseline: m.checkpoint.baseline,
	});
	if (canonicalJson(checkpointOf(beforeManifest)) !== canonicalJson(checkpointOf(afterManifest))) {
		throw incomparableReviewError(
			`Incompatible capture sets ${beforeManifest.set} and ${afterManifest.set}: checkpoint differs.`,
			{
				field: 'checkpoint',
				before: checkpointOf(beforeManifest),
				after: checkpointOf(afterManifest),
			}
		);
	}
	if (beforeManifest.axe !== afterManifest.axe) {
		throw incomparableReviewError(
			`Incompatible capture sets ${beforeManifest.set} and ${afterManifest.set}: axe differs (${String(beforeManifest.axe)} vs ${String(afterManifest.axe)}).`,
			{ field: 'axe', before: beforeManifest.axe, after: afterManifest.axe }
		);
	}
	const contextKeys = [
		...new Set([
			...Object.keys(beforeManifest.context),
			...Object.keys(afterManifest.context),
		] as (keyof SpecimenContext)[]),
	].sort(compareCodeUnits);
	for (const key of contextKeys) {
		const leftValue = beforeManifest.context[key];
		const rightValue = afterManifest.context[key];
		if (canonicalJson(leftValue) !== canonicalJson(rightValue)) {
			throw incomparableReviewError(
				`Incompatible capture sets ${beforeManifest.set} and ${afterManifest.set}: context.${key} differs (${formatShortValue(leftValue)} vs ${formatShortValue(rightValue)}).`,
				{ field: `context.${key}`, before: leftValue, after: rightValue }
			);
		}
	}
}

function keptUnchosenSet(currentChoices: readonly ChoiceDecisionRecord[]): Set<string> {
	const kept = new Set<string>();
	for (const choice of currentChoices) {
		for (const variant of choice.kept) kept.add(variant);
	}
	return kept;
}

function isKeptUnchosen(captureKey: string, kept: ReadonlySet<string>): boolean {
	return kept.has(captureKey) || kept.has(baseSpecimenId(captureKey));
}

function captureArtifactPath(setId: string, entry: CaptureSetEntry): string {
	const rel = entry.screenshot ?? entry.observation ?? `captures/${entry.key}`;
	return `${SPECIMEN_DATA_DIR}/${CAPTURE_SETS_DIR}/${setId}/${rel}`;
}

function captureScreenshotUrlPath(
	setId: string,
	entry: CaptureSetEntry | undefined
): string | null {
	if (entry?.status !== 'captured' || !entry.screenshot) return null;
	return `sets/${setId}/${entry.screenshot}`;
}

function matchingChoicesForMembers(
	members: readonly string[],
	currentChoices: readonly ChoiceDecisionRecord[]
): ReviewDecisionRef[] {
	const matched: ReviewDecisionRef[] = [];
	for (const choice of currentChoices) {
		const specimens = choice.subjects.specimens ?? [];
		if (
			specimens.some((subject) => members.some((member) => specimenMatchesSubject(member, subject)))
		) {
			matched.push({ decision: choice.id, reason: choice.reason });
		}
	}
	matched.sort((a, b) => compareCodeUnits(a.decision, b.decision));
	return matched;
}

interface MatchedAnswerOutcome {
	decision: string;
	kind: 'choice' | 'answer';
	chosen: 'accept' | 'reject';
	reason: string;
	decidedAt: string;
	decidedBy: DecisionActor;
}

interface AnswerCandidate {
	record: ChoiceDecisionRecord | AnswerDecisionRecord;
	entry: DecisionAnswerEntry;
	effectiveOutcome: 'accept' | 'reject';
}

function collectAnswerCandidates(
	allDecisions: readonly DecisionRecord[],
	currentChoices: readonly ChoiceDecisionRecord[]
): AnswerCandidate[] {
	const currentChoiceIds = new Set(currentChoices.map((choice) => choice.id));
	const candidates: AnswerCandidate[] = [];
	for (const record of allDecisions) {
		if (record.kind === 'choice') {
			if (!currentChoiceIds.has(record.id) || !record.answers?.length) continue;
			for (const entry of record.answers) {
				candidates.push({ record, entry, effectiveOutcome: 'accept' });
			}
		} else if (record.kind === 'answer') {
			for (const entry of record.answers) {
				candidates.push({ record, entry, effectiveOutcome: record.chosen });
			}
		}
	}
	// Deterministic recency sort: newest decidedAt instant first, tie-broken by decision id descending.
	candidates.sort((a, b) => {
		const timeA = Date.parse(a.record.decidedAt);
		const timeB = Date.parse(b.record.decidedAt);
		if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
			return timeB - timeA;
		}
		const timeDiff = compareCodeUnits(b.record.decidedAt, a.record.decidedAt);
		if (timeDiff !== 0) return timeDiff;
		return compareCodeUnits(b.record.id, a.record.id);
	});
	return candidates;
}

function inferEntryKind(
	entry: DecisionAnswerEntry
): 'changed' | 'incomplete-check' | 'insufficient-evidence' | null {
	if (entry.kind) return entry.kind;
	if (entry.check !== undefined || entry.item.startsWith('check:')) return 'incomplete-check';
	if (entry.cause !== undefined || entry.item.startsWith('changed:')) return 'changed';
	if (entry.item.startsWith('insufficient:')) return 'insufficient-evidence';
	return null;
}

function findMatchingAnswer(
	candidates: readonly AnswerCandidate[],
	item: {
		kind: 'changed' | 'incomplete-check' | 'insufficient-evidence';
		ids: readonly string[];
		check?: string;
		fingerprint: string;
	}
): MatchedAnswerOutcome | null {
	for (const candidate of candidates) {
		const { record, entry, effectiveOutcome } = candidate;
		if (entry.fingerprint !== item.fingerprint) continue;
		const entryKind = inferEntryKind(entry);
		if (entryKind !== item.kind) continue;
		if (item.kind === 'changed') {
			if (entry.ids !== undefined) {
				if (entry.ids.length !== item.ids.length) continue;
				if (entry.ids.some((id, idx) => id !== item.ids[idx])) continue;
			}
		} else if (item.kind === 'incomplete-check') {
			const entryId = entry.id ?? entry.ids?.[0];
			if (entryId !== item.ids[0] || entry.check !== item.check) continue;
		} else {
			const entryId = entry.id ?? entry.ids?.[0];
			if (entryId !== item.ids[0]) continue;
		}
		return {
			decision: record.id,
			kind: record.kind,
			chosen: effectiveOutcome,
			reason: record.reason,
			decidedAt: record.decidedAt,
			decidedBy: record.decidedBy,
		};
	}
	return null;
}

interface CandidateOpenItem {
	open: ReviewOpenItem;
	fingerprint: string;
	previews: ReviewPageCapturePreview[];
}

async function computeReviewInternal(
	root: string,
	rawRequest: ReviewRequest
): Promise<ReviewPageData> {
	const request = parseReviewRequest(rawRequest);
	const beforeManifest = await readCaptureSetManifest(root, request.before);
	const afterManifest = await readCaptureSetManifest(root, request.after);
	validateSetCompatibility(beforeManifest, afterManifest);

	const allDecisions = await readAllDecisions(root);
	const currentChoices = currentChoicesFromRecords(allDecisions);
	const kept = keptUnchosenSet(currentChoices);
	const answerCandidates = collectAnswerCandidates(allDecisions, currentChoices);

	const afterKeys = Object.keys(afterManifest.captures)
		.filter((key) => !request.ids || matchesReviewIdFilter(key, request.ids))
		.sort(compareCodeUnits);

	let settledKept = 0;
	let settledUnchanged = 0;
	let settledAnswered = 0;

	const blocking: ReviewBlockingItem[] = [];
	const changedGroups = new Map<string, { cause: DecisionAnswerCause; keys: Set<string> }>();
	const insufficientItems: CandidateOpenItem[] = [];
	const incompleteCheckItems: CandidateOpenItem[] = [];

	for (const key of afterKeys) {
		// Precedence 1: kept unchosen variants are excluded first, even if they fail axe.
		if (isKeptUnchosen(key, kept)) {
			settledKept++;
			continue;
		}

		const afterEntry = afterManifest.captures[key] as CaptureSetEntry;
		const beforeEntry = Object.hasOwn(beforeManifest.captures, key)
			? beforeManifest.captures[key]
			: undefined;

		// Precedence 2: unavailable or axe-failed captures are blocking, never open or settled.
		if (afterEntry.status !== 'captured') {
			blocking.push({
				kind: 'unavailable',
				ids: [key],
				reason: afterEntry.reason ?? 'Capture unavailable.',
			});
			continue;
		}
		if (afterEntry.axe?.status === 'failed') {
			blocking.push({
				kind: 'axe-failed',
				ids: [key],
				violations: [...afterEntry.axe.violations],
			});
			continue;
		}

		let raisedItem = false;

		// Incomplete accessibility checks in the after set become open `incomplete-check` items.
		const rawIncomplete = afterEntry.axe?.incompleteChecks ?? [];
		if (rawIncomplete.length > 0) {
			const byCheck = new Map<string, { help: string; targets: Set<string> }>();
			for (const chk of rawIncomplete) {
				let bucket = byCheck.get(chk.id);
				if (!bucket) {
					bucket = { help: chk.help, targets: new Set() };
					byCheck.set(chk.id, bucket);
				} else if (!bucket.help && chk.help) {
					bucket.help = chk.help;
				}
				for (const target of chk.targets) bucket.targets.add(target);
			}
			for (const checkId of [...byCheck.keys()].sort(compareCodeUnits)) {
				raisedItem = true;
				const bucket = byCheck.get(checkId) as { help: string; targets: Set<string> };
				const targets = [...bucket.targets].sort(compareCodeUnits);
				const itemId = computeCheckItemId(key, checkId, beforeManifest.set, afterManifest.set);
				const captureRef: ReviewCaptureRef = {
					key,
					...(beforeEntry?.status === 'captured'
						? { before: captureArtifactPath(beforeManifest.set, beforeEntry) }
						: {}),
					after: captureArtifactPath(afterManifest.set, afterEntry),
				};
				incompleteCheckItems.push({
					open: {
						item: itemId,
						kind: 'incomplete-check',
						ids: [key],
						check: checkId,
						question: formatIncompleteCheckQuestion(key, checkId, targets, bucket.help),
						options: ['accept', 'reject'],
						captures: [captureRef],
						decisions: [],
						note: REVIEW_PERSON_NOTE,
					},
					fingerprint: afterEntry.hash ?? '',
					previews: [
						{
							key,
							beforeScreenshot: captureScreenshotUrlPath(beforeManifest.set, beforeEntry),
							afterScreenshot: captureScreenshotUrlPath(afterManifest.set, afterEntry),
						},
					],
				});
			}
		}

		// Diff against before capture when both sides were captured.
		// Even when content hashes match, missing structural evidence can never mean unchanged:
		// inspect observation completeness before treating matching hashes as no-change-observed.
		if (beforeEntry?.status === 'captured') {
			const identicalHash =
				beforeEntry.hash !== null &&
				afterEntry.hash !== null &&
				beforeEntry.hash === afterEntry.hash;
			let diff: ReturnType<typeof diffObservations> | null = null;
			if (identicalHash) {
				const afterObs = await readSetCaptureFromManifest(
					root,
					afterManifest.set,
					afterManifest,
					key
				);
				if (hasIncompleteRequiredChannel(afterObs)) {
					const beforeObs = await readSetCaptureFromManifest(
						root,
						beforeManifest.set,
						beforeManifest,
						key
					);
					diff = diffObservations(beforeObs, afterObs);
				}
			} else {
				const [beforeObs, afterObs] = await Promise.all([
					readSetCaptureFromManifest(root, beforeManifest.set, beforeManifest, key),
					readSetCaptureFromManifest(root, afterManifest.set, afterManifest, key),
				]);
				diff = diffObservations(beforeObs, afterObs);
			}
			if (diff?.status === 'insufficient-evidence') {
				raisedItem = true;
				const limitation = diff.limitations.join('; ');
				const itemId = computeInsufficientItemId(key, beforeManifest.set, afterManifest.set);
				insufficientItems.push({
					open: {
						item: itemId,
						kind: 'insufficient-evidence',
						ids: [key],
						limitation,
						question: formatInsufficientQuestion(
							key,
							beforeManifest.set,
							afterManifest.set,
							limitation
						),
						options: ['accept', 'reject'],
						captures: [
							{
								key,
								before: captureArtifactPath(beforeManifest.set, beforeEntry),
								after: captureArtifactPath(afterManifest.set, afterEntry),
							},
						],
						decisions: [],
						note: REVIEW_PERSON_NOTE,
					},
					fingerprint: computeInsufficientFingerprint(
						beforeEntry.hash,
						afterEntry.hash,
						limitation
					),
					previews: [
						{
							key,
							beforeScreenshot: captureScreenshotUrlPath(beforeManifest.set, beforeEntry),
							afterScreenshot: captureScreenshotUrlPath(afterManifest.set, afterEntry),
						},
					],
				});
			} else if (diff?.status === 'changed') {
				raisedItem = true;
				for (const difference of diff.differences) {
					const cause: DecisionAnswerCause = {
						channel: difference.channel,
						...(difference.target !== undefined ? { target: difference.target } : {}),
						...(difference.property !== undefined ? { property: difference.property } : {}),
						...(difference.left !== undefined ? { left: difference.left } : {}),
						...(difference.right !== undefined ? { right: difference.right } : {}),
					};
					const causeHash = computeCauseHash(cause);
					let group = changedGroups.get(causeHash);
					if (!group) {
						group = { cause, keys: new Set() };
						changedGroups.set(causeHash, group);
					}
					group.keys.add(key);
				}
			}
		}

		if (!raisedItem) {
			settledUnchanged++;
		}
	}

	// Build grouped `changed` candidate items, ordered largest group first then specimen id asc.
	const changedItems: CandidateOpenItem[] = [];
	for (const [causeHash, group] of changedGroups) {
		const sortedIds = [...group.keys].sort(compareCodeUnits);
		const itemId = computeChangedItemId(
			causeHash,
			sortedIds,
			beforeManifest.set,
			afterManifest.set
		);
		const fingerprint = computeChangedFingerprint(
			group.cause,
			sortedIds,
			beforeManifest,
			afterManifest
		);
		const captures: ReviewCaptureRef[] = sortedIds.map((key) => {
			const beforeEntry = beforeManifest.captures[key] as CaptureSetEntry;
			const afterEntry = afterManifest.captures[key] as CaptureSetEntry;
			return {
				key,
				before: captureArtifactPath(beforeManifest.set, beforeEntry),
				after: captureArtifactPath(afterManifest.set, afterEntry),
			};
		});
		const previews: ReviewPageCapturePreview[] = sortedIds.map((key) => ({
			key,
			beforeScreenshot: captureScreenshotUrlPath(beforeManifest.set, beforeManifest.captures[key]),
			afterScreenshot: captureScreenshotUrlPath(afterManifest.set, afterManifest.captures[key]),
		}));
		changedItems.push({
			open: {
				item: itemId,
				kind: 'changed',
				ids: sortedIds,
				cause: group.cause,
				question: formatChangedQuestion(group.cause, sortedIds),
				options: ['accept', 'reject'],
				captures,
				decisions: matchingChoicesForMembers(sortedIds, currentChoices),
				note: REVIEW_PERSON_NOTE,
			},
			fingerprint,
			previews,
		});
	}

	changedItems.sort((a, b) => {
		if (b.open.ids.length !== a.open.ids.length) return b.open.ids.length - a.open.ids.length;
		const firstDiff = compareCodeUnits(a.open.ids[0] ?? '', b.open.ids[0] ?? '');
		if (firstDiff !== 0) return firstDiff;
		return compareCodeUnits(a.open.item, b.open.item);
	});
	insufficientItems.sort((a, b) => compareCodeUnits(a.open.ids[0] ?? '', b.open.ids[0] ?? ''));
	incompleteCheckItems.sort((a, b) => {
		const idDiff = compareCodeUnits(a.open.ids[0] ?? '', b.open.ids[0] ?? '');
		if (idDiff !== 0) return idDiff;
		return compareCodeUnits(a.open.check ?? '', b.open.check ?? '');
	});

	const allCandidates: CandidateOpenItem[] = [
		...changedItems,
		...insufficientItems,
		...incompleteCheckItems,
	];

	const open: ReviewOpenItem[] = [];
	const previews: Record<string, ReviewPageCapturePreview[]> = {};
	const matchedAnswers: ReviewPageAnswerSummary[] = [];

	for (const candidate of allCandidates) {
		const match = findMatchingAnswer(answerCandidates, {
			kind: candidate.open.kind,
			ids: candidate.open.ids,
			...(candidate.open.check !== undefined ? { check: candidate.open.check } : {}),
			fingerprint: candidate.fingerprint,
		});
		if (!match) {
			open.push(candidate.open);
			previews[candidate.open.item] = candidate.previews;
			continue;
		}
		if (match.chosen === 'accept') {
			settledAnswered++;
			matchedAnswers.push({
				decision: match.decision,
				kind: match.kind,
				chosen: match.chosen,
				item: candidate.open.item,
				ids: candidate.open.ids,
				reason: match.reason,
				decidedAt: match.decidedAt,
				decidedBy: match.decidedBy,
				status: 'answered',
			});
		} else {
			blocking.push({
				kind: 'rejected',
				ids: candidate.open.ids,
				item: candidate.open.item,
				reason: match.reason,
			});
			matchedAnswers.push({
				decision: match.decision,
				kind: match.kind,
				chosen: match.chosen,
				item: candidate.open.item,
				ids: candidate.open.ids,
				reason: match.reason,
				decidedAt: match.decidedAt,
				decidedBy: match.decidedBy,
				status: 'rejected',
			});
		}
	}

	const blockingRank = (kind: ReviewBlockingItem['kind']): number =>
		kind === 'axe-failed' ? 0 : kind === 'unavailable' ? 1 : 2;
	blocking.sort((a, b) => {
		const rankDiff = blockingRank(a.kind) - blockingRank(b.kind);
		if (rankDiff !== 0) return rankDiff;
		const idDiff = compareCodeUnits(a.ids[0] ?? '', b.ids[0] ?? '');
		if (idDiff !== 0) return idDiff;
		return compareCodeUnits(a.item ?? '', b.item ?? '');
	});

	const beforeSummary: ReviewSetSummary = {
		set: beforeManifest.set,
		...(!SET_ID_PATTERN.test(request.before) ? { label: request.before } : {}),
		revision: beforeManifest.revision,
		dirty: beforeManifest.dirty,
	};
	const afterSummary: ReviewSetSummary = {
		set: afterManifest.set,
		...(!SET_ID_PATTERN.test(request.after) ? { label: request.after } : {}),
		revision: afterManifest.revision,
		dirty: afterManifest.dirty,
	};

	const query = new URLSearchParams({
		before: beforeManifest.set,
		after: afterManifest.set,
	});
	if (request.ids?.length) query.set('ids', request.ids.join(','));

	return {
		before: beforeSummary,
		after: afterSummary,
		open,
		blocking,
		settled: {
			unchanged: settledUnchanged,
			kept: settledKept,
			answered: settledAnswered,
		},
		page: `${REVIEW_PAGE_FILE}?${query.toString()}`,
		theme: afterManifest.context.theme,
		previews,
		matchedAnswers,
	};
}

/**
 * Run a read-only review over two capture sets (or local labels).
 * Never writes files to `.specimen/` or `specimens/`.
 */
export async function runReview(root: string, rawRequest: ReviewRequest): Promise<ReviewResult> {
	const data = await computeReviewInternal(root, rawRequest);
	return {
		before: data.before,
		after: data.after,
		open: data.open,
		blocking: data.blocking,
		settled: data.settled,
		page: data.page,
	};
}

/** Compute the enriched review payload served to `review.html?before=&after=`. */
export async function readReviewPageData(
	root: string,
	rawRequest: ReviewRequest
): Promise<ReviewPageData> {
	return computeReviewInternal(root, rawRequest);
}

function findMatchingSubsetByHash(
	sortedKeys: readonly string[],
	targetHash: string
): string[] | null {
	if (computeMembersHash(sortedKeys) === targetHash) {
		return [...sortedKeys];
	}
	for (const key of sortedKeys) {
		if (computeMembersHash([key]) === targetHash) return [key];
	}
	// Check job-prefix buckets (all steps belonging to one base specimen id) in O(n).
	const byBase = new Map<string, string[]>();
	for (const key of sortedKeys) {
		const base = baseSpecimenId(key);
		if (base === key) continue;
		const list = byBase.get(base);
		if (list) list.push(key);
		else byBase.set(base, [key]);
	}
	for (const bucket of byBase.values()) {
		if (bucket.length > 1 && computeMembersHash(bucket) === targetHash) return bucket;
	}
	if (sortedKeys.length <= MAX_PAIR_SEARCH_MEMBERS) {
		for (let i = 0; i < sortedKeys.length; i++) {
			for (let j = i + 1; j < sortedKeys.length; j++) {
				const pair = [sortedKeys[i] as string, sortedKeys[j] as string];
				if (computeMembersHash(pair) === targetHash) return pair;
			}
		}
	}
	if (sortedKeys.length > MAX_SUBSET_SEARCH_MEMBERS) return null;
	const total = 1 << sortedKeys.length;
	for (let mask = 1; mask < total - 1; mask++) {
		const subset: string[] = [];
		for (let bit = 0; bit < sortedKeys.length; bit++) {
			if ((mask & (1 << bit)) !== 0) subset.push(sortedKeys[bit] as string);
		}
		if (subset.length <= 2) continue;
		if (computeMembersHash(subset) === targetHash) return subset;
	}
	return null;
}

/**
 * Recompute and resolve one self-describing review item id from its two capture sets.
 * Used by `decision-record` so filtered reviews can never authorize unseen specimens and
 * fabricated or blocking items are refused with `REVIEW_ITEM_NOT_FOUND`.
 */
export async function resolveReviewItemFromSets(
	root: string,
	item: string,
	currentChoices: readonly ChoiceDecisionRecord[]
): Promise<ResolvedReviewItem> {
	const kept = keptUnchosenSet(currentChoices);

	const changedMatch = CHANGED_ITEM_RE.exec(item);
	if (changedMatch) {
		const [, causeHash, membersHash, beforeSet, afterSet] = changedMatch as unknown as [
			string,
			string,
			string,
			string,
			string,
		];
		const beforeManifest = await readCaptureSetManifest(root, beforeSet);
		const afterManifest = await readCaptureSetManifest(root, afterSet);
		validateSetCompatibility(beforeManifest, afterManifest);

		const groups = new Map<string, { cause: DecisionAnswerCause; keys: Set<string> }>();
		const commonKeys = Object.keys(afterManifest.captures)
			.filter((key) => Object.hasOwn(beforeManifest.captures, key) && !isKeptUnchosen(key, kept))
			.sort(compareCodeUnits);

		for (const key of commonKeys) {
			const beforeEntry = beforeManifest.captures[key];
			const afterEntry = afterManifest.captures[key];
			if (beforeEntry?.status !== 'captured' || afterEntry?.status !== 'captured') continue;
			if (afterEntry.axe?.status === 'failed') continue;
			if (
				beforeEntry.hash !== null &&
				afterEntry.hash !== null &&
				beforeEntry.hash === afterEntry.hash
			)
				continue;
			const [beforeObs, afterObs] = await Promise.all([
				readSetCaptureFromManifest(root, beforeSet, beforeManifest, key),
				readSetCaptureFromManifest(root, afterSet, afterManifest, key),
			]);
			const diff = diffObservations(beforeObs, afterObs);
			if (diff.status !== 'changed') continue;
			for (const difference of diff.differences) {
				const cause: DecisionAnswerCause = {
					channel: difference.channel,
					...(difference.target !== undefined ? { target: difference.target } : {}),
					...(difference.property !== undefined ? { property: difference.property } : {}),
					...(difference.left !== undefined ? { left: difference.left } : {}),
					...(difference.right !== undefined ? { right: difference.right } : {}),
				};
				const hash = computeCauseHash(cause);
				let bucket = groups.get(hash);
				if (!bucket) {
					bucket = { cause, keys: new Set() };
					groups.set(hash, bucket);
				}
				bucket.keys.add(key);
			}
		}

		const group = groups.get(causeHash);
		if (!group) {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Review item not raised by sets ${beforeSet}..${afterSet}: ${item}`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, beforeSet, afterSet }
			);
		}
		const sortedGroupKeys = [...group.keys].sort(compareCodeUnits);
		const matchedKeys = findMatchingSubsetByHash(sortedGroupKeys, membersHash);
		if (!matchedKeys) {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Review item member scope not raised by sets ${beforeSet}..${afterSet}: ${item}`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, beforeSet, afterSet }
			);
		}

		const touchedChoices = matchingChoicesForMembers(matchedKeys, currentChoices).map(
			(choice) => choice.decision
		);
		const fingerprint = computeChangedFingerprint(
			group.cause,
			matchedKeys,
			beforeManifest,
			afterManifest
		);

		return {
			entry: {
				item,
				kind: 'changed',
				ids: matchedKeys,
				cause: group.cause,
				fingerprint,
			},
			afterSet,
			touchedChoices,
			question: formatChangedQuestion(group.cause, matchedKeys),
		};
	}

	const checkMatch = CHECK_ITEM_RE.exec(item);
	if (checkMatch) {
		const [, specimenKey, checkId, beforeSet, afterSet] = checkMatch as unknown as [
			string,
			string,
			string,
			string,
			string,
		];
		const beforeManifest = await readCaptureSetManifest(root, beforeSet);
		const afterManifest = await readCaptureSetManifest(root, afterSet);
		validateSetCompatibility(beforeManifest, afterManifest);
		if (isKeptUnchosen(specimenKey, kept)) {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Specimen "${specimenKey}" is a kept unchosen variant and is excluded from review.`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, specimenKey, beforeSet, afterSet }
			);
		}
		const capture = Object.hasOwn(afterManifest.captures, specimenKey)
			? afterManifest.captures[specimenKey]
			: undefined;
		if (capture?.status !== 'captured' || capture.axe?.status === 'failed') {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Review item not raised by sets ${beforeSet}..${afterSet}: ${item}`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, beforeSet, afterSet }
			);
		}
		const matchingChecks = (capture.axe?.incompleteChecks ?? []).filter(
			(check) => check.id === checkId
		);
		if (matchingChecks.length === 0) {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Incomplete check "${checkId}" on "${specimenKey}" was not raised in ${afterSet}.`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, specimenKey, checkId, afterSet }
			);
		}
		const targets = [...new Set(matchingChecks.flatMap((check) => check.targets))].sort(
			compareCodeUnits
		);
		const help = matchingChecks.find((check) => check.help.trim().length > 0)?.help ?? '';
		return {
			entry: {
				item,
				kind: 'incomplete-check',
				id: specimenKey,
				check: checkId,
				fingerprint: capture.hash ?? '',
			},
			afterSet,
			touchedChoices: [],
			question: formatIncompleteCheckQuestion(specimenKey, checkId, targets, help),
		};
	}

	const insufficientMatch = INSUFFICIENT_ITEM_RE.exec(item);
	if (insufficientMatch) {
		const [, specimenKey, beforeSet, afterSet] = insufficientMatch as unknown as [
			string,
			string,
			string,
			string,
		];
		const beforeManifest = await readCaptureSetManifest(root, beforeSet);
		const afterManifest = await readCaptureSetManifest(root, afterSet);
		validateSetCompatibility(beforeManifest, afterManifest);
		if (isKeptUnchosen(specimenKey, kept)) {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Specimen "${specimenKey}" is a kept unchosen variant and is excluded from review.`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, specimenKey, beforeSet, afterSet }
			);
		}
		const beforeEntry = Object.hasOwn(beforeManifest.captures, specimenKey)
			? beforeManifest.captures[specimenKey]
			: undefined;
		const afterEntry = Object.hasOwn(afterManifest.captures, specimenKey)
			? afterManifest.captures[specimenKey]
			: undefined;
		if (
			beforeEntry?.status !== 'captured' ||
			afterEntry?.status !== 'captured' ||
			afterEntry.axe?.status === 'failed'
		) {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Review item not raised by sets ${beforeSet}..${afterSet}: ${item}`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, beforeSet, afterSet }
			);
		}
		const [beforeObs, afterObs] = await Promise.all([
			readSetCaptureFromManifest(root, beforeSet, beforeManifest, specimenKey),
			readSetCaptureFromManifest(root, afterSet, afterManifest, specimenKey),
		]);
		const diff = diffObservations(beforeObs, afterObs);
		if (diff.status !== 'insufficient-evidence') {
			throw typedError(
				'REVIEW_ITEM_NOT_FOUND',
				`Specimen "${specimenKey}" did not produce insufficient-evidence between ${beforeSet} and ${afterSet}.`,
				'Run specimen-review to list the items raised by the two capture sets.',
				{ item, specimenKey, beforeSet, afterSet }
			);
		}
		const limitation = diff.limitations.join('; ');
		return {
			entry: {
				item,
				kind: 'insufficient-evidence',
				id: specimenKey,
				fingerprint: computeInsufficientFingerprint(beforeEntry.hash, afterEntry.hash, limitation),
			},
			afterSet,
			touchedChoices: [],
			question: formatInsufficientQuestion(specimenKey, beforeSet, afterSet, limitation),
		};
	}

	throw typedError(
		'REVIEW_ITEM_NOT_FOUND',
		`Invalid or unknown review item: ${item}`,
		'Run specimen-review to list the items raised by the two capture sets.',
		{ item }
	);
}
