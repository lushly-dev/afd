import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { recordCardDecision } from './card-decisions.js';
import {
	allocateDecisionId,
	cleanSubjects,
	compareCodeUnits,
	currentChoicesFromRecords,
	DECISION_ID_LENGTH,
	DECISION_ID_PATTERN,
	DECISIONS_DIR,
	decisionFilePath,
	decisionRelativePath,
	decisionsDir,
	dedupeStrings,
	EVIDENCE_DIR,
	evidenceRelativeDir,
	evidenceRootDir,
	evidenceSetDir,
	formatSingleAnswerResult,
	formatSingleChoiceResult,
	generateDecisionId,
	globMatchesAnyFile,
	matchesSubjectGlob,
	normalizeFileForMatching,
	publishSupersession,
	readAllDecisions,
	readCompareVariantOrder,
	readDecisionEvidenceManifest,
	readDecisionRecord,
	resolveEvidenceCapturesForGet,
	SPECIMENS_DIR,
	supersededIdsFromRecords,
	swapChosenSubject,
	typedError,
	writeDecisionEvidence,
	writeDecisionFile,
} from './decisions-store.js';
import type { SpecimenHostError } from './host.js';
import { readAllReleases } from './releases.js';
import { resolveReviewItemFromSets } from './review.js';
import {
	assertRealContained,
	captureSetsDir,
	readCaptureSetManifest,
	SET_ID_PATTERN,
	specimenDataDir,
	withFileLock,
} from './sets.js';
import type {
	AnswerDecisionRecord,
	CaptureSetManifest,
	CardDecisionRecord,
	ChoiceDecisionRecord,
	DecisionActor,
	DecisionCheckEntry,
	DecisionCheckRequest,
	DecisionCheckResult,
	DecisionGetRequest,
	DecisionGetResult,
	DecisionListEntry,
	DecisionListRequest,
	DecisionListResult,
	DecisionRecordRequest,
	DecisionRecordResult,
	DecisionRecordSingleResult,
	DecisionSubjects,
	RecordDecisionOptions,
	ResolvedReviewItem,
	UndecidedComparison,
} from './types.js';
import {
	parseDecisionCheckRequest,
	parseDecisionGetRequest,
	parseDecisionListRequest,
	parseDecisionRecordRequest,
} from './validate.js';

export {
	DECISION_ID_LENGTH,
	DECISION_ID_PATTERN,
	DECISIONS_DIR,
	decisionFilePath,
	decisionRelativePath,
	decisionsDir,
	EVIDENCE_DIR,
	evidenceRelativeDir,
	evidenceRootDir,
	evidenceSetDir,
	generateDecisionId,
	matchesSubjectGlob,
	readAllDecisions,
	readDecisionEvidenceManifest,
	readDecisionRecord,
	SPECIMENS_DIR,
	writeDecisionEvidence,
};

function checkChosenPassesGate(
	manifest: CaptureSetManifest,
	chosen: string,
	variants: readonly string[]
): void {
	const entry = Object.hasOwn(manifest.captures, chosen) ? manifest.captures[chosen] : undefined;
	if (!entry) {
		throw typedError(
			'VARIANT_NOT_FOUND',
			`Variant not found in capture set ${manifest.set}: ${chosen}`,
			`Choose one of the variants in the set: ${variants.join(', ')}.`,
			{ chosen, variants: [...variants], set: manifest.set }
		);
	}
	if (entry.status !== 'captured') {
		throw typedError(
			'CHOSEN_FAILS_GATE',
			`Variant ${chosen} is unavailable in set ${manifest.set}: ${entry.reason ?? 'capture failed'}.`,
			`Fix ${chosen} and compare again with specimen-compare.`,
			{ chosen, set: manifest.set, reason: entry.reason ?? null }
		);
	}
	if (entry.axe?.status === 'failed') {
		const violations = entry.axe.violations;
		const violationList = violations.length > 0 ? violations.join(', ') : 'accessibility failure';
		throw typedError(
			'CHOSEN_FAILS_GATE',
			`Variant ${chosen} failed accessibility gate (${violationList}) in set ${manifest.set}.`,
			`Fix the failing check(s) on ${chosen} and compare again with specimen-compare.`,
			{ chosen, set: manifest.set, violations }
		);
	}
}

