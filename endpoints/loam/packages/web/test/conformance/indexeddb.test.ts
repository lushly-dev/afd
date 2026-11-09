/**
 * E10's conformance (phase 0 specification, 6.6): local-db's adapter contract against Chromium's
 * real IndexedDB, in Vitest's browser mode. Phase 2's E13 holds it: the describe's title starts with its row.
 */
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
import { runDataAdapterContract } from '@lushly-dev/local-db/testing';
import { describe } from 'vitest';

let database = 0;
describe('P2-E13: E10: IndexedDbAdapter in Chromium', () => {
	runDataAdapterContract('IndexedDbAdapter (Chromium)', () => {
		database += 1;
		return new IndexedDbAdapter({ name: `loam-conformance-${Date.now()}-${database}` });
	});
});
