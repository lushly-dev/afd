/**
 * @fileoverview Open turns and the questions they wait on.
 *
 * A turn streams its events to the page that sent the message (`POST /chat`). Twice it needs an
 * answer back: when `todo-clear` is held for the person's approval, and when the model calls a
 * view-state command the page hosts. The turn sends the question as an event with an `ask`
 * number, and the page answers with `POST /chat/answer { turn, ask, ... }`.
 *
 * A turn's id is random, so only the page that holds its stream can answer it. A question not
 * answered in time, or still open when the turn ends, settles as declined: an approval is a no,
 * a view call a failure. Each question is answered at most once.
 */

import { randomUUID } from 'node:crypto';

/** What the page is asked, sent as an event on the turn's stream with `ask` added. */
export type Question =
	| { type: 'approval'; command: string; summary: string; expiresAt: string }
	| { type: 'view'; command: string; input: Record<string, unknown> };

interface Pending {
	type: Question['type'];
	settle: (answer: unknown) => void;
}

/** One turn: its id, and the questions it is waiting on. */
export class Turn {
	readonly id = randomUUID();
	private nextAsk = 1;
	private readonly pending = new Map<number, Pending>();
	private closed = false;

	constructor(private readonly send: (event: Record<string, unknown>) => void) {}

	/**
	 * Ask the page, and wait for its answer: `undefined` when the time runs out, the signal aborts
	 * or the turn ends first.
	 */
	ask(question: Question, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
		if (this.closed || signal?.aborted) return Promise.resolve(undefined);
		const ask = this.nextAsk++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => settle(undefined), Math.max(0, timeoutMs));
			const onAbort = () => settle(undefined);
			const settle = (answer: unknown) => {
				if (!this.pending.delete(ask)) return;
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				// The page may still show the question: tell it the question is over
				if (answer === undefined && !this.closed) this.send({ type: 'withdrawn', ask });
				resolve(answer);
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			this.pending.set(ask, { type: question.type, settle });
			this.send({ ...question, ask });
		});
	}

	/** The page's answer to `ask`; false when no such question is open or it is the wrong kind. */
	answer(ask: number, type: Question['type'], value: unknown): boolean {
		const pending = this.pending.get(ask);
		if (!pending || pending.type !== type) return false;
		pending.settle(value);
		return true;
	}

	/** End the turn: every open question settles as declined. */
	close(): void {
		this.closed = true;
		for (const pending of [...this.pending.values()]) pending.settle(undefined);
	}
}

/** The turns in progress, by id. */
export class TurnDesk {
	private readonly turns = new Map<string, Turn>();

	/** Open a turn whose events go to `send`. Close it with {@link TurnDesk.close}. */
	open(send: (event: Record<string, unknown>) => void): Turn {
		const turn = new Turn(send);
		this.turns.set(turn.id, turn);
		return turn;
	}

	get(id: string): Turn | undefined {
		return this.turns.get(id);
	}

	close(turn: Turn): void {
		turn.close();
		this.turns.delete(turn.id);
	}

	/** How many turns are open, for the metrics. */
	get size(): number {
		return this.turns.size;
	}
}
