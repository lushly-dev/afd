/**
 * @fileoverview Scripted sessions for the test kit: a fixed environment, a stepping clock, a
 * seeded random source, `recordSession` and the 50-call session of E2.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { MemoryAdapter } from '@lushly-dev/local-db';
import type { AppearanceV0 } from './appearance.js';
import { createKernelParts, type KernelInterfaceV0 } from './kernel.js';
import type { LayoutStateV0 } from './layout.js';
import type { KernelEnvironmentV0, KernelOptionsV0, LoamKernelV0 } from './types.js';

// ─── Environment ────────────────────────────────────────────────────────────────

/** An environment whose media queries match exactly the ones given, and never change. */
export function createFixedEnvironment(matching: readonly string[] = []): KernelEnvironmentV0 {
	const set = new Set(matching);
	return {
		matches: (query) => set.has(query),
		onChange: () => () => {},
	};
}

// ─── Sessions ───────────────────────────────────────────────────────────────────

/** One scripted call: the interface it runs on, the command and its input. */
export interface SessionCall {
	interface: KernelInterfaceV0;
	name: string;
	input?: unknown;
}

export interface RecordSessionOptions {
	environment?: KernelEnvironmentV0;
	commands?: ZodCommandDefinition[];
	/** First clock reading, in epoch milliseconds. Default: 2026-01-01T00:00:00Z. */
	start?: number;
	/** Random seed. Default: `'loam'`. */
	seed?: string;
}

export interface RecordedSession {
	entries: JournalEntry[];
	layout: LayoutStateV0;
	appearance: AppearanceV0;
}

const SESSION_START = Date.UTC(2026, 0, 1);

/** A clock that advances one millisecond per reading, from `start`. */
export function createSteppingClock(start = SESSION_START): () => number {
	let now = start;
	return () => now++;
}

/** A seeded pseudo-random source (mulberry32 over a string hash), in [0, 1). */
export function createSeededRandom(seed: string): () => number {
	let state = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		state ^= seed.charCodeAt(i);
		state = Math.imul(state, 16777619);
	}
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Run `calls` in order on a fresh test kernel (`MemoryAdapter`, `MemoryJournalSink`,
 * `MockAuthAdapter`, a stepping clock and a seeded random source) and return its journal and
 * final state.
 */
export async function recordSession(
	calls: readonly SessionCall[],
	options: RecordSessionOptions = {}
): Promise<RecordedSession> {
	const journal = new MemoryJournalSink();
	const kernelOptions: KernelOptionsV0 = {
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: options.environment ?? createFixedEnvironment(),
		host: 'test',
		clock: createSteppingClock(options.start),
		random: createSeededRandom(options.seed ?? 'loam'),
		...(options.commands !== undefined ? { commands: options.commands } : {}),
	};
	const { kernel } = await createKernelParts(kernelOptions);
	try {
		await runSession(kernel, calls);
		// Read before the final reads, which are journaled too.
		const entries = await journal.read();
		const layout = await kernel.call<LayoutStateV0>('layout-get');
		const appearance = await kernel.call<AppearanceV0>('appearance-get');
		return {
			entries,
			layout: layout.data as LayoutStateV0,
			appearance: appearance.data as AppearanceV0,
		};
	} finally {
		await kernel.dispose();
	}
}

/** Run `calls` in order on `kernel`, each on its interface. */
export async function runSession(
	kernel: LoamKernelV0,
	calls: readonly SessionCall[]
): Promise<void> {
	for (const call of calls) {
		const target = call.interface === 'agent' ? kernel.agent : kernel;
		await target.call(call.name, call.input ?? {});
	}
}

const agent = (name: string, input: unknown = {}): SessionCall => ({
	interface: 'agent',
	name,
	input,
});
const palette = (name: string, input: unknown = {}): SessionCall => ({
	interface: 'palette',
	name,
	input,
});

/**
 * The scripted session of E2: 50 calls, every one journaled, through both interfaces. It covers
 * every layout field, refusals by the shared validator through `layout-set` and `view-state-set`,
 * `layout-reset`, appearance, the palette, `shell-info-get` and a Mock sign-in and sign-out.
 * Step 7 records it live in Chromium and compares it with a replay of the committed fixture.
 */
export const SESSION_50: readonly SessionCall[] = Object.freeze([
	palette('shell-info-get'),
	palette('layout-get'),
	palette('appearance-get'),
	palette('auth-session-get'),
	palette('auth-sign-in', { method: 'credentials', email: 'person@example.com' }),
	palette('layout-set', { sidebar: { width: 320 } }),
	palette('layout-set', { inspector: { open: true } }),
	palette('layout-set', { inspector: { width: 400 } }),
	palette('layout-set', { panel: { open: true } }),
	palette('layout-set', { panel: { height: 300 } }),
	palette('layout-set', { panel: { maximized: true } }),
	palette('layout-set', { panel: { maximized: false } }),
	palette('layout-set', { sidebar: { width: 900 } }),
	palette('layout-set', { inspector: { width: 100 } }),
	palette('layout-set', { panel: { height: 80 } }),
	palette('palette-open'),
	palette('palette-close'),
	palette('palette-open', { query: 'layout' }),
	palette('palette-close'),
	palette('appearance-set', { theme: 'dark' }),
	palette('appearance-set', { density: 'compact' }),
	palette('appearance-get'),
	agent('layout-get'),
	agent('view-state-get', { id: 'loam.layout' }),
	agent('view-state-set', { id: 'loam.layout', state: { sidebar: { open: false } } }),
	agent('view-state-set', { id: 'loam.layout', state: { sidebar: { width: 1000 } } }),
	agent('view-state-set', { id: 'loam.layout', state: { inspector: { width: 260 } } }),
	agent('view-state-list'),
	agent('layout-set', { compact: { drawer: 'sidebar' } }),
	agent('layout-set', { compact: { drawer: 'inspector' } }),
	agent('layout-set', { compact: { sheet: true } }),
	agent('layout-set', { compact: { drawer: null, sheet: false } }),
	agent('appearance-set', { theme: 'high-contrast' }),
	agent('view-state-set', { id: 'loam.appearance', state: { theme: 'sepia' } }),
	agent('view-state-set', { id: 'loam.appearance', state: { theme: 'light' } }),
	agent('shell-info-get'),
	palette('layout-set', { sidebar: { open: true, width: 480 } }),
	palette('layout-set', { sidebar: { width: 200 } }),
	palette('layout-set', { inspector: { open: false } }),
	palette('layout-reset'),
	palette('layout-get'),
	palette('layout-set', { panel: { open: true, height: 120 } }),
	palette('layout-set', { sidebar: { width: 260.5 } }),
	palette('appearance-set', { theme: 'system', density: 'comfortable' }),
	palette('auth-session-get'),
	palette('auth-sign-out'),
	palette('auth-session-get'),
	agent('view-state-set', {
		id: 'loam.layout',
		state: {
			version: 0,
			sidebar: { open: true, width: 300 },
			inspector: { open: true, width: 520 },
			panel: { open: false, height: 240, maximized: false },
			compact: { drawer: null, sheet: false },
		},
		replace: true,
	}),
	agent('layout-get'),
	palette('appearance-get'),
] satisfies SessionCall[]);
