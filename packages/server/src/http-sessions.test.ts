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

describe('createSessionStore', () => {
	it('creates unguessable sessions that each own a context stack', () => {
		const store = createSessionStore();
		const a = store.create();
		const b = store.create();
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
		const active = store.create();
		const idle = store.create();
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
		const first = store.create();
		const second = store.create();
		expect(store.get(first)).toBeDefined();
		const third = store.create();
		expect(store.size).toBe(2);
		expect(store.get(second)).toBeUndefined();
		expect(store.get(first)).toBeDefined();
		expect(store.get(third)).toBeDefined();
	});

	it('clears every session', () => {
		const store = createSessionStore();
		const id = store.create();
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
