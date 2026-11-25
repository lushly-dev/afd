import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { climbSelection, observationClimbTree } from './climb.js';
import type { SpecimenHostError } from './host.js';
import { CROCKFORD_BASE32, pointError } from './point.js';
import { DEFAULT_PIN, type PointerPin } from './pointer.js';
import { assertRealContained, specimenDataDir, withFileLock, writeFileAtomic } from './sets.js';
import type {
	Note,
	NoteEvidence,
	NoteHistoryEntry,
	NoteListRequest,
	NoteListResult,
	NoteOutcome,
	NoteReopenRequest,
	NoteResolveRequest,
	NoteResolveResult,
	NoteResolveSkipped,
	NoteResult,
	NoteSubject,
	Observation,
	Point,
} from './types.js';
import {
	parseNoteListRequest,
	parseNoteReopenRequest,
	parseNoteResolveRequest,
} from './validate.js';

export const NOTE_ID_LENGTH = 12;
export const NOTE_ID_PATTERN = /^note-[0-9a-hjkmnp-tv-z]{12}$/;
const NOTE_ID_READ_PATTERN = /^note-[0-9a-z]{12}$/;
const NOTE_FILENAME_PATTERN = /^(note-[0-9a-z]{12})\.json$/;

export const NOTES_DIR = join('specimens', 'notes');
export const DEFAULT_NOTE_LIST_LIMIT = 20;
export const MAX_NOTE_LIST_LIMIT = 100;
export const MAX_NOTE_TEXT_LENGTH = 4_000;
export const MAX_NOTE_REASON_LENGTH = 2_000;
export const MAX_NOTE_ASSIGNEE_LENGTH = 200;
export const MAX_NOTE_RESOLVE_IDS = 100;
export const MAX_NOTE_FILE_BYTES = 65_536;
export const NOTE_OUTCOMES = [
	'fixed',
	'declined',
	'duplicate',
	'obsolete',
	'withdrawn',
] as const satisfies readonly NoteOutcome[];

const NOTE_HISTORY_CHANGES = new Set(['moved', 'resolved', 'reopened']);
const NOTE_TOP_KEYS = new Set([
	'id',
	'text',
	'subject',
	'pin',
	'state',
	'orphaned',
	'assignee',
	'resolution',
	'history',
]);
const NOTE_SUBJECT_KEYS = new Set(['specimen', 'checkpoint', 'context', 'accessible', 'identity']);
const NOTE_ACCESSIBLE_KEYS = new Set(['role', 'name', 'from']);
const NOTE_IDENTITY_KEYS = new Set(['strongest', 'roleName', 'componentPosition', 'ref']);
const NOTE_PIN_KEYS = new Set(['x', 'y']);
const NOTE_EVIDENCE_KEYS = new Set(['revision', 'capture']);
const NOTE_RESOLUTION_KEYS = new Set(['outcome', 'reason', 'evidence']);
const NOTE_HISTORY_KEYS = new Set(['change', 'reason', 'outcome', 'evidence', 'at']);

export type NoteResolutionStatus = 'intact' | 'weakened' | 'orphaned';

function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function toPosixRelative(root: string, target: string): string | null {
	const rel = relative(root, target);
	if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	return rel.replaceAll('\\', '/');
}

/** Create a structured Specimen note error carrying AFD `code`, `suggestion`, and optional `details`. */
export function noteError(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): SpecimenHostError {
	return pointError(code, message, suggestion, details);
}

/** Generate a collision-free random note id (`note-` + 12 lowercase Crockford base-32 chars). */
export function generateNoteId(bytes: Uint8Array = randomBytes(NOTE_ID_LENGTH)): string {
	let suffix = '';
	for (let index = 0; index < NOTE_ID_LENGTH; index++) {
		suffix += CROCKFORD_BASE32[(bytes[index] ?? 0) & 31];
	}
	return `note-${suffix}`;
}

/** Validate non-empty note text or throw `NOTE_EMPTY`. */
export function requireNoteText(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		throw noteError(
			'NOTE_EMPTY',
			'Note text cannot be empty.',
			'Say what you noticed before adding the note.'
		);
	}
	return trimmed;
}

