/**
 * @fileoverview The signed `requestState` that the MCP lane mints for confirmation and approval
 * elicitations (`mcp-modern.ts`): what it may carry, and the check of a verified payload.
 */

/**
 * One question an elicitation asked: its input key, its binding, the deadline for its answer
 * (epoch milliseconds, kept when it is carried to a later round) and, for an approval, its nonce,
 * expiry and MAC. An up-front approval of a batch or pipeline step also keeps the step's index,
 * the canonical JSON of its validated input and a digest of the request (#1414).
 */
export interface Asked {
	k: string;
	b: string;
	t: number;
	n?: string;
	x?: number;
	m?: string;
	s?: number;
	i?: string;
	c?: string;
}

/** How long an answer counts, from when its question was asked (as the codec's own TTL). */
export const ANSWER_TTL_SECONDS = 600;

/** The signed `requestState`: the questions just asked, and those accepted in earlier rounds. */
export interface RoundState {
	p: Asked[];
	a: Asked[];
}

export interface RoundAnswers {
	accepted: Asked[];
	declined: Asked[];
}

function isAsked(value: unknown): value is Asked {
	if (!isRecord(value) || typeof value.k !== 'string' || typeof value.b !== 'string') return false;
	return (
		Number.isFinite(value.t) &&
		(value.n === undefined || typeof value.n === 'string') &&
		(value.x === undefined || Number.isFinite(value.x)) &&
		(value.m === undefined || typeof value.m === 'string') &&
		(value.s === undefined || Number.isSafeInteger(value.s)) &&
		(value.i === undefined || typeof value.i === 'string') &&
		(value.c === undefined || typeof value.c === 'string')
	);
}

export function isRoundState(value: unknown): value is RoundState {
	return (
		isRecord(value) &&
		Array.isArray(value.p) &&
		Array.isArray(value.a) &&
		value.p.every(isAsked) &&
		value.a.every(isAsked)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
