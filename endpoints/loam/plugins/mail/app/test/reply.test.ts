/** The send slice's logic against a scripted client standing in for the mounted `mail` instance. */

import type { CommandResult } from '@lushly-dev/loam-sdk';
import { describe, expect, it } from 'vitest';
import {
	addressesOf,
	type MailClient,
	MOST_PAGES,
	Reply,
	replySubject,
	type ThreadMessage,
	threadOfRoute,
} from '../src/reply.js';

type Answer = CommandResult<unknown> | ((input: Record<string, unknown>) => CommandResult<unknown>);

/** A client that answers each command from a queue (its last answer repeats), or a function, and records calls. */
function scripted(answers: Record<string, Answer[]>) {
	const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
	const client: MailClient = {
		async call<T>(name: string, input?: unknown) {
			const given = (input ?? {}) as Record<string, unknown>;
			calls.push({ name, input: given });
			const queue = answers[name];
			const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
			if (!next) throw new Error(`no answer scripted for ${name}`);
			return (typeof next === 'function' ? next(given) : next) as CommandResult<T>;
		},
	};
	return { client, calls, named: (name: string) => calls.filter((call) => call.name === name) };
}

/** A client whose `held` command waits until the test answers it. */
function holding(client: MailClient, held: string) {
	let answer: ((result: CommandResult<unknown>) => void) | undefined;
	const wrapped: MailClient = {
		call<T>(name: string, input?: unknown) {
			if (name !== held) return client.call<T>(name, input);
			return new Promise<CommandResult<T>>((resolve) => {
				answer = resolve as (result: CommandResult<unknown>) => void;
			});
		},
	};
	return { client: wrapped, answer: (result: CommandResult<unknown>) => answer?.(result) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const ok = (data: unknown): CommandResult<unknown> => ({ success: true, data });
const failed = (code: string, message = 'No', suggestion?: string): CommandResult<unknown> => ({
	success: false,
	error: { code, message, ...(suggestion ? { suggestion } : {}) },
});

const message = (id: number, address: string, subject: string): ThreadMessage => ({
	message: id,
	date: id,
	content: { trust: 'content', sender: { name: null, address }, subject, snippet: '…' },
});

const page = (messages: ThreadMessage[], nextCursor: string | null = null) =>
	ok({ thread: 7, messages, nextCursor });

/** A draft as the engine gives it; an editable one is `open` (the engine's `DraftRow::state`). */
const draft = (revision: number, fields: Record<string, unknown> = {}, state = 'open') =>
	ok({
		draft: 3,
		revision,
		state,
		from: 'me@example.com',
		content: {
			trust: 'content',
			to: ['ada@example.com'],
			cc: [],
			bcc: [],
			subject: 'Re: Lunch',
			body: 'Thursday works.',
			bodyComplete: true,
			...fields,
		},
	});

const thread = () =>
	page([message(5, 'me@example.com', 'Lunch?'), message(7, 'ada@example.com', 'Re: Lunch?')]);

/** A reply opened on thread 7 whose first save makes draft 3 at revision 1. */
async function saved(answers: Record<string, Answer[]>) {
	const made = scripted({
		'mail-thread-open': [thread()],
		'mail-draft-create': [draft(1)],
		...answers,
	});
	const reply = new Reply(made.client);
	await reply.open(7);
	return { ...made, reply };
}

describe('opening a thread', () => {
	it("answers the thread's newest message, read to its last page", async () => {
		const { client, named } = scripted({
			'mail-thread-open': [
				page([message(5, 'bob@example.com', 'Lunch')], '5.5'),
				page([message(7, 'ada@example.com', 'Lunch')]),
			],
		});
		const reply = new Reply(client);
		await reply.open(7);
		expect(named('mail-thread-open').map(({ input }) => input)).toEqual([
			{ thread: 7, limit: 200 },
			{ thread: 7, limit: 200, cursor: '5.5' },
		]);
		expect(reply).toMatchObject({
			phase: 'ready',
			notice: null,
			answers: 7,
			to: 'ada@example.com',
			subject: 'Re: Lunch',
			cut: false,
			draft: null,
		});
		expect(reply.messages.map(({ message }) => message)).toEqual([5, 7]);
	});

	it('says it is opening while the thread is read', async () => {
		const { client, answer } = holding(scripted({}).client, 'mail-thread-open');
		const reply = new Reply(client);
		const opening = reply.open(7);
		expect(reply).toMatchObject({ phase: 'loading', notice: { text: 'Opening the thread' } });
		answer(thread());
		await opening;
		expect(reply.phase).toBe('ready');
	});

	it('stops reading a long thread and says so', async () => {
		const { client, named } = scripted({
			'mail-thread-open': [page([message(1, 'ada@example.com', 'Long')], 'more')],
		});
		const reply = new Reply(client);
		await reply.open(7);
		expect(named('mail-thread-open')).toHaveLength(MOST_PAGES);
		expect(reply.cut).toBe(true);
	});

	it("shows the engine's message, not its suggestion for a terminal, for a thread it cannot read", async () => {
		const { client } = scripted({
			'mail-thread-open': [failed('THREAD_NOT_FOUND', 'No thread 9', 'Run mail-thread-list')],
		});
		const reply = new Reply(client);
		await reply.open(9);
		expect(reply.phase).toBe('failed');
		expect(reply.notice).toEqual({ tone: 'danger', text: 'No thread 9' });
	});

	it('offers no reply to a thread with no messages', async () => {
		const { client, named } = scripted({
			'mail-thread-open': [page([])],
			'mail-draft-create': [draft(1)],
		});
		const reply = new Reply(client);
		await reply.open(7);
		expect(reply).toMatchObject({ phase: 'failed', notice: { tone: 'info' }, answers: null });
		expect(await reply.save()).toBe(false);
		expect(named('mail-draft-create')).toEqual([]);
	});

	it('goes on with the draft it made when the thread is opened again, and makes no second one', async () => {
		const { reply, named } = await saved({
			'mail-draft-show': [draft(2, { body: 'Kept.' })],
		});
		reply.edit('body', 'Kept.');
		await reply.save();
		await reply.open(7);
		expect(reply).toMatchObject({
			body: 'Kept.',
			saved: true,
			notice: { text: 'Your draft for this thread' },
		});
		expect(reply.draft?.revision).toBe(2);
		expect(named('mail-draft-show')[0]?.input).toEqual({ draft: 3 });
		expect(named('mail-draft-create')).toHaveLength(1);
	});

	it('starts a new reply when the draft it made was sent since', async () => {
		const { reply, named } = await saved({ 'mail-draft-show': [draft(2, {}, 'sent')] });
		await reply.save();
		await reply.open(7);
		expect(reply).toMatchObject({ draft: null, saved: false, notice: null, body: '' });
		await reply.save();
		expect(named('mail-draft-create')).toHaveLength(2);
	});

	it("keeps the thread's draft when it cannot be read, and offers no second draft", async () => {
		const { reply, named } = await saved({
			'mail-draft-show': [failed('MOUNT_UNREACHABLE', 'Mail is not answering'), draft(1)],
		});
		await reply.save();
		await reply.open(7);
		expect(reply).toMatchObject({ phase: 'failed', notice: { text: 'Mail is not answering' } });
		expect(await reply.save()).toBe(false);
		await reply.open(7);
		expect(reply).toMatchObject({ phase: 'ready', notice: { text: 'Your draft for this thread' } });
		expect(named('mail-draft-create')).toHaveLength(1);
	});

	it.each(['sending', 'unknown'])(
		'shows a draft whose send is %s locked, and sends it no second time',
		async (state) => {
			const { reply, named } = await saved({ 'mail-draft-show': [draft(2, {}, state)] });
			await reply.save();
			await reply.open(7);
			expect(reply.phase).toBe('sent');
			await reply.send();
			expect(named('mail-draft-send')).toEqual([]);
		}
	);

	it('starts a new reply when its draft is gone', async () => {
		const { reply, named } = await saved({ 'mail-draft-show': [failed('DRAFT_NOT_FOUND')] });
		await reply.save();
		await reply.open(7);
		expect(reply).toMatchObject({ phase: 'ready', draft: null });
		await reply.save();
		expect(named('mail-draft-create')).toHaveLength(2);
	});

	it('drops a thread read that a newer open overtook', async () => {
		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slow: MailClient = {
			async call<T>(_name: string, input?: unknown) {
				const { thread: id } = input as { thread: number };
				if (id === 1) await held;
				return page([message(id, `${id}@example.com`, `Thread ${id}`)]) as CommandResult<T>;
			},
		};
		const reply = new Reply(slow);
		const first = reply.open(1);
		await reply.open(2);
		release?.();
		await first;
		expect(reply).toMatchObject({ thread: 2, answers: 2, to: '2@example.com' });
	});
});

describe('saving the draft', () => {
	it('makes the draft on the first save and updates it by its revision after, Cc and Bcc as they are', async () => {
		const { client, named } = scripted({
			'mail-thread-open': [thread()],
			'mail-draft-create': [draft(1, { body: 'Thursday?', cc: ['cy@example.com'] })],
			'mail-draft-update': [draft(2)],
		});
		const reply = new Reply(client);
		await reply.open(7);
		reply.edit('body', 'Thursday?');
		expect(await reply.save()).toBe(true);
		expect(named('mail-draft-create')[0]?.input).toEqual({
			answers: 7,
			to: ['ada@example.com'],
			subject: 'Re: Lunch?',
			body: 'Thursday?',
		});
		// Nothing changed: nothing to send the engine.
		expect(await reply.save()).toBe(true);
		reply.edit('to', 'ada@example.com, bob@example.com');
		reply.edit('body', 'Thursday works.');
		expect(await reply.save()).toBe(true);
		expect(named('mail-draft-update').map(({ input }) => input)).toEqual([
			{
				draft: 3,
				revision: 1,
				to: ['ada@example.com', 'bob@example.com'],
				subject: 'Re: Lunch?',
				body: 'Thursday works.',
				cc: ['cy@example.com'],
				bcc: [],
			},
		]);
		expect(reply).toMatchObject({ saved: true, notice: { text: 'Draft saved' } });
		expect(reply.draft?.revision).toBe(2);
	});

	it('keeps what the person typed when the draft changed elsewhere, and takes the new revision and Bcc', async () => {
		const { reply, named } = await saved({
			'mail-draft-update': [failed('DRAFT_CHANGED'), draft(5)],
			'mail-draft-show': [draft(4, { body: 'By the copilot.', bcc: ['eve@example.com'] })],
		});
		await reply.save();
		reply.edit('body', 'Mine.');
		expect(await reply.save()).toBe(false);
		expect(reply.body).toBe('Mine.');
		expect(reply.draft).toMatchObject({ revision: 4, bcc: ['eve@example.com'] });
		expect(reply.notice?.tone).toBe('danger');
		expect(await reply.save()).toBe(true);
		expect(named('mail-draft-update')[1]?.input).toMatchObject({
			revision: 4,
			body: 'Mine.',
			bcc: ['eve@example.com'],
		});
	});

	it('says why when the changed draft cannot be read again, and keeps the old revision', async () => {
		const { reply } = await saved({
			'mail-draft-update': [failed('DRAFT_CHANGED', 'Changed')],
			'mail-draft-show': [failed('MOUNT_UNREACHABLE', 'Mail is not answering')],
		});
		await reply.save();
		reply.edit('body', 'Mine.');
		expect(await reply.save()).toBe(false);
		expect(reply.draft?.revision).toBe(1);
		expect(reply.notice).toEqual({ tone: 'danger', text: 'Changed' });
	});

	it('finds a draft sent elsewhere when its save is refused, and keeps it as sent', async () => {
		const { reply } = await saved({
			'mail-draft-update': [failed('INVALID_INPUT', 'This draft was sent')],
			'mail-draft-show': [draft(2, {}, 'sent')],
		});
		await reply.save();
		reply.edit('body', 'More.');
		expect(await reply.save()).toBe(false);
		expect(reply).toMatchObject({ phase: 'sent', body: 'Thursday works.' });
	});

	it('does not count what was typed during a save as saved, and sends nothing until it is', async () => {
		const base = scripted({ 'mail-thread-open': [thread()], 'mail-draft-send': [ok({})] });
		const { client, answer } = holding(base.client, 'mail-draft-create');
		const reply = new Reply(client);
		await reply.open(7);
		const sending = reply.send();
		await tick();
		reply.edit('body', 'A late word.');
		answer(draft(1));
		await sending;
		expect(reply.saved).toBe(false);
		expect(base.named('mail-draft-send')).toEqual([]);
	});

	it('saves nothing while the thread is still opening', async () => {
		const base = scripted({ 'mail-draft-create': [draft(1)] });
		const { client, answer } = holding(base.client, 'mail-thread-open');
		const reply = new Reply(client);
		const opening = reply.open(7);
		expect(await reply.save()).toBe(false);
		answer(thread());
		await opening;
		expect(base.named('mail-draft-create')).toEqual([]);
	});
});

describe('sending the draft', () => {
	it('saves, reads the draft by its revision as Loam will, then sends that revision', async () => {
		const { reply, calls, named } = await saved({
			'mail-draft-show': [draft(1)],
			'mail-draft-send': [ok({ draft: 3, revision: 2, state: 'sent' })],
		});
		await reply.send();
		expect(calls.map(({ name }) => name)).toEqual([
			'mail-thread-open',
			'mail-draft-create',
			'mail-draft-show',
			'mail-draft-send',
		]);
		expect(named('mail-draft-show')[0]?.input).toEqual({ draft: 3, revision: 1 });
		expect(named('mail-draft-send')[0]?.input).toEqual({ draft: 3, revision: 1 });
		expect(reply).toMatchObject({ phase: 'sent', notice: { tone: 'success', text: 'Sent' } });
		// A sent draft stays as it was sent: no edit, no second save or send.
		reply.edit('body', 'Too late.');
		expect(reply.body).not.toBe('Too late.');
		await reply.send();
		expect(named('mail-draft-send')).toHaveLength(1);
	});

	it('takes no typing while the send waits on the person', async () => {
		const base = scripted({
			'mail-thread-open': [thread()],
			'mail-draft-create': [draft(1)],
			'mail-draft-show': [draft(1)],
		});
		const { client, answer } = holding(base.client, 'mail-draft-send');
		const reply = new Reply(client);
		await reply.open(7);
		const sending = reply.send();
		await tick();
		expect(reply).toMatchObject({
			phase: 'sending',
			notice: { text: 'Confirm the send in Loam to send it' },
		});
		const before = reply.body;
		reply.edit('body', 'Typed while Loam asked.');
		answer(ok({ state: 'sent' }));
		await sending;
		expect(reply).toMatchObject({ phase: 'sent', body: before, saved: true });
	});

	it('says when the sent copy failed, which the engine gives as a warning', async () => {
		const { reply } = await saved({
			'mail-draft-show': [draft(1)],
			'mail-draft-send': [
				{ ...ok({ state: 'sent' }), warnings: [{ code: 'SENT_COPY_FAILED', message: 'x' }] },
			],
		});
		await reply.send();
		expect(reply.notice?.text).toBe('Sent. Its copy could not be saved in your sent mail');
	});

	it('shows a draft changed elsewhere before sending, and sends nothing', async () => {
		const { reply, named } = await saved({
			'mail-draft-show': [failed('PREVIEW_CHANGED'), draft(2, { body: 'By the copilot.' })],
		});
		await reply.send();
		expect(named('mail-draft-send')).toEqual([]);
		expect(reply).toMatchObject({ phase: 'ready', body: 'By the copilot.', saved: true });
		expect(reply.notice?.text).toBe('The draft changed since you looked. Check it and send again');
	});

	it.each([
		// What Loam answers when its own preview read, by the stale revision, is refused by the engine.
		['MOUNT_APPROVAL_UNAVAILABLE'],
		['MOUNT_PREVIEW_CHANGED'],
		['PREVIEW_CHANGED'],
	])(
		'on %s reads the draft again, shows it when it moved, and sends its new revision next',
		async (code) => {
			const { reply, named } = await saved({
				'mail-draft-show': [draft(1), draft(2, { body: 'By the copilot.' })],
				'mail-draft-send': [failed(code), ok({ state: 'sent' })],
			});
			await reply.send();
			expect(named('mail-draft-send')).toHaveLength(1);
			expect(reply).toMatchObject({ phase: 'ready', body: 'By the copilot.', saved: true });
			expect(reply.notice?.text).toBe(
				'The draft changed since you looked. Check it and send again'
			);
			await reply.send();
			expect(named('mail-draft-send')[1]?.input).toEqual({ draft: 3, revision: 2 });
		}
	);

	it("gives Loam's refusal in its words when the draft did not move", async () => {
		const { reply } = await saved({
			'mail-draft-show': [draft(1)],
			'mail-draft-send': [
				failed('MOUNT_APPROVAL_UNAVAILABLE', 'Loam cannot ask you for this', 'Check the entry'),
			],
		});
		await reply.send();
		expect(reply).toMatchObject({
			phase: 'ready',
			notice: { tone: 'danger', text: 'Loam cannot ask you for this' },
			saved: true,
		});
		expect(reply.draft?.revision).toBe(1);
	});

	it('asks nothing for a discarded draft, and makes a new one of what is on screen at the next save', async () => {
		const { reply, named } = await saved({ 'mail-draft-show': [draft(1, {}, 'discarded')] });
		await reply.save();
		// Discarded elsewhere after it was saved: the send's own check finds it.
		await reply.send();
		expect(named('mail-draft-send')).toEqual([]);
		expect(reply).toMatchObject({ phase: 'ready', draft: null, saved: false });
		expect(reply.notice?.tone).toBe('danger');
		reply.edit('body', 'Still mine.');
		expect(await reply.save()).toBe(true);
		expect(named('mail-draft-create')).toHaveLength(2);
		expect(named('mail-draft-create')[1]?.input).toMatchObject({ body: 'Still mine.' });
	});

	it.each(['sending', 'unknown'])(
		'asks nothing for a draft whose send is %s, and locks it',
		async (state) => {
			const { reply, named } = await saved({ 'mail-draft-show': [draft(1, {}, state)] });
			await reply.send();
			expect(named('mail-draft-send')).toEqual([]);
			expect(reply).toMatchObject({ phase: 'sent', notice: { tone: 'info' } });
		}
	);

	it('says why when a refused send cannot read the draft again', async () => {
		const { reply } = await saved({
			'mail-draft-show': [draft(1), failed('MOUNT_UNREACHABLE', 'Mail is not answering')],
			'mail-draft-send': [failed('MOUNT_UNREACHABLE', 'Mail is not answering')],
		});
		await reply.send();
		expect(reply.notice).toEqual({ tone: 'danger', text: 'Mail is not answering' });
	});

	it.each([
		['CONFIRMATION_DECLINED', 'Not sent'],
		['CONFIRMATION_PENDING', 'Waiting for your answer in the inbox'],
	])('on %s keeps the draft and says %j', async (code, text) => {
		const { reply } = await saved({
			'mail-draft-show': [draft(1)],
			'mail-draft-send': [failed(code)],
		});
		await reply.send();
		expect(reply).toMatchObject({ phase: 'ready', notice: { tone: 'info', text } });
		expect(reply.draft?.id).toBe(3);
	});

	it('finds a send confirmed later from the inbox, and sends it no second time', async () => {
		const { reply, named } = await saved({
			'mail-draft-show': [draft(1), failed('PREVIEW_CHANGED'), draft(2, {}, 'sent')],
			'mail-draft-send': [failed('CONFIRMATION_PENDING')],
		});
		await reply.send();
		await reply.send();
		expect(named('mail-draft-send')).toHaveLength(1);
		expect(reply).toMatchObject({ phase: 'sent', notice: { text: 'This draft was already sent' } });
	});

	it('sends nothing when the save fails', async () => {
		const { client, named } = scripted({
			'mail-thread-open': [thread()],
			'mail-draft-create': [failed('RECIPIENT_INVALID', 'Not an address')],
		});
		const reply = new Reply(client);
		await reply.open(7);
		reply.edit('to', 'not an address');
		await reply.send();
		expect(named('mail-draft-send')).toEqual([]);
		expect(reply.notice).toEqual({ tone: 'danger', text: 'Not an address' });
	});

	it("drops a send's answer once another thread is open, and leaves that thread as it was", async () => {
		const base = scripted({
			'mail-thread-open': [
				(input) => page([message(Number(input.thread), `${input.thread}@example.com`, 'Hi')]),
			],
			'mail-draft-create': [draft(1)],
			'mail-draft-show': [draft(1)],
		});
		const { client, answer } = holding(base.client, 'mail-draft-send');
		const reply = new Reply(client);
		await reply.open(1);
		const sending = reply.send();
		await tick();
		await reply.open(2);
		answer(ok({ state: 'sent' }));
		await sending;
		expect(reply).toMatchObject({ thread: 2, phase: 'ready', notice: null, draft: null });
	});
});

describe('its helpers', () => {
	it('splits addresses on commas, semicolons and spaces', () => {
		expect(addressesOf(' ada@example.com,bob@example.com; cy@example.com  ')).toEqual([
			'ada@example.com',
			'bob@example.com',
			'cy@example.com',
		]);
		expect(addressesOf('  ')).toEqual([]);
	});

	it('reads a thread id only from a route `thread/<id>`', () => {
		expect(threadOfRoute('thread/7')).toBe(7);
		for (const route of [undefined, '', 'thread/', 'thread/7/x', 'thread/-1', 'thread/1e3', 'x/7'])
			expect(threadOfRoute(route)).toBeNull();
	});

	it('puts "Re: " before a subject only once', () => {
		expect(replySubject('Lunch')).toBe('Re: Lunch');
		expect(replySubject('RE: Lunch')).toBe('RE: Lunch');
		expect(replySubject(null)).toBe('Re:');
	});
});
