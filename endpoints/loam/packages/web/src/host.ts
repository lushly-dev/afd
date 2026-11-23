/**
 * @fileoverview The browser host's kernel (phase 0 specification, 6.6): IndexedDB stores, the
 * journal's writer lock, the Mock adapter and `matchMedia` as the environment. A second tab whose
 * writer lock is refused gets no kernel, so the page can show "Loam is open in another tab".
 */

import { type AuthAdapter, MockAuthAdapter } from '@lushly-dev/afd-auth';
import {
	IndexedDbJournalError,
	IndexedDbJournalSink,
	type IndexedDbJournalSinkOptions,
} from '@lushly-dev/afd-core/journal-indexeddb';
import {
	createKernelParts,
	type KernelEnvironmentV0,
	type KernelOptionsV5,
	type KernelParts,
	type LoamKernelV5,
} from '@lushly-dev/loam-kernel';

import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';

/** The databases the browser host owns (6.4, 6.6). */
export const STORE_NAME = 'loam-store';
export const JOURNAL_NAME = 'loam-journal';

export const OTHER_TAB_NOTICE = {
	heading: 'Loam is open in another tab',
	message:
		'Loam keeps one journal per browser profile. Use the other tab, or close it and this tab will open.',
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
	/**
	 * How long to keep asking for a writer lock that is held, in milliseconds, before deciding
	 * another tab has it. A reload's previous document can still hold it for a moment while it
	 * unloads. Default 1,000.
	 */
	lockPatienceMs?: number;
	/**
	 * What `readBoot` read of `deployment.json`, and what stage B reads: the kernel resolves after stage
	 * A, the same for every deployment (phase 2 specification, 2.2).
	 */
	boot?: KernelOptionsV5['boot'];
	appsLoader?: KernelOptionsV5['appsLoader'];
	/** The URL's project, by slug, or `null` for workspace level (phase 2 specification, 6.3). */
	initialScope?: KernelOptionsV5['initialScope'];
	/**
	 * A `provider` deployment's adapter, membership and ports, from the probe (phase 3 specification, 4.2). Absent:
	 * `local`, with a Mock per page.
	 */
	auth?: AuthAdapter;
	membership?: KernelOptionsV5['membership'];
	identityPorts?: KernelOptionsV5['identityPorts'];
	/** The deployment's copilot providers and the host's runner (phase 5 specification, 3.2 and 4.1). */
	copilot?: KernelOptionsV5['copilot'];
	/** What the shell answers for `popover-open`'s anchors once it renders (phase 4 specification, 6.3). */
	overlayAnchors?: KernelOptionsV5['overlayAnchors'];
}

const LOCK_RETRY_MS = 100;

export type HostKernel =
	| {
			kind: 'ready';
			kernel: LoamKernelV5;
			journal: IndexedDbJournalSink;
			/** What the desktop's inbound dispatcher reads (phase 6 specification, 10.8). */
			inboundCommands: KernelParts['inboundCommands'];
	  }
	| {
			kind: 'locked';
			error: IndexedDbJournalError;
			/**
			 * Keep a blocking Web Lock request until the writer lock is free, then try again to open the host kernel
			 * (#1634). Resolves to `'ready'`, or `'locked'` again if another tab won the race.
			 */
			waitForLock(signal?: AbortSignal): Promise<HostKernel>;
	  };

/** Take the journal's writer lock, then create the kernel over the IndexedDB stores. */
export async function createHostKernel(options: HostKernelOptions): Promise<HostKernel> {
	const locks = options.locks ?? globalThis.navigator?.locks;
	const journal = new IndexedDbJournalSink({
		name: JOURNAL_NAME,
		...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
		...(options.locks ? { locks: options.locks } : {}),
	});
	const deadline = Date.now() + (options.lockPatienceMs ?? 1_000);
	for (;;) {
		try {
			await journal.lock();
			break;
		} catch (error) {
			if (!(error instanceof IndexedDbJournalError) || error.code !== 'JOURNAL_LOCKED') throw error;
			if (Date.now() >= deadline) {
				await journal.close();
				return {
					kind: 'locked',
					error,
					async waitForLock(signal?: AbortSignal): Promise<HostKernel> {
						const checkAborted = (): void => {
							if (signal?.aborted) {
								throw signal.reason ?? new DOMException('Aborted', 'AbortError');
							}
						};
						checkAborted();
						if (locks) {
							if (signal) await locks.request(journal.lockName, { signal }, () => undefined);
							else await locks.request(journal.lockName, () => undefined);
						}
						checkAborted();
						const next = await createHostKernel(options);
						if (signal?.aborted) {
							if (next.kind === 'ready') await next.journal.close();
							throw signal.reason ?? new DOMException('Aborted', 'AbortError');
						}
						return next;
					},
				};
			}
			await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
		}
	}
	const { kernel, inboundCommands } = await createKernelParts({
		store: new IndexedDbAdapter({
			name: STORE_NAME,
			...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
		}),
		storeKind: 'indexeddb',
		journal,
		auth: options.auth ?? new MockAuthAdapter(),
		...(options.membership ? { membership: options.membership } : {}),
		...(options.identityPorts ? { identityPorts: options.identityPorts } : {}),
		environment: options.environment,
		host: 'browser',
		// With `boot`, stage B, the late commands and the apps, runs after the first frame (2.2).
		...(options.boot ? { boot: options.boot } : {}),
		...(options.appsLoader ? { appsLoader: options.appsLoader } : {}),
		...(options.initialScope ? { initialScope: options.initialScope } : {}),
		...(options.copilot ? { copilot: options.copilot } : {}),
		...(options.overlayAnchors ? { overlayAnchors: options.overlayAnchors } : {}),
	});
	return { kind: 'ready', kernel, journal, inboundCommands };
}