/** Validate non-empty reason for move, resolve, or reopen, or throw `REASON_REQUIRED`. */
export function requireNoteReason(reason: string | undefined, action: string): string {
	const trimmed = typeof reason === 'string' ? reason.trim() : '';
	if (trimmed.length === 0) {
		throw noteError(
			'REASON_REQUIRED',
			`A reason is required when ${action}.`,
			'Give a reason: what was done and why.'
		);
	}
	return trimmed;
}

/** Build the durable `NoteSubject` stored on a note from a resolved `Point`. */
export function buildNoteSubjectFromPoint(point: Point): NoteSubject {
	return {
		specimen: point.specimen,
		...(point.checkpoint ? { checkpoint: point.checkpoint } : {}),
		context: { ...point.context },
		accessible: {
			...(point.accessible.role ? { role: point.accessible.role } : {}),
			...(point.accessible.name ? { name: point.accessible.name } : {}),
			...(point.accessible.from ? { from: point.accessible.from } : {}),
		},
		identity: {
			strongest: point.identity.strongest,
			...(point.identity.roleName ? { roleName: { ...point.identity.roleName } } : {}),
			...(point.identity.componentPosition
				? { componentPosition: { ...point.identity.componentPosition } }
				: {}),
			ref: point.identity.ref,
		},
	};
}

/** Build a new open `Note` record, validating non-empty text (`NOTE_EMPTY`). */
export function createNoteRecord(input: {
	id?: string;
	text: string;
	subject: NoteSubject;
	pin?: PointerPin;
	assignee?: string;
}): Note {
	const text = requireNoteText(input.text);
	const pin = input.pin ? { x: input.pin.x, y: input.pin.y } : { ...DEFAULT_PIN };
	return {
		id: input.id ?? generateNoteId(),
		text,
		subject: input.subject,
		pin,
		state: 'open',
		orphaned: false,
		...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
		history: [],
	};
}

function normalizeEvidence(evidence: NoteEvidence | undefined): NoteEvidence | undefined {
	if (!evidence) return undefined;
	const normalized: NoteEvidence = {
		...(evidence.revision !== undefined ? { revision: evidence.revision } : {}),
		...(evidence.capture !== undefined ? { capture: evidence.capture } : {}),
	};
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Re-resolve a note's subject against a fresh capture observation:
 * - `'intact'`: resolved by the note's recorded strongest identity layer.
 * - `'weakened'`: strongest layer missed, but a weaker recorded layer still matches.
 * - `'orphaned'`: subject is missing or ambiguous (never moved by guesswork).
 */
export function evaluateNoteResolution(
	note: Note,
	observation: Observation,
	slottedParents?: Readonly<Record<string, string>>
): NoteResolutionStatus {
	const elements = observation.channels.elements;
	const tree = observationClimbTree(elements, slottedParents);
	const { identity } = note.subject;

	const checkRoleName = (): 'unique' | 'ambiguous' | 'none' => {
		if (!identity.roleName) return 'none';
		const { role, name } = identity.roleName;
		const climbedRefs = new Set<string>();
		for (const element of elements) {
			if (element.ref === 'root') continue;
			if (element.accessibility?.role === role && element.accessibility?.name?.trim() === name) {
				const node = tree.get(element.ref);
				if (node) climbedRefs.add(climbSelection(node).selected.value.ref);
			}
		}
		if (climbedRefs.size === 1) return 'unique';
		if (climbedRefs.size > 1) return 'ambiguous';
		return 'none';
	};

	const checkComponentPosition = (): boolean => {
		if (!identity.componentPosition) return false;
		const { tag, index } = identity.componentPosition;
		let count = 0;
		for (const element of elements) {
			if (element.ref === 'root') continue;
			if (element.tag === tag) {
				count++;
				if (count === index) return true;
			}
		}
		return false;
	};

	const checkRef = (): boolean => {
		const node = tree.get(identity.ref);
		if (!node) return false;
		const lastSegment = identity.ref.split('/').at(-1) ?? '';
		const expectedTag = lastSegment.split(':')[0];
		if (expectedTag && expectedTag !== 'root' && node.tag !== expectedTag) return false;
		return true;
	};

	if (identity.strongest === 'role-name') {
		const roleMatch = checkRoleName();
		if (roleMatch === 'unique') return 'intact';
		if (roleMatch === 'ambiguous') return 'orphaned';
		if (checkComponentPosition() || checkRef()) return 'weakened';
		return 'orphaned';
	}

	if (identity.strongest === 'component-position') {
		if (checkComponentPosition()) return 'intact';
		if (checkRef()) return 'weakened';
		return 'orphaned';
	}

	return checkRef() ? 'intact' : 'orphaned';
}

function noteNotFound(id: string): SpecimenHostError {
	return noteError(
		'NOTE_NOT_FOUND',
		`Note not found: ${id}`,
		'Run specimen-note-list to see available notes.',
		{ id }
	);
}

function isPlainRecord(
	value: unknown,
	allowedKeys?: ReadonlySet<string>
): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	if (allowedKeys) {
		for (const key of Object.keys(value)) {
			if (!allowedKeys.has(key)) return false;
		}
	}
	return true;
}

