import { describe, expect, it } from 'vitest';
import {
	createSessionStore,
	DEFAULT_MAX_SESSIONS,
	DEFAULT_MAX_SESSIONS_PER_OWNER,
} from './http-sessions.js';

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

	it('holds one owner to its quota by evicting its own sessions, never blocking another owner', () => {
		const store = createSessionStore({ maxSessions: 4, maxSessionsPerOwner: 2 });
		const opened = Array.from({ length: 5 }, () => created(store.create('alice')));
		// Alice keeps her quota: her two newest sessions, and the store has room left.
		expect(store.size).toBe(2);
		expect(opened.slice(0, 3).map((id) => store.get(id, 'alice'))).toEqual([
			undefined,
			undefined,
			undefined,
		]);
		expect(store.get(opened[3] as string, 'alice')).toBeDefined();
		expect(store.get(opened[4] as string, 'alice')).toBeDefined();
		const bob = [created(store.create('bob')), created(store.create('bob'))];
		expect(store.size).toBe(4);
		for (const id of bob) expect(store.get(id, 'bob')).toBeDefined();
		// The store is full: Carol, who holds nothing, is refused; Alice and Bob are untouched.
		expect(store.create('carol')).toBeUndefined();
		expect(store.size).toBe(4);
	});

	it('defaults the per-owner quota to 100, or maxSessions when smaller, and never above it', () => {
		expect(DEFAULT_MAX_SESSIONS_PER_OWNER).toBe(100);
		const store = createSessionStore();
		for (let i = 0; i < 101; i++) created(store.create('alice'));
		expect(store.size).toBe(100);
		const small = createSessionStore({ maxSessions: 3 });
		for (let i = 0; i < 4; i++) created(small.create('alice'));
		expect(small.size).toBe(3);
		expect(() => createSessionStore({ maxSessions: 3, maxSessionsPerOwner: 4 })).toThrow(
			'maxSessionsPerOwner'
		);
		expect(() => createSessionStore({ maxSessionsPerOwner: 0 })).toThrow('maxSessionsPerOwner');
	});

	it('at the quota evicts the least recently used session, keeping an older one in use', () => {
		const time = clock();
		const store = createSessionStore({ maxSessions: 10, maxSessionsPerOwner: 2, now: time.now });
		const older = created(store.create('alice'));
		time.advance(1);
		const newer = created(store.create('alice'));
		time.advance(1);
		expect(store.get(older, 'alice')).toBeDefined();
		const third = created(store.create('alice'));
		expect(store.get(newer, 'alice')).toBeUndefined();
		expect(store.get(older, 'alice')).toBeDefined();
		expect(store.get(third, 'alice')).toBeDefined();
	});

	it('shares one quota across owners with the same quota key, and keeps each session to its owner', () => {
		const store = createSessionStore({ maxSessions: 10, maxSessionsPerOwner: 2 });
		const viaA = created(store.create('alice/a', 'alice'));
		created(store.create('alice/a', 'alice'));
		const viaB = created(store.create('alice/b', 'alice'));
		expect(store.size).toBe(2);
		expect(store.get(viaA, 'alice/a')).toBeUndefined();
		expect(store.get(viaB, 'alice/a')).toBeUndefined();
		expect(store.get(viaB, 'alice/b')).toBeDefined();
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
