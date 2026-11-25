import { climbSelection, observationClimbTree } from './climb.js';
import { canonicalJson } from './diff.js';
import type { SpecimenHostError } from './host.js';
import {
	buildNoteSubjectFromPoint,
	createNoteRecord,
	evaluateNoteResolution,
	readAllNoteFiles,
	readNoteFile,
	requireNoteReason,
	requireNoteText,
	withNoteLock,
	writeNoteFile,
} from './note.js';
import {
	buildPoint,
	diffRecordedDigests,
	evaluatePointStaleness,
	formatPointContext,
	normalizePointContextInput,
	pointError,
	readPointFile,
	specimenNotFoundError,
} from './point.js';
import type { PointHost } from './point-run.js';
import { DEFAULT_PIN, type PointerPin, parsePointer } from './pointer.js';
import type {
	Note,
	NoteAddRequest,
	NoteCheckRequest,
	NoteCheckResult,
	NoteCheckUnchecked,
	NoteMoveRequest,
	NoteResult,
	NoteSubject,
} from './types.js';
import { parseNoteAddRequest, parseNoteCheckRequest, parseNoteMoveRequest } from './validate.js';

function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Build the browser-backed note subset of the `BenchRuntime` surface. */
export function createNoteApi(ensureOpen: () => void, host: PointHost) {
	return {
		async noteAdd(rawRequest: NoteAddRequest): Promise<NoteResult> {
			ensureOpen();
			return runNoteAdd(host, rawRequest);
		},
		async noteCheck(rawRequest: NoteCheckRequest = {}): Promise<NoteCheckResult> {
			ensureOpen();
			return runNoteCheck(host, rawRequest);
		},
		async noteMove(rawRequest: NoteMoveRequest): Promise<NoteResult> {
			ensureOpen();
			return runNoteMove(host, rawRequest);
		},
	};
}

async function resolveNoteTarget(
	host: PointHost,
	target: { point: string } | { pointer: string },
	timeoutMs?: number
): Promise<{ subject: NoteSubject; pin: PointerPin }> {
	const { config } = host;

	if ('point' in target) {
		const stored = await readPointFile(config.root, target.point);
		const changedFiles = await diffRecordedDigests(config.root, stored.source.digests);
		if (changedFiles.length > 0) {
			throw pointError(
				'POINT_STALE',
				`Point ${stored.id} is stale (${changedFiles.join(', ')}).`,
				'Run specimen-point to point again.',
				{ id: stored.id, changed: changedFiles }
			);
		}
		const entry = config.entries.find((item) => item.id === stored.specimen);
		if (!entry) {
			const staleness = evaluatePointStaleness(stored, changedFiles, null);
			throw pointError(
				'POINT_STALE',
				`Point ${stored.id} is stale (${staleness.changed.join(', ')}).`,
				'Run specimen-point to point again.',
				{ id: stored.id, changed: staleness.changed }
			);
		}
		const requestedContext = normalizePointContextInput(stored.context, 'request');
		const { observation, outcome, pointMeta } = await host.capture(
			{
				id: entry.id,
				context: requestedContext,
				...(stored.checkpoint ? { checkpoint: stored.checkpoint } : {}),
				...(timeoutMs ? { timeoutMs } : {}),
			},
			{ collectTexts: true }
		);
		const staleness = evaluatePointStaleness(
			stored,
			changedFiles,
			outcome && outcome.status !== 'passed' ? null : observation,
			pointMeta.slottedParents
		);
		if (staleness.status === 'stale' || !observation) {
			throw pointError(
				'POINT_STALE',
				`Point ${stored.id} is stale (${staleness.changed.join(', ')}).`,
				'Run specimen-point to point again.',
				{ id: stored.id, changed: staleness.changed }
			);
		}
		return {
			subject: buildNoteSubjectFromPoint(stored),
			pin: stored.pin ? { x: stored.pin.x, y: stored.pin.y } : { ...DEFAULT_PIN },
		};
	}

	const parsed = parsePointer(target.pointer);
	const knownIds = config.entries.map((item) => item.id);
	const entry = config.entries.find((item) => item.id === parsed.specimen);
	if (!entry) throw specimenNotFoundError(parsed.specimen, knownIds);
	const requestedContext = normalizePointContextInput(parsed.context, 'pointer');
	const { observation, outcome, pointMeta } = await host.capture(
		{
			id: entry.id,
			context: requestedContext,
			...(parsed.checkpoint ? { checkpoint: parsed.checkpoint } : {}),
			...(timeoutMs ? { timeoutMs } : {}),
		},
		{ collectTexts: true }
	);
	if (!observation || (outcome && outcome.status !== 'passed')) {
		throw new Error('The host returned no completed observation for note target resolution.');
	}
	const { elementTexts, slottedParents } = pointMeta;
	const tree = observationClimbTree(observation.channels.elements, slottedParents);
	const hit = tree.get(parsed.ref);
	if (!hit) {
		throw pointError(
			'TARGET_NOT_FOUND',
			`Pointer ref '${parsed.ref}' was not found in specimen '${entry.id}'.`,
			'Point again in the review page, or name a role and name that exist.',
			{ count: 0, ref: parsed.ref }
		);
	}
	const climbed = climbSelection(hit, parsed.depth ? { depth: parsed.depth } : {});
	const resolvedPoint = buildPoint({
		id: 'pt-000000000000',
		entry,
		config,
		observation,
		selected: climbed.selected,
		...(climbed.accessible
			? {
					accessible: {
						...(climbed.accessible.role ? { role: climbed.accessible.role } : {}),
						...(climbed.accessible.name ? { name: climbed.accessible.name } : {}),
						from: climbed.accessible.from.value,
					},
				}
			: {}),
		elementTexts,
		slottedParents,
		context: formatPointContext(observation.manifest.context, requestedContext),
		...(parsed.checkpoint ? { checkpoint: parsed.checkpoint } : {}),
		pin: parsed.pin,
		sourceDigests: {},
	});
	return {
		subject: buildNoteSubjectFromPoint(resolvedPoint),
		pin: { x: resolvedPoint.pin.x, y: resolvedPoint.pin.y },
	};
}