function isNonEmptyString(value: unknown, maxLength?: number): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		(maxLength === undefined || value.length <= maxLength)
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!isPlainRecord(value)) return false;
	return Object.values(value).every((entry) => typeof entry === 'string');
}

function isValidPin(value: unknown): value is { x: number; y: number } {
	if (!isPlainRecord(value, NOTE_PIN_KEYS)) return false;
	return (
		typeof value.x === 'number' &&
		Number.isFinite(value.x) &&
		value.x >= 0 &&
		value.x <= 1 &&
		typeof value.y === 'number' &&
		Number.isFinite(value.y) &&
		value.y >= 0 &&
		value.y <= 1
	);
}

function isValidEvidence(value: unknown): value is NoteEvidence {
	if (!isPlainRecord(value, NOTE_EVIDENCE_KEYS)) return false;
	if (value.revision !== undefined && !isNonEmptyString(value.revision)) return false;
	if (value.capture !== undefined && !isNonEmptyString(value.capture)) return false;
	return true;
}

function isValidAccessible(value: unknown): boolean {
	if (!isPlainRecord(value, NOTE_ACCESSIBLE_KEYS)) return false;
	if (value.role !== undefined && !isNonEmptyString(value.role)) return false;
	if (value.name !== undefined && !isNonEmptyString(value.name)) return false;
	if (value.from !== undefined && !isNonEmptyString(value.from)) return false;
	return true;
}

function isValidIdentity(value: unknown): boolean {
	if (!isPlainRecord(value, NOTE_IDENTITY_KEYS)) return false;
	if (
		typeof value.strongest !== 'string' ||
		!['role-name', 'component-position', 'ref'].includes(value.strongest)
	)
		return false;
	if (!isNonEmptyString(value.ref)) return false;
	if (value.roleName !== undefined) {
		if (
			!isPlainRecord(value.roleName, new Set(['role', 'name'])) ||
			!isNonEmptyString(value.roleName.role) ||
			!isNonEmptyString(value.roleName.name)
		) {
			return false;
		}
	}
	if (value.componentPosition !== undefined) {
		if (
			!isPlainRecord(value.componentPosition, new Set(['tag', 'index'])) ||
			!isNonEmptyString(value.componentPosition.tag) ||
			typeof value.componentPosition.index !== 'number' ||
			!Number.isSafeInteger(value.componentPosition.index) ||
			value.componentPosition.index < 1
		) {
			return false;
		}
	}
	return true;
}

function isValidHistoryEntry(value: unknown): value is NoteHistoryEntry {
	if (!isPlainRecord(value, NOTE_HISTORY_KEYS)) return false;
	if (typeof value.change !== 'string' || !NOTE_HISTORY_CHANGES.has(value.change)) return false;
	if (!isNonEmptyString(value.reason, MAX_NOTE_REASON_LENGTH)) return false;
	if (
		value.outcome !== undefined &&
		(typeof value.outcome !== 'string' ||
			!(NOTE_OUTCOMES as readonly string[]).includes(value.outcome))
	) {
		return false;
	}
	if (value.evidence !== undefined && !isValidEvidence(value.evidence)) return false;
	if (value.at !== undefined && !isNonEmptyString(value.at)) return false;
	return true;
}

