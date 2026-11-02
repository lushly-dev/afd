/**
 * E10's conformance (phase 0 specification, 6.6): local-db's adapter contract against Chromium's
 * real IndexedDB, in Vitest's browser mode.
 */
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
import { runDataAdapterContract } from '@lushly-dev/local-db/testing';

let database = 0;
runDataAdapterContract('IndexedDbAdapter (Chromium)', () => {
	database += 1;
	return new IndexedDbAdapter({ name: `loam-conformance-${Date.now()}-${database}` });
});