/** Execute `specimen-note-add`: validate text, verify/resolve point or pointer, and persist the note. */
export async function runNoteAdd(host: PointHost, rawRequest: NoteAddRequest): Promise<NoteResult> {
	const request = parseNoteAddRequest(rawRequest);
	requireNoteText(request.text);
	const target = 'point' in request ? { point: request.point } : { pointer: request.pointer };
	const { subject, pin } = await resolveNoteTarget(host, target, request.timeoutMs);
	const note = createNoteRecord({
		text: request.text,
		subject,
		pin,
		...(request.assignee !== undefined ? { assignee: request.assignee } : {}),
	});
	await writeNoteFile(host.config.root, note);
	return { note };
}

/** Execute `specimen-note-move`: verify reason, note, and new target, clear orphaned, and append history. */
export async function runNoteMove(
	host: PointHost,
	rawRequest: NoteMoveRequest
): Promise<NoteResult> {
	const request = parseNoteMoveRequest(rawRequest);
	const reason = requireNoteReason(request.reason, 'moving a note');
	await readNoteFile(host.config.root, request.id);
	const target = 'point' in request ? { point: request.point } : { pointer: request.pointer };
	const { subject, pin } = await resolveNoteTarget(host, target, request.timeoutMs);
	return withNoteLock(host.config.root, request.id, async () => {
		const latest = await readNoteFile(host.config.root, request.id);
		const updated: Note = {
			...latest,
			subject,
			pin,
			orphaned: false,
			history: [
				...latest.history,
				{
					change: 'moved',
					reason,
					at: new Date().toISOString(),
				},
			],
		};
		await writeNoteFile(host.config.root, updated);
		return { note: updated };
	});
}

function renderGroupKey(note: Note): string {
	const sortedContext = Object.entries(note.subject.context).sort(([a], [b]) =>
		compareCodeUnits(a, b)
	);
	return JSON.stringify([note.subject.specimen, note.subject.checkpoint ?? '', sortedContext]);
}

const HOST_INFRASTRUCTURE_CODES = new Set([
	'BROWSER_UNAVAILABLE',
	'HOST_OUTDATED',
	'PLAYWRIGHT_VERSION_MISMATCH',
]);

const HOST_INFRASTRUCTURE_MESSAGE =
	/(?:^Specimen host (?:is missing|failed to start)|^Specimen has no prebuilt host|^Specimen's (?:prebuilt Linux hosts need glibc|host package .+ is not installed)|has no host binary at )/i;

function isHostInfrastructureError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as SpecimenHostError).code;
	if (code && HOST_INFRASTRUCTURE_CODES.has(code)) return true;
	return HOST_INFRASTRUCTURE_MESSAGE.test(error.message);
}

