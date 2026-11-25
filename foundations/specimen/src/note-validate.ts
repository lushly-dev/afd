import type {
	NoteAddRequest,
	NoteCheckRequest,
	NoteEvidence,
	NoteListRequest,
	NoteListState,
	NoteMoveRequest,
	NoteOutcome,
	NoteReopenRequest,
	NoteResolveRequest,
} from './types.js';

type Fields = Record<string, unknown>;

const NOTE_OUTCOMES_LIST = ['fixed', 'declined', 'duplicate', 'obsolete', 'withdrawn'] as const;
const NOTE_LIST_STATES = ['open', 'resolved', 'all'] as const;
const MAX_NOTE_TEXT_LENGTH = 4_000;
const MAX_NOTE_REASON_LENGTH = 2_000;
const MAX_NOTE_ASSIGNEE_LENGTH = 200;
const MAX_NOTE_RESOLVE_IDS = 100;

function fail(path: string, message: string): never {
	throw new TypeError(`Invalid ${path}: ${message}`);
}

function record(value: unknown, path: string, keys: readonly string[]): Fields {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected an object');
	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) fail(path, `unrecognized key "${key}"`);
	}
	return value as Fields;
}

function text(value: unknown, path: string, maxLength?: number): string {
	if (typeof value !== 'string' || value.length === 0) fail(path, 'expected a non-empty string');
	if (maxLength !== undefined && value.length > maxLength)
		fail(path, `expected at most ${maxLength} characters`);
	return value;
}

function boundedString(value: unknown, path: string, maxLength: number): string {
	if (typeof value !== 'string') fail(path, 'expected a string');
	if (value.length > maxLength) fail(path, `expected at most ${maxLength} characters`);
	return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
		fail(path, `expected an integer from ${min} to ${max}`);
	return value;
}

function choice<T extends string>(value: unknown, path: string, values: readonly T[]): T {
	if (typeof value !== 'string' || !values.includes(value as T))
		fail(path, `expected one of ${values.join(', ')}`);
	return value as T;
}

function parseNoteEvidence(value: unknown, path: string): NoteEvidence {
	const fields = record(value, path, ['revision', 'capture']);
	return {
		...(fields.revision === undefined
			? {}
			: { revision: text(fields.revision, `${path}.revision`) }),
		...(fields.capture === undefined ? {} : { capture: text(fields.capture, `${path}.capture`) }),
	};
}