async function checkChosenPassesCommittedEvidence(
	root: string,
	oldChoice: ChoiceDecisionRecord,
	chosen: string
): Promise<void> {
	const evidenceManifest = await readDecisionEvidenceManifest(root, oldChoice.evidence.set);
	if (evidenceManifest) {
		const capture = evidenceManifest.captures.find((c) => c.id === chosen || c.key === chosen);
		if (capture) {
			if (capture.status !== 'captured') {
				throw typedError(
					'CHOSEN_FAILS_GATE',
					`Variant ${chosen} is unavailable in evidence set ${oldChoice.evidence.set}: ${capture.reason ?? 'capture failed'}.`,
					`Fix ${chosen} and compare again with specimen-compare.`,
					{ chosen, set: oldChoice.evidence.set, reason: capture.reason ?? null }
				);
			}
			if (capture.axe === 'failed') {
				const violations = capture.violations ?? [];
				const violationList =
					violations.length > 0 ? violations.join(', ') : 'accessibility failure';
				throw typedError(
					'CHOSEN_FAILS_GATE',
					`Variant ${chosen} failed accessibility gate (${violationList}) in evidence set ${oldChoice.evidence.set}.`,
					`Fix the failing check(s) on ${chosen} and compare again with specimen-compare.`,
					{ chosen, set: oldChoice.evidence.set, violations }
				);
			}
		}
		return;
	}
	try {
		const localManifest = await readCaptureSetManifest(root, oldChoice.evidence.set);
		if (Object.hasOwn(localManifest.captures, chosen)) {
			checkChosenPassesGate(localManifest, chosen, oldChoice.variants);
		}
	} catch (error) {
		if ((error as SpecimenHostError).code === 'CAPTURE_SET_NOT_FOUND') return;
		throw error;
	}
}

/**
 * Record a choice decision, supersede one or more existing choices, or record a review answer.
 * Writes files under `specimens/decisions/` and `specimens/evidence/` without running `git commit`.
 */
