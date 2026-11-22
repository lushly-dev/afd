import { describe, expect, it } from 'vitest';
import { createSessionStore, DEFAULT_MAX_SESSIONS } from './http-sessions.js';

function clock(start = 0) {
	let time = start;
	return {
		now: () => time,
		advance: (ms: number) => {
			time += ms;
		},
	};
}

/** A session ID `create` returned, failing the test when it refused. */
function created(id: string | undefined): string {
	expect(id).toBeDefined();
	return id as string;
}

describe('createSessionStore', () => {
	it('creates unguessable sessions that each own a context stack', () => {
		const store = createSessionStore();
		const a = created(store.create());
		const b = created(store.create());
		expect(a).toMatch(/^[0-9a-f-]{36}$/);
		expect(a).not.toBe(b);
		store.get(a)?.enter('edit');
		expect(store.get(a)?.getActive()).toBe('edit');
		expect(store.get(b)?.getActive()).toBeNull();
		expect(store.get('unknown')).toBeUndefined();
		expect(store.size).toBe(2);
	});

	it('expires idle sessions and refreshes active ones', () => {
		const time = clock();
		const store = createSessionStore({ idleTimeoutMs: 100, now: time.now });
		const active = created(store.create());
		const idle = created(store.create());
		time.advance(60);
		expect(store.get(active)).toBeDefined();
		time.advance(60);
		expect(store.get(active)).toBeDefined();
		expect(store.get(idle)).toBeUndefined();
		expect(store.size).toBe(1);
		time.advance(100);
		store.create();
		expect(store.size).toBe(1);
		expect(store.get(active)).toBeUndefined();
	});

	it('evicts the least recently used session at capacity', () => {
		const store = createSessionStore({ maxSessions: 2 });
		const first = created(store.create());
		const second = created(store.create());
		expect(store.get(first)).toBeDefined();
		const third = created(store.create());
		expect(store.size).toBe(2);
		expect(store.get(second)).toBeUndefined();
		expect(store.get(first)).toBeDefined();
		expect(store.get(third)).toBeDefined();
	});

	it("at capacity evicts only the creating owner's own sessions, and refuses an owner with none", () => {
		const store = createSessionStore({ maxSessions: 2 });
		const alice = created(store.create('alice'));
		const bob = created(store.create('bob'));
		// Alice's session is the least recently used, yet Bob's initialize may not end it.
		expect(store.create('bob')).toBeDefined();
		expect(store.get(bob, 'bob')).toBeUndefined();
		expect(store.get(alice, 'alice')).toBeDefined();
		expect(store.create('mallory')).toBeUndefined();
		expect(store.create()).toBeUndefined();
		expect(store.size).toBe(2);
		expect(store.get(alice, 'alice')).toBeDefined();
		// Alice can give up her own session for a new one.
		const next = created(store.create('alice'));
		expect(store.get(alice, 'alice')).toBeUndefined();
		expect(store.get(next, 'alice')).toBeDefined();
		expect(store.size).toBe(2);
	});

	it('makes room from expired sessions of any owner before refusing', () => {
		const time = clock();
		const store = createSessionStore({ maxSessions: 1, idleTimeoutMs: 100, now: time.now });
		store.create('alice');
		expect(store.create('bob')).toBeUndefined();
		time.advance(100);
		expect(store.create('bob')).toBeDefined();
	});

	it('answers a session owned by another caller as unknown, and leaves it untouched', () => {
		const time = clock();
		const store = createSessionStore({ idleTimeoutMs: 100, now: time.now });
		const id = created(store.create('alice'));
		store.get(id, 'alice')?.enter('edit');
		time.advance(60);
		expect(store.get(id, 'mallory')).toBeUndefined();
		expect(store.get(id)).toBeUndefined();
		// The refused look did not refresh the idle timer, nor drop the session.
		time.advance(30);
		expect(store.get(id, 'alice')?.getActive()).toBe('edit');
		expect(store.get(created(store.create()), 'alice')).toBeUndefined();
	});

	it('clears every session', () => {
		const store = createSessionStore();
		const id = created(store.create());
		store.clear();
		expect(store.size).toBe(0);
		expect(store.get(id)).toBeUndefined();
	});

	it('validates its limits', () => {
		expect(DEFAULT_MAX_SESSIONS).toBe(1000);
		expect(() => createSessionStore({ maxSessions: 0 })).toThrow('maxSessions');
		expect(() => createSessionStore({ idleTimeoutMs: 0 })).toThrow('sessionIdleTimeoutMs');
		expect(() => createSessionStore({ idleTimeoutMs: Number.NaN })).toThrow('sessionIdleTimeoutMs');
	});
});
