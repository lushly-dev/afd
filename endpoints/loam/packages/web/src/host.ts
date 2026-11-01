/**
 * @fileoverview The browser host's kernel (phase 0 specification, 6.6): IndexedDB stores, the
 * journal's writer lock, the Mock adapter and `matchMedia` as the environment. A second tab whose
 * writer lock is refused gets no kernel, so the page can show "Loam is open in another tab".
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import {
	IndexedDbJournalError,
	IndexedDbJournalSink,
	type IndexedDbJournalSinkOptions,
} from '@lushly-dev/afd-core/journal-indexeddb';
import { createKernel, type KernelEnvironmentV0, type LoamKernelV0 } from '@lushly-dev/loam-kernel';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';

/** The databases the browser host owns (6.4, 6.6). */
export const STORE_NAME = 'loam-store';
export const JOURNAL_NAME = 'loam-journal';

export const OTHER_TAB_NOTICE = {
	heading: 'Loam is open in another tab',
	message:
		'Loam keeps one journal per browser profile. Use the other tab, or close it and reload this one.',
} as const;

/** `window.matchMedia` as the kernel's environment. */
export function mediaEnvironment(view: Pick<Window, 'matchMedia'>): KernelEnvironmentV0 {
	return {
		matches: (query) => view.matchMedia(query).matches,
		onChange(query, listener) {
			const list = view.matchMedia(query);
			list.addEventListener('change', listener);
			return () => list.removeEventListener('change', listener);
		},
	};
}

export interface HostKernelOptions {
	environment: KernelEnvironmentV0;
	/** Passed to the IndexedDB classes, for tests over `fake-indexeddb`. */
	indexedDB?: IDBFactory;
	/** The Web Locks API, for tests; the platform's by default. */
	locks?: IndexedDbJournalSinkOptions['locks'];
}

export type HostKernel =
	| { kind: 'ready'; kernel: LoamKernelV0; journal: IndexedDbJournalSink }
	| { kind: 'locked'; error: IndexedDbJournalError };

/** Take the journal's writer lock, then create the kernel over the IndexedDB stores. */
export async function createHostKernel(options: HostKernelOptions): Promise<HostKernel> {
	const journal = new IndexedDbJournalSink({
		name: JOURNAL_NAME,
		...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
		...(options.locks ? { locks: options.locks } : {}),
	});
	try {
		await journal.lock();
	} catch (error) {
		if (error instanceof IndexedDbJournalError && error.code === 'JOURNAL_LOCKED') {
			await journal.close();
			return { kind: 'locked', error };
		}
		throw error;
	}
	const kernel = await createKernel({
		store: new IndexedDbAdapter({
			name: STORE_NAME,
			...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
		}),
		storeKind: 'indexeddb',
		journal,
		auth: new MockAuthAdapter(),
		environment: options.environment,
		host: 'browser',
	});
	return { kind: 'ready', kernel, journal };
}