export async function recordDecision(
	root: string,
	rawRequest: DecisionRecordRequest,
	options: RecordDecisionOptions = {}
): Promise<DecisionRecordResult> {
	const request = parseDecisionRecordRequest(rawRequest);
	const trimmedReason = typeof request.reason === 'string' ? request.reason.trim() : '';
	if (!trimmedReason) {
		throw typedError(
			'REASON_REQUIRED',
			'A decision requires a non-empty reason.',
			'Give the reason the choice rests on in the reason field.'
		);
	}
	const decidedBy: DecisionActor = options.decidedBy ?? { kind: 'script' };
	const decidedAt = (options.now ? options.now() : new Date()).toISOString();

	const lockPath = join(specimenDataDir(root), '.decisions.lock');
	await assertRealContained(root, lockPath, `Decision lock escapes root: ${lockPath}`);

	return withFileLock(lockPath, async () => {
		// Card mode (Phase C2): single `card` or non-regression batch `cards`.
		if (request.card !== undefined || request.cards !== undefined) {
			return recordCardDecision(root, request, trimmedReason, decidedAt, options);
		}

		const allExisting = await readAllDecisions(root);
		const supersededIds = supersededIdsFromRecords(allExisting);
		const currentChoices = currentChoicesFromRecords(allExisting);
		const resolveItem =
			options.resolveReviewItem ??
			((item: string) => resolveReviewItemFromSets(root, item, currentChoices));

		// Mode 1: New choice from a capture/compare set.
		if (
			request.set !== undefined &&
			request.supersedes === undefined &&
			request.items === undefined
		) {
			if (request.provisional === true) {
				throw typedError(
					'PERSON_REQUIRED',
					'Provisional panel decisions are only allowed for review answers, not choice decisions.',
					'Ask a person to record this choice decision through the host relay.'
				);
			}
			const manifest = await readCaptureSetManifest(root, request.set);
			const compareOrder = await readCompareVariantOrder(root, manifest.set);
			const manifestKeys = Object.keys(manifest.captures);
			const variants = compareOrder
				? [
						...compareOrder.filter((id) => Object.hasOwn(manifest.captures, id)),
						...manifestKeys.filter((id) => !compareOrder.includes(id)),
					]
				: manifestKeys;
			checkChosenPassesGate(manifest, request.chosen, variants);
			const kept = variants.filter((id) => id !== request.chosen);
			const { ref: evidence } = await writeDecisionEvidence(root, manifest, variants);
			const subjects: DecisionSubjects = {
				...cleanSubjects(request.subjects),
				specimens:
					request.subjects?.specimens !== undefined
						? dedupeStrings(request.subjects.specimens)
						: [request.chosen],
			};
			const id = await allocateDecisionId(root, new Set());
			const record: ChoiceDecisionRecord = {
				id,
				kind: 'choice',
				slug: request.slug as string,
				status: 'current',
				question: request.question as string,
				variants,
				chosen: request.chosen,
				kept,
				discarded: [],
				reason: trimmedReason,
				evidence,
				subjects,
				decidedAt,
				decidedBy,
			};
			const path = await writeDecisionFile(root, record);
			return formatSingleChoiceResult(record, path);
		}

		// Mode 2: Supersede one or more existing choice decisions.
		if (request.supersedes !== undefined) {
			if (request.provisional === true) {
				throw typedError(
					'PERSON_REQUIRED',
					'Provisional panel decisions cannot supersede existing choice decisions.',
					'Ask a person to supersede this choice decision through the host relay.'
				);
			}
			const supersedeIds = Array.isArray(request.supersedes)
				? request.supersedes
				: [request.supersedes];

			const priorChoices: ChoiceDecisionRecord[] = [];
			for (const oldId of supersedeIds) {
				const prior = await readDecisionRecord(root, oldId);
				if (prior.kind !== 'choice') {
					throw typedError(
						'DECISION_NOT_FOUND',
						`Decision ${oldId} is an answer, not a choice, and cannot be superseded.`,
						'Use decision-list to see current choice decision ids.',
						{ decision: oldId }
					);
				}
				if (prior.status !== 'current' || supersededIds.has(prior.id)) {
					throw typedError(
						'DECISION_NOT_FOUND',
						`Decision ${oldId} is already superseded.`,
						'Use decision-list to see current choice decision ids.',
						{ decision: oldId }
					);
				}
				priorChoices.push(prior);
			}

			// Submode 2b: Accepting review items that supersede 1 or more choices.
			if (request.items !== undefined) {
				const resolvedItems: ResolvedReviewItem[] = [];
				for (const item of request.items) {
					resolvedItems.push(await resolveItem(item));
				}
				const distinctAfterSets = dedupeStrings(resolvedItems.map((resolved) => resolved.afterSet));
				if (distinctAfterSets.length !== 1) {
					throw typedError(
						'REVIEW_ITEM_NOT_FOUND',
						`Review items span multiple after sets (${distinctAfterSets.join(', ')}); record items from one review pair per call.`,
						'Pass review items from the same specimen-review before/after set pair.',
						{ afterSets: distinctAfterSets }
					);
				}
				const requiredChoices = dedupeStrings(
					resolvedItems.flatMap((resolved) => resolved.touchedChoices)
				);
				const missingSupersedes = requiredChoices.filter((id) => !supersedeIds.includes(id));
				if (missingSupersedes.length > 0) {
					throw typedError(
						'SUPERSEDE_REQUIRED',
						`Accepting these review items supersedes choice(s) not listed in supersedes: ${missingSupersedes.join(', ')}.`,
						`Pass supersedes with all touched choices (${requiredChoices.join(', ')}) and a new reason.`,
						{ missing: missingSupersedes, required: requiredChoices }
					);
				}

				const targetEvidenceSetId = distinctAfterSets[0] as string;
				const afterManifest = await readCaptureSetManifest(root, targetEvidenceSetId);
				const compareOrder = await readCompareVariantOrder(root, afterManifest.set);
				const { ref: sharedEvidence } = await writeDecisionEvidence(
					root,
					afterManifest,
					compareOrder ?? undefined
				);

				const answers = resolvedItems.map((resolved) => resolved.entry);
				const reserved = new Set<string>();
				const planned: { oldChoice: ChoiceDecisionRecord; nextChoice: ChoiceDecisionRecord }[] = [];
				for (const oldChoice of priorChoices) {
					const nextId = await allocateDecisionId(root, reserved);
					reserved.add(nextId);
					const isSingle = priorChoices.length === 1;
					const nextChoice: ChoiceDecisionRecord = {
						id: nextId,
						kind: 'choice',
						slug: isSingle && request.slug !== undefined ? request.slug : oldChoice.slug,
						status: 'current',
						question:
							isSingle && request.question !== undefined ? request.question : oldChoice.question,
						variants: [...oldChoice.variants],
						chosen: oldChoice.chosen,
						kept: [...oldChoice.kept],
						discarded: [...oldChoice.discarded],
						...(oldChoice.discardedAt ? { discardedAt: { ...oldChoice.discardedAt } } : {}),
						reason: trimmedReason,
						evidence: sharedEvidence,
						subjects: cleanSubjects(oldChoice.subjects),
						answers,
						supersedes: oldChoice.id,
						decidedAt,
						decidedBy,
					};
					planned.push({ oldChoice, nextChoice });
				}

				const results = await publishSupersession(root, planned);
				if (Array.isArray(request.supersedes) && request.supersedes.length >= 2) {
					return { decisions: results };
				}
				return results[0] as DecisionRecordSingleResult;
			}

			// Submode 2a: Direct choice supersede / variant reversal (supports 1 or more choices).
			let sharedNewSet: {
				manifest: CaptureSetManifest;
				variants: string[];
			} | null = null;
			if (request.set !== undefined) {
				const manifest = await readCaptureSetManifest(root, request.set);
				const compareOrder = await readCompareVariantOrder(root, manifest.set);
				const manifestKeys = Object.keys(manifest.captures);
				const variants = compareOrder
					? [
							...compareOrder.filter((id) => Object.hasOwn(manifest.captures, id)),
							...manifestKeys.filter((id) => !compareOrder.includes(id)),
						]
					: manifestKeys;
				checkChosenPassesGate(manifest, request.chosen, variants);
				sharedNewSet = { manifest, variants };
			} else {
				for (const oldChoice of priorChoices) {
					if (!oldChoice.variants.includes(request.chosen)) {
						throw typedError(
							'VARIANT_NOT_FOUND',
							`Variant not found in decision ${oldChoice.id}: ${request.chosen}`,
							`Choose one of the decision's variants: ${oldChoice.variants.join(', ')}.`,
							{ decision: oldChoice.id, chosen: request.chosen, variants: oldChoice.variants }
						);
					}
					await checkChosenPassesCommittedEvidence(root, oldChoice, request.chosen);
				}
			}

			const sharedNewEvidence = sharedNewSet
				? (await writeDecisionEvidence(root, sharedNewSet.manifest, sharedNewSet.variants)).ref
				: null;

			const reserved = new Set<string>();
			const planned: { oldChoice: ChoiceDecisionRecord; nextChoice: ChoiceDecisionRecord }[] = [];
			for (const oldChoice of priorChoices) {
				const variants = sharedNewSet ? [...sharedNewSet.variants] : [...oldChoice.variants];
				const evidence = sharedNewEvidence ? { ...sharedNewEvidence } : { ...oldChoice.evidence };
				const discarded = oldChoice.discarded.filter(
					(variant) => variants.includes(variant) && variant !== request.chosen
				);
				const discardedSet = new Set(discarded);
				const kept = variants.filter(
					(variant) => variant !== request.chosen && !discardedSet.has(variant)
				);
				let discardedAt: Record<string, string> | undefined;
				if (oldChoice.discardedAt) {
					const remaining = Object.entries(oldChoice.discardedAt).filter(([variant]) =>
						discardedSet.has(variant)
					);
					if (remaining.length > 0) {
						discardedAt = Object.fromEntries(remaining);
					}
				}
				const isSingle = priorChoices.length === 1;
				const subjects: DecisionSubjects =
					isSingle && request.subjects !== undefined
						? {
								...cleanSubjects(request.subjects),
								specimens:
									request.subjects.specimens !== undefined
										? dedupeStrings(request.subjects.specimens)
										: [request.chosen],
							}
						: swapChosenSubject(oldChoice.subjects, oldChoice.chosen, request.chosen);

				const nextId = await allocateDecisionId(root, reserved);
				reserved.add(nextId);
				const nextChoice: ChoiceDecisionRecord = {
					id: nextId,
					kind: 'choice',
					slug: isSingle && request.slug !== undefined ? request.slug : oldChoice.slug,
					status: 'current',
					question:
						isSingle && request.question !== undefined ? request.question : oldChoice.question,
					variants,
					chosen: request.chosen,
					kept,
					discarded,
					...(discardedAt ? { discardedAt } : {}),
					reason: trimmedReason,
					evidence,
					subjects,
					supersedes: oldChoice.id,
					decidedAt,
					decidedBy,
				};
				planned.push({ oldChoice, nextChoice });
			}

			const results = await publishSupersession(root, planned);
			if (Array.isArray(request.supersedes) && request.supersedes.length >= 2) {
				return { decisions: results };
			}
			return results[0] as DecisionRecordSingleResult;
		}

		// Mode 3: Review answer (`items` without `supersedes`).
		const resolvedItems: ResolvedReviewItem[] = [];
		for (const item of request.items as string[]) {
			resolvedItems.push(await resolveItem(item));
		}
		if (request.chosen === 'accept') {
			const touched = dedupeStrings(resolvedItems.flatMap((resolved) => resolved.touchedChoices));
			if (touched.length > 0) {
				throw typedError(
					'SUPERSEDE_REQUIRED',
					`Accepting this review item undoes choice decision(s): ${touched.join(', ')}.`,
					`Pass supersedes with ${touched.join(', ')} and a new reason.`,
					{ decisions: touched }
				);
			}
		}

		let answerDecidedBy: DecisionActor = decidedBy;
		let isProvisional = false;
		if (request.provisional === true) {
			const actorId = options.actorId?.trim();
			const serverAuthor = options.changeAuthor?.trim();
			const callerAuthor = request.changeAuthor?.trim();
			if (!actorId || !serverAuthor) {
				throw typedError(
					'AUTHOR_CANNOT_DECIDE',
					'Provisional panel settlements require both a verified reviewer actorId and a server-derived changeAuthor.',
					'Run panel-review from a verified independent reviewer identity or ask a person to decide.'
				);
			}
			if (callerAuthor && callerAuthor !== serverAuthor) {
				throw typedError(
					'AUTHOR_CANNOT_DECIDE',
					`Caller-supplied changeAuthor '${callerAuthor}' disagrees with server-derived changeAuthor '${serverAuthor}'.`,
					'Do not override server-derived authorship; have an independent reviewer or person decide.'
				);
			}
			const panel = request.panel;
			if (!panel) {
				throw typedError(
					'VALIDATION_ERROR',
					'provisional: true requires panel provenance (reviewers and split).',
					'Pass panel: { reviewers, split } when recording a provisional panel settlement.'
				);
			}
			const normalizedReviewers = panel.reviewers.map((r) => r.trim());
			if (actorId === serverAuthor || normalizedReviewers.includes(serverAuthor)) {
				throw typedError(
					'AUTHOR_CANNOT_DECIDE',
					`Author '${serverAuthor}' cannot decide or sit on the panel for their own provisional settlement.`,
					'Run panel-review from an independent reviewer panel or ask a person to decide.'
				);
			}
			answerDecidedBy = {
				kind: 'panel',
				reviewers: [...panel.reviewers],
				split: panel.split,
			};
			isProvisional = true;
		}

		const id = await allocateDecisionId(root, new Set());
		const derivedQuestion =
			request.question ??
			(resolvedItems.length === 1
				? resolvedItems[0]?.question
				: `Review ${resolvedItems.length} unsettled items`);
		const answerRecord: AnswerDecisionRecord = {
			id,
			kind: 'answer',
			...(request.slug !== undefined ? { slug: request.slug } : {}),
			...(derivedQuestion ? { question: derivedQuestion } : {}),
			chosen: request.chosen as 'accept' | 'reject',
			reason: trimmedReason,
			answers: resolvedItems.map((resolved) => resolved.entry),
			...(isProvisional ? { provisional: true } : {}),
			decidedAt,
			decidedBy: answerDecidedBy,
		};
		const path = await writeDecisionFile(root, answerRecord);
		return formatSingleAnswerResult(answerRecord, path);
	});
}