function isValidStoredNote(value: unknown, expectedId: string): value is Note {
	if (!isPlainRecord(value, NOTE_TOP_KEYS)) return false;
	if (value.id !== expectedId) return false;
	if (!isNonEmptyString(value.text, MAX_NOTE_TEXT_LENGTH) || value.text.trim().length === 0)
		return false;
	if (value.state !== 'open' && value.state !== 'resolved') return false;
	if (typeof value.orphaned !== 'boolean') return false;
	if (value.assignee !== undefined && !isNonEmptyString(value.assignee, MAX_NOTE_ASSIGNEE_LENGTH))
		return false;
	if (!isValidPin(value.pin)) return false;
	if (!Array.isArray(value.history) || !value.history.every(isValidHistoryEntry)) return false;
	if (!isPlainRecord(value.subject, NOTE_SUBJECT_KEYS)) return false;
	if (!isNonEmptyString(value.subject.specimen)) return false;
	if (value.subject.checkpoint !== undefined && !isNonEmptyString(value.subject.checkpoint))
		return false;
	if (!isStringRecord(value.subject.context)) return false;
	if (!isValidAccessible(value.subject.accessible)) return false;
	if (!isValidIdentity(value.subject.identity)) return false;
	if (value.resolution !== undefined) {
		if (
			!isPlainRecord(value.resolution, NOTE_RESOLUTION_KEYS) ||
			typeof value.resolution.outcome !== 'string' ||
			!(NOTE_OUTCOMES as readonly string[]).includes(value.resolution.outcome) ||
			!isNonEmptyString(value.resolution.reason, MAX_NOTE_REASON_LENGTH) ||
			(value.resolution.evidence !== undefined && !isValidEvidence(value.resolution.evidence))
		) {
			return false;
		}
	}
	return true;
}

async function resolveContainedNotesDir(
	root: string,
	create: true
): Promise<{ realRoot: string; realDir: string }>;
async function resolveContainedNotesDir(
	root: string,
	create: false
): Promise<{ realRoot: string; realDir: string } | null>;
async function resolveContainedNotesDir(
	root: string,
	create: boolean
): Promise<{ realRoot: string; realDir: string } | null> {
	const realRoot = await realpath(root);
	let current = realRoot;
	for (const segment of ['specimens', 'notes']) {
		const next = join(current, segment);
		try {
			const stats = await lstat(next);
			if (stats.isSymbolicLink() || !stats.isDirectory()) {
				throw new Error(
					`Note storage path must be a real directory inside the project: ${segment}`
				);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				if (!create) return null;
				try {
					await mkdir(next);
				} catch (mkdirError) {
					if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
					const stats = await lstat(next);
					if (stats.isSymbolicLink() || !stats.isDirectory()) {
						throw new Error(
							`Note storage path must be a real directory inside the project: ${segment}`
						);
					}
				}
			} else {
				throw error;
			}
		}
		const canonical = await realpath(next);
		if (!toPosixRelative(realRoot, canonical)) {
			throw new Error(`Note storage path escapes the project root: ${segment}`);
		}
		current = canonical;
	}
	return { realRoot, realDir: current };
}

/** Acquire a cross-process lock under `.specimen/locks/notes/<id>.lock` around note mutations. */
export async function withNoteLock<T>(root: string, id: string, fn: () => Promise<T>): Promise<T> {
	if (!NOTE_ID_READ_PATTERN.test(id)) throw noteNotFound(id);
	const realRoot = await realpath(root);
	const lockPath = join(specimenDataDir(realRoot), 'locks', 'notes', `${id}.lock`);
	await assertRealContained(realRoot, lockPath, `Note lock path escapes project root: ${id}`);
	return withFileLock(lockPath, fn);
}