function recordUnchecked(
	map: Map<string, { specimen: string; reason: NoteCheckUnchecked['reason']; notes: string[] }>,
	specimen: string,
	reason: NoteCheckUnchecked['reason'],
	noteIds: readonly string[]
): void {
	const key = `${specimen}\0${reason}`;
	const existing = map.get(key);
	if (existing) {
		existing.notes.push(...noteIds);
	} else {
		map.set(key, { specimen, reason, notes: [...noteIds] });
	}
}

/** Execute `specimen-note-check`: re-resolve open notes and persist `orphaned` flag changes safely. */
export async function runNoteCheck(
	host: PointHost,
	rawRequest: NoteCheckRequest = {}
): Promise<NoteCheckResult> {
	const { config } = host;
	const request = parseNoteCheckRequest(rawRequest);
	const allNotes = await readAllNoteFiles(config.root);
	const openNotes = allNotes.filter(
		(note) =>
			note.state === 'open' &&
			(request.specimen === undefined || note.subject.specimen === request.specimen)
	);

	const entriesById = new Map(config.entries.map((entry) => [entry.id, entry]));
	const uncheckedMap = new Map<
		string,
		{ specimen: string; reason: NoteCheckUnchecked['reason']; notes: string[] }
	>();
	const groups = new Map<string, Note[]>();

	for (const note of openNotes) {
		if (!entriesById.has(note.subject.specimen)) {
			recordUnchecked(uncheckedMap, note.subject.specimen, 'specimen-missing', [note.id]);
			continue;
		}
		const key = renderGroupKey(note);
		const list = groups.get(key);
		if (list) list.push(note);
		else groups.set(key, [note]);
	}

	let checked = 0;
	const orphaned: string[] = [];
	const weakened: string[] = [];
	const restored: string[] = [];

	for (const group of groups.values()) {
		const sample = group[0] as Note;
		const specimenId = sample.subject.specimen;
		const noteIds = group.map((note) => note.id);
		let observation = null;
		let outcome: { status: string } | null | undefined;
		let slottedParents: Readonly<Record<string, string>> = {};
		try {
			const requestedContext = normalizePointContextInput(sample.subject.context, 'request');
			const captured = await host.capture(
				{
					id: specimenId,
					context: requestedContext,
					...(sample.subject.checkpoint ? { checkpoint: sample.subject.checkpoint } : {}),
					...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
				},
				{ collectTexts: true }
			);
			observation = captured.observation;
			outcome = captured.outcome;
			slottedParents = captured.pointMeta.slottedParents;
		} catch (error) {
			if (isHostInfrastructureError(error)) throw error;
			recordUnchecked(uncheckedMap, specimenId, 'render-failed', noteIds);
			continue;
		}
		if (!observation || (outcome && outcome.status !== 'passed')) {
			recordUnchecked(uncheckedMap, specimenId, 'render-failed', noteIds);
			continue;
		}

		for (const note of group) {
			const status = evaluateNoteResolution(note, observation, slottedParents);
			const desiredOrphaned = status === 'orphaned';
			const expectedSubject = canonicalJson(note.subject);
			const committed = await withNoteLock(config.root, note.id, async () => {
				let latest: Note;
				try {
					latest = await readNoteFile(config.root, note.id);
				} catch (error) {
					if ((error as SpecimenHostError)?.code === 'NOTE_NOT_FOUND') return null;
					throw error;
				}
				// Another process resolved, moved, or re-pinned this note while we were rendering.
				if (latest.state !== 'open' || canonicalJson(latest.subject) !== expectedSubject) {
					return null;
				}
				const wasOrphaned = latest.orphaned;
				if (wasOrphaned !== desiredOrphaned) {
					await writeNoteFile(config.root, { ...latest, orphaned: desiredOrphaned });
				}
				return { wasOrphaned };
			});
			if (!committed) continue;
			checked++;
			if (status === 'orphaned') {
				orphaned.push(note.id);
			} else {
				if (status === 'weakened') weakened.push(note.id);
				if (committed.wasOrphaned) restored.push(note.id);
			}
		}
	}

	orphaned.sort(compareCodeUnits);
	weakened.sort(compareCodeUnits);
	restored.sort(compareCodeUnits);
	const unchecked = [...uncheckedMap.values()]
		.map((item) => ({
			specimen: item.specimen,
			reason: item.reason,
			notes: [...item.notes].sort(compareCodeUnits),
		}))
		.sort(
			(a, b) => compareCodeUnits(a.specimen, b.specimen) || compareCodeUnits(a.reason, b.reason)
		);

	return { checked, orphaned, weakened, unchecked, restored };
}