/** Read a decision record by id, enriching choice records with their committed `evidence.captures`. */
export async function getDecision(
	root: string,
	rawRequest: DecisionGetRequest
): Promise<DecisionGetResult> {
	const request = parseDecisionGetRequest(rawRequest);
	const record = await readDecisionRecord(root, request.decision);
	if (record.kind === 'answer' || record.kind === 'card') {
		return {
			decision: record.id,
			...record,
		};
	}
	let effectiveStatus = record.status;
	if (effectiveStatus === 'current') {
		const all = await readAllDecisions(root);
		if (supersededIdsFromRecords(all).has(record.id)) {
			effectiveStatus = 'superseded';
		}
	}
	const captures = await resolveEvidenceCapturesForGet(root, record);
	return {
		decision: record.id,
		...record,
		status: effectiveStatus,
		evidence: {
			...record.evidence,
			captures,
		},
	};
}

/**
 * List decisions sorted by `decision` id ascending and local comparison sets that no decision cites
 * (`undecided`). Defaults to current choice decisions; supports `kind` (`choice` | `card` |
 * `answer` | `all`), `released`, and cursor pagination (`limit` / `after`).
 */
export async function listDecisions(
	root: string,
	rawRequest: DecisionListRequest = {}
): Promise<DecisionListResult> {
	const request = parseDecisionListRequest(rawRequest);
	const allRecords = await readAllDecisions(root);
	const supersededIds = supersededIdsFromRecords(allRecords);
	const choices = allRecords.filter(
		(record): record is ChoiceDecisionRecord => record.kind === 'choice'
	);
	const citedSets = new Set(choices.map((choice) => choice.evidence.set));
	const currentChoices = currentChoicesFromRecords(allRecords);

	const allReleases = await readAllReleases(root);
	const releaseByDecision = new Map<string, string>();
	for (const manifest of allReleases) {
		for (const decisionId of manifest.decisions) {
			if (!releaseByDecision.has(decisionId)) {
				releaseByDecision.set(decisionId, manifest.release);
			}
		}
	}

	const kindFilter = request.kind ?? 'choice';
	const includeExtendedFields = request.kind !== undefined || request.released !== undefined;
	const entries: DecisionListEntry[] = [];

	if (kindFilter === 'choice' || kindFilter === 'all') {
		for (const choice of currentChoices) {
			const stale: string[] = [];
			for (const pattern of choice.subjects.files ?? []) {
				if (!(await globMatchesAnyFile(root, pattern))) {
					stale.push(pattern);
				}
			}
			const release = releaseByDecision.get(choice.id);
			entries.push({
				decision: choice.id,
				question: choice.question,
				chosen: choice.chosen,
				stale,
				...(includeExtendedFields
					? {
							kind: 'choice' as const,
							released: release !== undefined,
							...(release !== undefined ? { release } : {}),
						}
					: {}),
			});
		}
	}

	if (kindFilter === 'card' || kindFilter === 'all') {
		const cardRecords = allRecords.filter(
			(record): record is CardDecisionRecord =>
				record.kind === 'card' && !supersededIds.has(record.id)
		);
		for (const record of cardRecords) {
			const release = releaseByDecision.get(record.id);
			entries.push({
				decision: record.id,
				kind: 'card',
				card: record.card,
				question: record.question ?? `Card ${record.card}`,
				chosen: record.chosen,
				stale: [],
				released: release !== undefined,
				...(release !== undefined ? { release } : {}),
				...(record.refusalScope !== undefined ? { refusalScope: record.refusalScope } : {}),
				...(record.meantToFix !== undefined ? { meantToFix: record.meantToFix } : {}),
			});
		}
	}

	if (kindFilter === 'answer' || kindFilter === 'all') {
		const answerRecords = allRecords.filter(
			(record): record is AnswerDecisionRecord => record.kind === 'answer'
		);
		for (const record of answerRecords) {
			const release = releaseByDecision.get(record.id);
			entries.push({
				decision: record.id,
				kind: 'answer',
				question: record.question ?? `Answer ${record.id}`,
				chosen: record.chosen,
				stale: [],
				released: release !== undefined,
				...(release !== undefined ? { release } : {}),
			});
		}
	}

	entries.sort((a, b) => compareCodeUnits(a.decision, b.decision));

	const releaseFiltered =
		request.released === undefined
			? entries
			: entries.filter((entry) => releaseByDecision.has(entry.decision) === request.released);

	const total = releaseFiltered.length;
	const hasPagination = request.limit !== undefined || request.after !== undefined;
	const afterFiltered =
		request.after === undefined
			? releaseFiltered
			: releaseFiltered.filter(
					(entry) => compareCodeUnits(entry.decision, request.after as string) > 0
				);
	const pageLimit = request.limit ?? 50;
	const decisions = hasPagination ? afterFiltered.slice(0, pageLimit) : afterFiltered;
	const next =
		hasPagination && afterFiltered.length > pageLimit
			? decisions[decisions.length - 1]?.decision
			: undefined;

	const undecided: UndecidedComparison[] = [];
	const setsRoot = captureSetsDir(root);
	let setEntries: Dirent[] = [];
	try {
		await assertRealContained(root, setsRoot, `Capture sets dir escapes root`);
		setEntries = await readdir(setsRoot, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			setEntries = [];
		} else {
			throw error;
		}
	}

	const candidateSetIds = setEntries
		.filter((entry) => entry.isDirectory() && SET_ID_PATTERN.test(entry.name))
		.map((entry) => entry.name)
		.sort(compareCodeUnits);

	for (const setId of candidateSetIds) {
		if (citedSets.has(setId)) continue;
		try {
			const manifest = await readCaptureSetManifest(root, setId);
			if (manifest.kind !== 'compare') continue;
			const compareOrder = await readCompareVariantOrder(root, setId);
			const manifestKeys = Object.keys(manifest.captures);
			const ids = compareOrder
				? [
						...compareOrder.filter((id) => Object.hasOwn(manifest.captures, id)),
						...manifestKeys.filter((id) => !compareOrder.includes(id)),
					]
				: manifestKeys;
			undecided.push({ set: setId, ids });
		} catch {
			// Skip unreadable or incomplete capture set directories.
		}
	}

	return {
		decisions,
		undecided,
		...(hasPagination || includeExtendedFields ? { total } : {}),
		...(next !== undefined ? { next } : {}),
	};
}

