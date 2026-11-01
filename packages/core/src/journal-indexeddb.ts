/// <reference lib="dom" preserve="true" />
/**
 * @fileoverview A journal sink over IndexedDB, the browser counterpart of `journal-file`.
 *
 * Import it from `@lushly-dev/afd-core/journal-indexeddb`. The root entry does not load it.
 */

import {
	type JournalEntry,
	type JournalRange,
	type JournalRecord,
	type JournalSink,
	serializeJournalEntry,
} from './journal.js';

/** Options for {@link IndexedDbJournalSink}. */
export interface IndexedDbJournalSinkOptions {
	/** The database name. The writer lock is `<name>:writer`. */
	name: string;
	/** The factory to open the database with. Default: `globalThis.indexedDB`. */
	indexedDB?: IDBFactory;
	/** The Web Locks API to take the writer lock with. Default: `globalThis.navigator.locks`. */
	locks?: LockManager;
}

/** Codes of {@link IndexedDbJournalError}. */
export type IndexedDbJournalErrorCode =
	| 'JOURNAL_LOCKED'
	| 'JOURNAL_LOCK_UNAVAILABLE'
	| 'JOURNAL_STORAGE_UNAVAILABLE'
	| 'JOURNAL_STORAGE_ERROR';

/**
 * Why an {@link IndexedDbJournalSink} call failed. It carries `code`, `suggestion` and
 * `retryable`, so `wrapError()` turns it into a `CommandError` with the same fields.
 *
 * - `JOURNAL_LOCKED`: another context (a tab, a worker) holds the writer lock.
 * - `JOURNAL_LOCK_UNAVAILABLE`: there is no Web Locks API, so the sink cannot keep to one writer.
 * - `JOURNAL_STORAGE_UNAVAILABLE`: there is no IndexedDB.
 * - `JOURNAL_STORAGE_ERROR`: IndexedDB failed, or the database was not created by this sink.
 */
export class IndexedDbJournalError extends Error {
	readonly code: IndexedDbJournalErrorCode;
	readonly suggestion: string;
	readonly retryable: boolean;

	constructor(
		code: IndexedDbJournalErrorCode,
		message: string,
		suggestion: string,
		retryable = false
	) {
		super(message);
		this.name = 'IndexedDbJournalError';
		this.code = code;
		this.suggestion = suggestion;
		this.retryable = retryable;
	}
}

const DB_VERSION = 1;
const STORE = 'entries';

function storageError(error: unknown, action: string): IndexedDbJournalError {
	if (error instanceof IndexedDbJournalError) return error;
	const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return new IndexedDbJournalError(
		'JOURNAL_STORAGE_ERROR',
		`IndexedDB failed to ${action}: ${reason}`,
		'Check the browser storage quota and that the database is not in use by an incompatible program, then retry.',
		true
	);
}

function settle<T>(request: IDBRequest<T>, action: string): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(storageError(request.error, action));
	});
}

/**
 * A {@link JournalSink} over IndexedDB, for browsers, web workers and webviews.
 *
 * The sink owns its database, `name`: one object store, `entries`, keyed by `seq`. Entries are
 * stored as JSON values, as `FileJournalSink` writes them. An existing journal is continued:
 * the next `seq` follows its last entry.
 *
 * **One writer.** As `FileJournalSink` takes one process per file, this sink takes one context
 * per database: before its first `append` it takes the Web Lock `<name>:writer` and holds it
 * until {@link close}. When another context (another tab, say) holds the lock, `append` and
 * {@link lock} reject with `JOURNAL_LOCKED` instead of waiting. Call `lock()` first to find out
 * before any command runs. Reads never need the lock.
 *
 * @example
 * ```typescript
 * import { IndexedDbJournalSink } from '@lushly-dev/afd-core/journal-indexeddb';
 *
 * const sink = new IndexedDbJournalSink({ name: 'my-app-journal' });
 * await sink.lock(); // rejects with code JOURNAL_LOCKED when the app is open in another tab
 * const registry = createDirectRegistry({ commands, middleware: [createJournalMiddleware(sink)] });
 * ```
 */
export class IndexedDbJournalSink implements JournalSink {
	/** The database name. */
	readonly name: string;
	/** The Web Lock this sink holds while it writes: `<name>:writer`. */
	readonly lockName: string;
	private readonly factory: IDBFactory | undefined;
	private readonly locks: LockManager | undefined;
	private connection: Promise<IDBDatabase> | undefined;
	/** Resolves once the writer lock is held; unset when it is not held or being requested. */
	private held: Promise<void> | undefined;
	/** Releases the writer lock. */
	private release: (() => void) | undefined;

	constructor(options: IndexedDbJournalSinkOptions) {
		if (typeof options?.name !== 'string' || options.name === '') {
			throw new TypeError('IndexedDbJournalSink needs a nonempty database name');
		}
		this.name = options.name;
		this.lockName = `${options.name}:writer`;
		this.factory = options.indexedDB;
		this.locks = options.locks ?? globalThis.navigator?.locks;
	}

