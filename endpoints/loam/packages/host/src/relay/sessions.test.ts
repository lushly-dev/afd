import { afterEach, describe, expect, it, vi } from 'vitest';
import { BINDINGS_PER_PAIR, type Binding, createRelayState } from './sessions.js';

afterEach(() => {
	vi.useRealTimers();
});

function state(concurrency = 2, idleMs = 1_000) {
	let now = 0;
	const ended: string[] = [];
	const relay = createRelayState({
		concurrency,
		idleMs,
		end: async (binding: Binding) => {
			ended.push(binding.id);
		},
		clock: () => now,
	});
	return { relay, ended, tick: (ms: number) => (now += ms) };
}

describe("P6-E5: the relay's state (8.1 steps 15 to 17)", () => {
	it('P6-E5: limits: at most `relay_concurrency_per_person` slots a person, freed once each', () => {
		const { relay } = state(2);
		const one = relay.acquire('bea');
		const two = relay.acquire('bea');
		expect(relay.acquire('bea')).toBeUndefined();
		expect(relay.acquire('olu')).toBeDefined();
		one?.();
		one?.();
		expect(relay.acquire('bea')).toBeDefined();
		expect(relay.acquire('bea')).toBeUndefined();
		two?.();
	});

	it("P6-E5: unknown and foreign session ids are none; one already bound to another person can't be bound again", () => {
		const { relay } = state();
		expect(relay.bind('s1', 'bea', 'work')).toMatchObject({ id: 's1' });
		expect(relay.binding('s1', 'bea', 'work')).toBeDefined();
		expect(relay.binding('s1', 'olu', 'work')).toBeUndefined();
		expect(relay.binding('s1', 'bea', 'other')).toBeUndefined();
		expect(relay.binding('nope', 'bea', 'work')).toBeUndefined();
		expect(relay.bind('s1', 'olu', 'work')).toBe(false);
	});

	it('P6-E5: at most 4 bindings per person and instance: a fifth evicts the least recently used idle one with an upstream DELETE, and is refused when all four are busy', () => {
		const { relay, ended, tick } = state();
		const held: Binding[] = [];
		for (let index = 0; index < BINDINGS_PER_PAIR; index++) {
			const reserved = relay.reserve('bea', 'work');
			expect(reserved).toBeTypeOf('function');
			held.push(relay.bind(`s${index}`, 'bea', 'work') as Binding);
			reserved?.();
			tick(10);
		}
		// s0 is used again, so s1 is now the least recently used.
		relay.use(held[0] as Binding)();
		const fifth = relay.reserve('bea', 'work');
		expect(fifth).toBeTypeOf('function');
		expect(ended).toEqual(['s1']);
		expect(relay.binding('s1', 'bea', 'work')).toBeUndefined();
		relay.bind('s4', 'bea', 'work');
		fifth?.();
		// Every binding busy: no eviction, refused.
		const releases = ['s0', 's2', 's3', 's4'].map((id) =>
			relay.use(relay.binding(id, 'bea', 'work') as Binding)
		);
		expect(relay.reserve('bea', 'work')).toBeUndefined();
		expect(relay.reserve('olu', 'work')).toBeTypeOf('function');
		for (const release of releases) release();
	});

	it('P6-E5: a reservation holds its place until released, so concurrent `initialize`s never make a fifth binding', () => {
		const { relay } = state();
		for (let index = 0; index < 3; index++) relay.bind(`s${index}`, 'bea', 'work');
		const busy = ['s0', 's1', 's2'].map((id) =>
			relay.use(relay.binding(id, 'bea', 'work') as Binding)
		);
		const first = relay.reserve('bea', 'work');
		expect(first).toBeTypeOf('function');
		// The second takes no place while the first holds the fourth: nothing idle to evict.
		expect(relay.reserve('bea', 'work')).toBeUndefined();
		first?.();
		expect(relay.reserve('bea', 'work')).toBeTypeOf('function');
		for (const release of busy) release();
	});

	it('P6-E5: no binding is made once `close()` began', async () => {
		const { relay } = state();
		await relay.close();
		expect(relay.bind('late', 'bea', 'work')).toBe(false);
	});

	it('P6-E5: `relay_session_idle_ms`: an idle binding is DELETEd upstream; one with a request in flight is not', async () => {
		vi.useFakeTimers();
		const { relay, ended } = state(2, 1_000);
		const idle = relay.bind('idle', 'bea', 'work') as Binding;
		const busy = relay.bind('busy', 'bea', 'work') as Binding;
		void idle;
		const release = relay.use(busy);
		await vi.advanceTimersByTimeAsync(1_500);
		expect(ended).toEqual(['idle']);
		release();
		await vi.advanceTimersByTimeAsync(999);
		expect(ended).toEqual(['idle']);
		await vi.advanceTimersByTimeAsync(2);
		expect(ended).toEqual(['idle', 'busy']);
		expect(relay.size).toBe(0);
	});

	it("P6-E5: cancellation aborts only this person's in-flight request through the same binding, and nothing with no binding", () => {
		const { relay } = state();
		const controller = new AbortController();
		const land = relay.fly({ person: 'bea', instance: 'work', binding: 's1', id: 3 }, controller);
		expect(relay.cancel('olu', 'work', 's1', 3)).toBe(false);
		expect(relay.cancel('bea', 'work', 's2', 3)).toBe(false);
		expect(relay.cancel('bea', 'work', 's1', '3')).toBe(false);
		expect(relay.cancel('bea', 'work', undefined, 3)).toBe(false);
		expect(controller.signal.aborted).toBe(false);
		expect(relay.cancel('bea', 'work', 's1', 3)).toBe(true);
		expect(controller.signal.aborted).toBe(true);
		land();
		expect(relay.cancel('bea', 'work', 's1', 3)).toBe(false);
	});

	it('P6-E5: `close()` ends every binding upstream', async () => {
		const { relay, ended } = state();
		relay.bind('a', 'bea', 'work');
		relay.bind('b', 'olu', 'work');
		await relay.close();
		expect(ended.sort()).toEqual(['a', 'b']);
	});
});