/**
 * Find current choice decisions whose subjects cover any of the requested `files`, `specimens`,
 * or `tokens`. Returns current choices only (never answers or superseded choices) and never blocks.
 */
export async function checkDecisions(
	root: string,
	rawRequest: DecisionCheckRequest = {}
): Promise<DecisionCheckResult> {
	const request = parseDecisionCheckRequest(rawRequest);
	const queryFiles = request.files ?? [];
	const querySpecimens = request.specimens ?? [];
	const queryTokens = request.tokens ?? [];
	if (queryFiles.length === 0 && querySpecimens.length === 0 && queryTokens.length === 0) {
		return { decisions: [] };
	}

	const allRecords = await readAllDecisions(root);
	const currentChoices = currentChoicesFromRecords(allRecords);

	const decisions: DecisionCheckEntry[] = [];
	for (const choice of currentChoices) {
		const subjectFiles = choice.subjects.files ?? [];
		const subjectSpecimens = choice.subjects.specimens ?? [];
		const subjectTokens = choice.subjects.tokens ?? [];

		const matchedFiles =
			subjectFiles.length > 0 && queryFiles.length > 0
				? dedupeStrings(
						queryFiles.filter((file) => {
							const normalized = normalizeFileForMatching(root, file);
							return subjectFiles.some((pattern) => matchesSubjectGlob(normalized, pattern));
						})
					)
				: [];
		const matchedSpecimens =
			subjectSpecimens.length > 0 && querySpecimens.length > 0
				? dedupeStrings(querySpecimens.filter((specimen) => subjectSpecimens.includes(specimen)))
				: [];
		const matchedTokens =
			subjectTokens.length > 0 && queryTokens.length > 0
				? dedupeStrings(queryTokens.filter((token) => subjectTokens.includes(token)))
				: [];

		if (matchedFiles.length === 0 && matchedSpecimens.length === 0 && matchedTokens.length === 0) {
			continue;
		}
		decisions.push({
			decision: choice.id,
			question: choice.question,
			chosen: choice.chosen,
			reason: choice.reason,
			...(choice.supersedes !== undefined ? { supersedes: choice.supersedes } : {}),
			matched: {
				...(matchedFiles.length > 0 ? { files: matchedFiles } : {}),
				...(matchedSpecimens.length > 0 ? { specimens: matchedSpecimens } : {}),
				...(matchedTokens.length > 0 ? { tokens: matchedTokens } : {}),
			},
		});
	}

	return { decisions };
}
