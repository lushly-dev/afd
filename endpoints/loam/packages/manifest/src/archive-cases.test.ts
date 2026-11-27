/**
 * The archive cases' SHA-256s (phase 5 no-terminal amendment, 4.4's archive rules; step 9a2): `scripts/archive-cases.mjs`
 * builds each case from its description apart from `@lushly-dev/loam-cli`'s builder, and each must build to the bytes
 * it records, so the description, both builders and loam-desktop's Rust inspect (9c) stay one.
 */

import { describe, expect, it } from 'vitest';
import { caseDigests } from '../scripts/archive-cases.mjs';

describe("the archive cases' bytes", () => {
	it('build to the SHA-256 each records, by the builder apart from the CLI', () => {
		const digests = caseDigests();
		expect(digests.length).toBeGreaterThan(90);
		for (const { name, recorded, built } of digests) expect(built, name).toBe(recorded);
	});
});