export function parseNoteAddRequest(value: unknown): NoteAddRequest {
	const path = 'note add request';
	const fields = record(value, path, ['point', 'pointer', 'text', 'assignee', 'timeoutMs']);
	const hasPoint = fields.point !== undefined;
	const hasPointer = fields.pointer !== undefined;
	if (hasPoint === hasPointer) {
		fail(path, 'provide either point or pointer, not both');
	}
	const noteText = boundedString(fields.text, `${path}.text`, MAX_NOTE_TEXT_LENGTH);
	const assignee =
		fields.assignee === undefined
			? undefined
			: text(fields.assignee, `${path}.assignee`, MAX_NOTE_ASSIGNEE_LENGTH);
	const timeoutMs =
		fields.timeoutMs === undefined
			? undefined
			: integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	if (hasPoint) {
		return {
			point: text(fields.point, `${path}.point`),
			text: noteText,
			...(assignee === undefined ? {} : { assignee }),
			...(timeoutMs === undefined ? {} : { timeoutMs }),
		};
	}
	if (typeof fields.pointer !== 'string') fail(`${path}.pointer`, 'expected a string');
	return {
		pointer: fields.pointer,
		text: noteText,
		...(assignee === undefined ? {} : { assignee }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	};
}

export function parseNoteListRequest(value: unknown = {}): NoteListRequest {
	const path = 'note list request';
	const fields = record(value, path, [
		'specimen',
		'state',
		'assignee',
		'orphaned',
		'limit',
		'after',
	]);
	const result: NoteListRequest = {};
	if (fields.specimen !== undefined) result.specimen = text(fields.specimen, `${path}.specimen`);
	if (fields.state !== undefined)
		result.state = choice<NoteListState>(fields.state, `${path}.state`, NOTE_LIST_STATES);
	if (fields.assignee !== undefined)
		result.assignee = text(fields.assignee, `${path}.assignee`, MAX_NOTE_ASSIGNEE_LENGTH);
	if (fields.orphaned !== undefined) {
		if (typeof fields.orphaned !== 'boolean') fail(`${path}.orphaned`, 'expected a boolean');
		result.orphaned = fields.orphaned;
	}
	if (fields.limit !== undefined) result.limit = integer(fields.limit, `${path}.limit`, 1, 100);
	if (fields.after !== undefined) result.after = text(fields.after, `${path}.after`);
	return result;
}

export function parseNoteCheckRequest(value: unknown = {}): NoteCheckRequest {
	const path = 'note check request';
	const fields = record(value, path, ['specimen', 'timeoutMs']);
	const timeoutMs =
		fields.timeoutMs === undefined
			? undefined
			: integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	return {
		...(fields.specimen === undefined
			? {}
			: { specimen: text(fields.specimen, `${path}.specimen`) }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	};
}

export function parseNoteMoveRequest(value: unknown): NoteMoveRequest {
	const path = 'note move request';
	const fields = record(value, path, ['id', 'point', 'pointer', 'reason', 'timeoutMs']);
	const id = text(fields.id, `${path}.id`);
	const hasPoint = fields.point !== undefined;
	const hasPointer = fields.pointer !== undefined;
	if (hasPoint === hasPointer) {
		fail(path, 'provide either point or pointer, not both');
	}
	const reason =
		fields.reason === undefined
			? undefined
			: boundedString(fields.reason, `${path}.reason`, MAX_NOTE_REASON_LENGTH);
	const timeoutMs =
		fields.timeoutMs === undefined
			? undefined
			: integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	if (hasPoint) {
		return {
			id,
			point: text(fields.point, `${path}.point`),
			...(reason === undefined ? {} : { reason }),
			...(timeoutMs === undefined ? {} : { timeoutMs }),
		};
	}
	if (typeof fields.pointer !== 'string') fail(`${path}.pointer`, 'expected a string');
	return {
		id,
		pointer: fields.pointer,
		...(reason === undefined ? {} : { reason }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	};
}

export function parseNoteResolveRequest(value: unknown): NoteResolveRequest {
	const path = 'note resolve request';
	const fields = record(value, path, ['id', 'ids', 'outcome', 'reason', 'evidence']);
	const hasId = fields.id !== undefined;
	const hasIds = fields.ids !== undefined;
	if (hasId === hasIds) {
		fail(path, 'provide either id or ids, not both');
	}
	const outcome = choice<NoteOutcome>(fields.outcome, `${path}.outcome`, NOTE_OUTCOMES_LIST);
	const reason =
		fields.reason === undefined
			? undefined
			: boundedString(fields.reason, `${path}.reason`, MAX_NOTE_REASON_LENGTH);
	const evidence =
		fields.evidence === undefined
			? undefined
			: parseNoteEvidence(fields.evidence, `${path}.evidence`);
	if (hasId) {
		return {
			id: text(fields.id, `${path}.id`),
			outcome,
			...(reason === undefined ? {} : { reason }),
			...(evidence === undefined ? {} : { evidence }),
		};
	}
	if (
		!Array.isArray(fields.ids) ||
		fields.ids.length < 1 ||
		fields.ids.length > MAX_NOTE_RESOLVE_IDS
	) {
		fail(`${path}.ids`, `expected between 1 and ${MAX_NOTE_RESOLVE_IDS} note ids`);
	}
	const ids = fields.ids.map((item, index) => text(item, `${path}.ids[${index}]`));
	return {
		ids,
		outcome,
		...(reason === undefined ? {} : { reason }),
		...(evidence === undefined ? {} : { evidence }),
	};
}

export function parseNoteReopenRequest(value: unknown): NoteReopenRequest {
	const path = 'note reopen request';
	const fields = record(value, path, ['id', 'reason']);
	const id = text(fields.id, `${path}.id`);
	const reason =
		fields.reason === undefined
			? undefined
			: boundedString(fields.reason, `${path}.reason`, MAX_NOTE_REASON_LENGTH);
	return {
		id,
		...(reason === undefined ? {} : { reason }),
	};
}
