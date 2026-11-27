/**
 * `spec/vectors/human-relay.json`: the relay's pending list (`spec/command-metadata.md`, "The
 * pending list"). Rust implements it. TypeScript does not yet: the file lists TypeScript in its
 * `gaps`, and the cases are skipped here as that documented gap until #2722 implements
 * `HumanRelay.pendingList` and leaves the list.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/human-relay.json', import.meta.url), 'utf8')
) as { gaps: Record<string, string>; pending: unknown[]; invalid: unknown[] };

describe('human-relay.json', () => {
	it('lists TypeScript as a documented gap', () => {
		expect(vectors.gaps.typescript).toBe('https://github.com/lushly-dev/afd/issues/2722');
		// When TypeScript implements pendingList, it leaves `gaps` and runs the cases instead.
		expect(vectors.pending.length).toBeGreaterThan(0);
		expect(vectors.invalid.length).toBeGreaterThan(0);
	});
});
