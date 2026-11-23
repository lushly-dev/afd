/**
 * @fileoverview A person's `loam.keybindings.overrides` read into the kernel's keybindings (phase 4 specification, 8.3;
 * R5, R9), in the `late-settings` chunk beside the settings whose record it reads. Nothing of first paint is imported
 * but types: the registry reaches here through the settings' deps (phase 3 specification, 13).
 */

import type { KeybindingRegistry } from '../keybindings.js';
import { usableOverrides } from './setting-sections.js';

export interface OverridesReaderDeps {
	/** The kernel's keybindings; absent, nothing is read. */
	keybindings?: KeybindingRegistry | undefined;
	/** Whom the shell is for now. */
	person(): string | undefined;
	/** Whether the deployment's identity is `provider`, where a signed-out page has no record. */
	provider: boolean;
	/** Whether a replay runs, which schedules no retry: no key is pressed in a replay. */
	replaying(): boolean;
	/** The person's stored overrides, or undefined for none; rejects when the record cannot be read. */
	stored(person: string | undefined): Promise<unknown>;
}

export interface OverridesReader {
	/** Read the overrides of whom the shell is for now; resolves true if the kept overrides changed. */
	read(): Promise<boolean>;
	/** Read again when the person changed since the last read, even when their record is the same one (`local`). */
	follow(): Promise<void>;
	/** The kernel is disposed: the retry and any read in flight end. */
	stop(): void;
}

/** A failed read's first wait, doubling to {@link LONGEST_RETRY_MS} (R9). */
const FIRST_RETRY_MS = 500;
const LONGEST_RETRY_MS = 30_000;

/**
 * At the late load, after each write of the section and on a change of person, the adapter's own included
 * (`session-settle`). Signed out in `provider` mode, none. Entries a newer rule refuses are dropped and counted, the
 * rest kept (the re-check's 8). A read that fails keeps what the registry holds for the same person only, and is tried
 * again with backoff (R9); until it lands, the registry, which compares whom it holds them for with whom the shell is
 * for, dispatches only the focus chords.
 */
export function createOverridesReader(deps: OverridesReaderDeps): OverridesReader {
	/** Each read's number: one overtaken, or ended by a stop, sets nothing. */
	let reading = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let retryMs = FIRST_RETRY_MS;
	let stopped = false;
	/** The person the overrides were last read for. */
	let readFor: string | undefined | null = null;
	let lastJson: string | undefined;

	async function read(): Promise<boolean> {
		const registry = deps.keybindings;
		if (!registry || stopped) return false;
		const person = deps.person();
		readFor = person;
		const generation = ++reading;
		clearTimeout(retry);
		retry = undefined;
		if (deps.provider && person === undefined) {
			registry.setOverrides([], person);
			const changed = lastJson !== undefined && lastJson !== '[]';
			lastJson = '[]';
			return changed;
		}
		let value: unknown;
		try {
			value = await deps.stored(person);
		} catch {
			if (generation !== reading || deps.person() !== person) return false;
			// A replay schedules none: its keys stay not ready, and no key is pressed in a replay.
			if (!deps.replaying() && !stopped) {
				retry = setTimeout(() => void read(), retryMs);
				retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS);
			}
			return false;
		}
		if (generation !== reading || deps.person() !== person) return false;
		retryMs = FIRST_RETRY_MS;
		const { kept, dropped } = usableOverrides(value);
		registry.setOverrides(kept, person, dropped);
		const nextJson = JSON.stringify(kept);
		const changed = lastJson !== undefined && lastJson !== nextJson;
		lastJson = nextJson;
		return changed;
	}

	return {
		read,
		async follow() {
			if (deps.person() !== readFor) await read();
		},
		stop() {
			stopped = true;
			reading++;
			clearTimeout(retry);
			retry = undefined;
		},
	};
}
