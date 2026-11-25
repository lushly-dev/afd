import type { Point } from './point-types.js';

export type NoteOutcome = 'fixed' | 'declined' | 'duplicate' | 'obsolete' | 'withdrawn';

export type NoteState = 'open' | 'resolved';

export type NoteListState = NoteState | 'all';

export type NoteHistoryChange = 'moved' | 'resolved' | 'reopened';

export interface NoteSubject {
	specimen: string;
	checkpoint?: string;
	context: Record<string, string>;
	accessible: {
		role?: string;
		name?: string;
		from?: string;
	};
	identity: Point['identity'];
}

export interface NoteEvidence {
	revision?: string;
	capture?: string;
}

export interface NoteResolution {
	outcome: NoteOutcome;
	reason: string;
	evidence?: NoteEvidence;
}

export interface NoteHistoryEntry {
	change: NoteHistoryChange;
	reason: string;
	outcome?: NoteOutcome;
	evidence?: NoteEvidence;
	at?: string;
}

export interface Note {
	id: string;
	text: string;
	subject: NoteSubject;
	pin: { x: number; y: number };
	state: NoteState;
	orphaned: boolean;
	assignee?: string;
	resolution?: NoteResolution;
	history: NoteHistoryEntry[];
}

export type NoteAddRequest =
	| {
			point: string;
			text: string;
			assignee?: string;
			timeoutMs?: number;
	  }
	| {
			pointer: string;
			text: string;
			assignee?: string;
			timeoutMs?: number;
	  };

export interface NoteListRequest {
	specimen?: string;
	state?: NoteListState;
	assignee?: string;
	orphaned?: boolean;
	limit?: number;
	after?: string;
}

export interface NoteCheckRequest {
	specimen?: string;
	timeoutMs?: number;
}

export type NoteMoveRequest =
	| {
			id: string;
			point: string;
			reason?: string;
			timeoutMs?: number;
	  }
	| {
			id: string;
			pointer: string;
			reason?: string;
			timeoutMs?: number;
	  };

export type NoteResolveRequest =
	| {
			id: string;
			outcome: NoteOutcome;
			reason?: string;
			evidence?: NoteEvidence;
	  }
	| {
			ids: string[];
			outcome: NoteOutcome;
			reason?: string;
			evidence?: NoteEvidence;
	  };

export interface NoteReopenRequest {
	id: string;
	reason?: string;
}

export interface NoteResult {
	note: Note;
}

export interface NoteListResult {
	notes: Note[];
	next?: string;
}

export interface NoteCheckUnchecked {
	specimen: string;
	reason: 'render-failed' | 'specimen-missing';
	notes: string[];
}

export interface NoteCheckResult {
	checked: number;
	orphaned: string[];
	weakened: string[];
	unchecked: NoteCheckUnchecked[];
	restored: string[];
}

export interface NoteResolveSkipped {
	id: string;
	code: 'NOTE_ALREADY_RESOLVED' | 'NOTE_NOT_FOUND';
	reason: string;
}

export interface NoteResolveResult {
	resolved: Note[];
	skipped: NoteResolveSkipped[];
}