/** Write a note atomically to `<root>/specimens/notes/<id>.json`, confined inside `root`. */
export async function writeNoteFile(root: string, note: Note): Promise<string> {
	const noteId = note.id;
	if (!NOTE_ID_READ_PATTERN.test(noteId)) {
		throw new Error(`Invalid note id: ${noteId}`);
	}
	if (!isValidStoredNote(note, noteId)) {
		throw new Error(`Note ${noteId} does not match the Specimen note schema.`);
	}
	const { realDir } = await resolveContainedNotesDir(root, true);
	const file = resolve(realDir, `${note.id}.json`);
	if (!toPosixRelative(realDir, file)) {
		throw new Error(`Note file path escapes notes directory: ${note.id}`);
	}
	try {
		const existing = await lstat(file);
		if (existing.isSymbolicLink() || !existing.isFile()) {
			throw new Error(`Note file target is not a regular file: ${note.id}`);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	const serialized = `${JSON.stringify(note, null, 2)}\n`;
	if (Buffer.byteLength(serialized, 'utf8') > MAX_NOTE_FILE_BYTES) {
		throw new Error(
			`Note ${noteId} exceeds maximum size of ${MAX_NOTE_FILE_BYTES} bytes after serialization.`
		);
	}
	await writeFileAtomic(file, serialized);
	return file;
}

/** Read a stored note from `<root>/specimens/notes/<id>.json`, refusing symlinks and oversized/malformed files. */
export async function readNoteFile(root: string, id: string): Promise<Note> {
	if (!NOTE_ID_READ_PATTERN.test(id)) throw noteNotFound(id);
	const dirInfo = await resolveContainedNotesDir(root, false);
	if (!dirInfo) throw noteNotFound(id);
	const { realDir } = dirInfo;
	const candidate = resolve(realDir, `${id}.json`);
	if (!toPosixRelative(realDir, candidate)) throw noteNotFound(id);
	let linkStats: Awaited<ReturnType<typeof lstat>>;
	try {
		linkStats = await lstat(candidate);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw noteNotFound(id);
		throw error;
	}
	if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
		throw new Error(`Note file must be a regular file inside specimens/notes: ${id}`);
	}
	const realFile = await realpath(candidate);
	if (!toPosixRelative(realDir, realFile)) {
		throw new Error(`Note file escapes notes directory: ${id}`);
	}
	let raw: string;
	const handle = await open(realFile, 'r').catch((error: NodeJS.ErrnoException) => {
		if (error.code === 'ENOENT') throw noteNotFound(id);
		throw error;
	});
	try {
		const info = await handle.stat();
		if (!info.isFile()) {
			throw new Error(`Note file must be a regular file inside specimens/notes: ${id}`);
		}
		if (info.size > MAX_NOTE_FILE_BYTES) {
			throw new Error(
				`Note file for ${id} exceeds the maximum size of ${MAX_NOTE_FILE_BYTES} bytes.`
			);
		}
		raw = await handle.readFile('utf8');
	} finally {
		await handle.close();
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Note file for ${id} contains invalid JSON: ${detail}`);
	}
	if (!isValidStoredNote(parsed, id)) {
		throw new Error(`Note file for ${id} does not match the Specimen note schema.`);
	}
	return parsed;
}

async function listNoteIds(root: string): Promise<string[]> {
	const dirInfo = await resolveContainedNotesDir(root, false);
	if (!dirInfo) return [];
	const entries = await readdir(dirInfo.realDir);
	const ids: string[] = [];
	for (const name of entries) {
		const match = NOTE_FILENAME_PATTERN.exec(name);
		if (match?.[1]) ids.push(match[1]);
	}
	ids.sort(compareCodeUnits);
	return ids;
}

/** Read every committed note in `<root>/specimens/notes/` sorted deterministically by id. */
export async function readAllNoteFiles(root: string): Promise<Note[]> {
	const ids = await listNoteIds(root);
	const notes: Note[] = [];
	for (const id of ids) {
		notes.push(await readNoteFile(root, id));
	}
	return notes;
}

/** List notes from `<root>/specimens/notes/` with filtering and bounded cursor paging (no browser). */
export async function listNotes(
	root: string,
	rawRequest: NoteListRequest = {}
): Promise<NoteListResult> {
	const request = parseNoteListRequest(rawRequest);
	const state = request.state ?? 'open';
	const limit = request.limit ?? DEFAULT_NOTE_LIST_LIMIT;
	const allIds = await listNoteIds(root);
	const candidateIds =
		request.after !== undefined
			? allIds.filter((id) => compareCodeUnits(id, request.after as string) > 0)
			: allIds;
	const matched: Note[] = [];
	for (const id of candidateIds) {
		const note = await readNoteFile(root, id);
		if (state !== 'all' && note.state !== state) continue;
		if (request.specimen !== undefined && note.subject.specimen !== request.specimen) continue;
		if (request.assignee !== undefined && note.assignee !== request.assignee) continue;
		if (request.orphaned !== undefined && note.orphaned !== request.orphaned) continue;
		matched.push(note);
		if (matched.length > limit) break;
	}
	const hasMore = matched.length > limit;
	const page = hasMore ? matched.slice(0, limit) : matched;
	const last = page.at(-1);
	return {
		notes: page,
		...(hasMore && last ? { next: last.id } : {}),
	};
}

function applyResolution(
	note: Note,
	outcome: NoteOutcome,
	reason: string,
	evidence: NoteEvidence | undefined,
	at: string
): Note {
	const entry: NoteHistoryEntry = {
		change: 'resolved',
		reason,
		outcome,
		...(evidence ? { evidence } : {}),
		at,
	};
	return {
		...note,
		state: 'resolved',
		resolution: {
			outcome,
			reason,
			...(evidence ? { evidence } : {}),
		},
		history: [...note.history, entry],
	};
}

/** Resolve one note (`id`) or several (`ids`) in `<root>/specimens/notes/` (no browser). */
export async function resolveNotes(
	root: string,
	rawRequest: NoteResolveRequest
): Promise<NoteResolveResult> {
	const request = parseNoteResolveRequest(rawRequest);
	const reason = requireNoteReason(request.reason, 'resolving a note');
	const evidence = normalizeEvidence(request.evidence);
	const at = new Date().toISOString();

	if ('id' in request) {
		return withNoteLock(root, request.id, async () => {
			const note = await readNoteFile(root, request.id);
			if (note.state === 'resolved') {
				throw noteError(
					'NOTE_ALREADY_RESOLVED',
					`Note ${note.id} is already resolved.`,
					'Run specimen-note-reopen to reopen it, or specimen-note-add for a new observation.',
					{ id: note.id }
				);
			}
			const updated = applyResolution(note, request.outcome, reason, evidence, at);
			await writeNoteFile(root, updated);
			return { resolved: [updated], skipped: [] };
		});
	}

	const resolved: Note[] = [];
	const skipped: NoteResolveSkipped[] = [];
	for (const id of request.ids) {
		if (!NOTE_ID_READ_PATTERN.test(id)) {
			skipped.push({ id, code: 'NOTE_NOT_FOUND', reason: `Note not found: ${id}` });
			continue;
		}
		await withNoteLock(root, id, async () => {
			let note: Note;
			try {
				note = await readNoteFile(root, id);
			} catch (error) {
				const structured = error as SpecimenHostError;
				if (structured?.code === 'NOTE_NOT_FOUND') {
					skipped.push({ id, code: 'NOTE_NOT_FOUND', reason: structured.message });
					return;
				}
				throw error;
			}
			if (note.state === 'resolved') {
				skipped.push({
					id: note.id,
					code: 'NOTE_ALREADY_RESOLVED',
					reason: `Note ${note.id} is already resolved.`,
				});
				return;
			}
			const updated = applyResolution(note, request.outcome, reason, evidence, at);
			await writeNoteFile(root, updated);
			resolved.push(updated);
		});
	}
	return { resolved, skipped };
}

function hasCurrentResolutionInHistory(history: readonly NoteHistoryEntry[]): boolean {
	for (let index = history.length - 1; index >= 0; index--) {
		const entry = history[index];
		if (entry?.change === 'resolved') return true;
		if (entry?.change === 'reopened') return false;
	}
	return false;
}

/** Reopen a resolved note in `<root>/specimens/notes/`, preserving its prior resolution in history. */
export async function reopenNote(root: string, rawRequest: NoteReopenRequest): Promise<NoteResult> {
	const request = parseNoteReopenRequest(rawRequest);
	const reason = requireNoteReason(request.reason, 'reopening a note');
	return withNoteLock(root, request.id, async () => {
		const note = await readNoteFile(root, request.id);
		if (note.state !== 'resolved') {
			throw noteError(
				'NOTE_NOT_RESOLVED',
				`Note ${note.id} is not resolved.`,
				'Run specimen-note-resolve to close an open note.',
				{ id: note.id }
			);
		}
		const history: NoteHistoryEntry[] = [...note.history];
		if (note.resolution && !hasCurrentResolutionInHistory(history)) {
			history.push({
				change: 'resolved',
				reason: note.resolution.reason,
				outcome: note.resolution.outcome,
				...(note.resolution.evidence ? { evidence: note.resolution.evidence } : {}),
			});
		}
		history.push({
			change: 'reopened',
			reason,
			at: new Date().toISOString(),
		});
		const { resolution: _removed, ...rest } = note;
		const updated: Note = {
			...rest,
			state: 'open',
			history,
		};
		await writeNoteFile(root, updated);
		return { note: updated };
	});
}