	/**
	 * Take the writer lock now, if this sink does not hold it yet. Resolves once it is held;
	 * rejects with `JOURNAL_LOCKED` when another context holds it, and with
	 * `JOURNAL_LOCK_UNAVAILABLE` when there is no Web Locks API. A refused call can be retried.
	 */
	lock(): Promise<void> {
		if (this.held) return this.held;
		const locks = this.locks;
		if (!locks) {
			return Promise.reject(
				new IndexedDbJournalError(
					'JOURNAL_LOCK_UNAVAILABLE',
					'The Web Locks API is not available, so the journal cannot keep to one writer',
					'Serve the app from a secure context (https or localhost), or pass `locks`.'
				)
			);
		}
		const held = new Promise<void>((resolve, reject) => {
			locks
				.request(this.lockName, { ifAvailable: true }, (lock) => {
					if (!lock) {
						reject(
							new IndexedDbJournalError(
								'JOURNAL_LOCKED',
								`The journal ${JSON.stringify(this.name)} is open for writing in another context (lock ${JSON.stringify(this.lockName)})`,
								'Close the other tab or window that has the app open, then reload.'
							)
						);
						return undefined;
					}
					resolve();
					return new Promise<void>((done) => {
						this.release = done;
					});
				})
				.catch(reject)
				.finally(() => {
					// Released, refused or stolen: the next append asks again.
					if (this.held === held) {
						this.held = undefined;
						this.release = undefined;
					}
				});
		});
		this.held = held;
		held.catch(() => {});
		return held;
	}

	/** Append `record` with the next `seq`. Takes the writer lock first (see {@link lock}). */
	async append(record: JournalRecord): Promise<JournalEntry> {
		await this.lock();
		const db = await this.open();
		const transaction = transact(db, 'readwrite');
		const last = await settle(transaction.store.openCursor(null, 'prev'), 'read the last entry');
		const entry: JournalEntry = { seq: ((last?.key as number | undefined) ?? 0) + 1, ...record };
		await settle(
			transaction.store.add(JSON.parse(serializeJournalEntry(entry))),
			'append an entry'
		);
		await transaction.done;
		return entry;
	}

	async read(range: JournalRange = {}): Promise<JournalEntry[]> {
		const from = range.from ?? Number.NEGATIVE_INFINITY;
		const to = range.to ?? Number.POSITIVE_INFINITY;
		if (Number.isNaN(from) || Number.isNaN(to) || from > to) return [];
		const db = await this.open();
		const transaction = transact(db, 'readonly');
		const entries = await new Promise<JournalEntry[]>((resolve, reject) => {
			const found: JournalEntry[] = [];
			const request = transaction.store.openCursor();
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) return resolve(found);
				const seq = cursor.key as number;
				if (seq < from) return cursor.continue(from);
				if (seq > to) return resolve(found);
				found.push(cursor.value as JournalEntry);
				cursor.continue();
			};
			request.onerror = () => reject(storageError(request.error, 'read entries'));
		});
		await transaction.done;
		return entries;
	}

	/** Release the writer lock and close the database. The next call opens and locks again. */
	async close(): Promise<void> {
		this.release?.();
		this.release = undefined;
		this.held = undefined;
		const connection = this.connection;
		this.connection = undefined;
		if (connection) (await connection.catch(() => undefined))?.close();
	}

	private open(): Promise<IDBDatabase> {
		if (this.connection) return this.connection;
		const factory = this.factory ?? globalThis.indexedDB;
		if (!factory) {
			return Promise.reject(
				new IndexedDbJournalError(
					'JOURNAL_STORAGE_UNAVAILABLE',
					'IndexedDB is not available here',
					'Pass `indexedDB` (for example from fake-indexeddb in Node.js), or use MemoryJournalSink or FileJournalSink.'
				)
			);
		}
		const opening = new Promise<IDBDatabase>((resolve, reject) => {
			const request = factory.open(this.name, DB_VERSION);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(STORE, { keyPath: 'seq' });
			};
			request.onsuccess = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE)) {
					db.close();
					reject(
						storageError(
							new Error(
								`database ${JSON.stringify(this.name)} was not created by IndexedDbJournalSink (it has no "${STORE}" store); use another name`
							),
							'open the journal'
						)
					);
					return;
				}
				const forget = () => {
					if (this.connection === opening) this.connection = undefined;
				};
				db.onversionchange = () => {
					db.close();
					forget();
				};
				db.onclose = forget;
				resolve(db);
			};
			request.onerror = () => reject(storageError(request.error, 'open the journal'));
		});
		this.connection = opening;
		opening.catch(() => {
			if (this.connection === opening) this.connection = undefined;
		});
		return opening;
	}
}

/** A transaction on the `entries` store, and a promise for its commit. */
function transact(
	db: IDBDatabase,
	mode: IDBTransactionMode
): { store: IDBObjectStore; done: Promise<void> } {
	let transaction: IDBTransaction;
	try {
		transaction = db.transaction(STORE, mode);
	} catch (error) {
		throw storageError(error, 'start a transaction');
	}
	const done = new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(storageError(transaction.error ?? 'aborted', 'commit'));
	});
	// A failed request rejects its own promise first; this one must not go unhandled.
	done.catch(() => {});
	return { store: transaction.objectStore(STORE), done };
}
