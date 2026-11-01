import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wrapError } from './errors.js';
import type { JournalRecord } from './journal.js';
import { IndexedDbJournalError, IndexedDbJournalSink } from './journal-indexeddb.js';

function record(command: string, data: unknown = command): JournalRecord {
	return {
		timestamp: '2026-01-01T00:00:00.000Z',
		command,
		input: { command },
		contextDigest: { hash: 'sha256:00' },
		result: { success: true, data },
		durationMs: 0,
	};
}

/**
 * The Web Locks API for one origin, with `ifAvailable` and `steal`: enough for the writer lock.
 * Each sink stands for a context (a tab) that shares the origin's locks.
 */
function createLocks() {
	/** For each held lock, a function that breaks it (as `steal` does). */
	const held = new Map<string, () => void>();
	const locks = {
		async request(
			name: string,
			options: LockOptions,
			callback: (lock: Lock | null) => unknown
		): Promise<unknown> {
			if (held.has(name) && !options.steal) {
				if (options.ifAvailable) return callback(null);
				throw new Error('the fake only grants available locks');
			}
			held.get(name)?.();
			let breakLock: () => void = () => {};
			const broken = new Promise<never>((_, reject) => {
				breakLock = () => reject(new DOMException('Lock broken by steal', 'AbortError'));
			});
			held.set(name, breakLock);
			try {
				return await Promise.race([callback({ name, mode: 'exclusive' } as Lock), broken]);
			} finally {
				if (held.get(name) === breakLock) held.delete(name);
			}
		},
	};
	return { locks: locks as unknown as LockManager, held };
}

/** Let pending lock callbacks and releases run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function sinkFor(factory: IDBFactory, locks: LockManager, name = 'journal') {
	return new IndexedDbJournalSink({ name, indexedDB: factory, locks });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('IndexedDbJournalSink', () => {
	it('assigns seq from 1 and reads entries back in order', async () => {
		const sink = sinkFor(new IDBFactory(), createLocks().locks);
		const a = await sink.append(record('a'));
		const b = await sink.append(record('b'));

		expect([a.seq, b.seq]).toEqual([1, 2]);
		expect((await sink.read()).map((entry) => [entry.seq, entry.command])).toEqual([
			[1, 'a'],
			[2, 'b'],
		]);
	});

	it('keeps concurrent appends in order', async () => {
		const sink = sinkFor(new IDBFactory(), createLocks().locks);
		const names = Array.from({ length: 20 }, (_, i) => `c${i}`);
		const stored = await Promise.all(names.map((name) => sink.append(record(name))));

		expect(stored.map((entry) => entry.seq)).toEqual(names.map((_, i) => i + 1));
		expect((await sink.read()).map((entry) => entry.command)).toEqual(names);
	});

	it('continues an existing journal and reads inclusive ranges', async () => {
		const factory = new IDBFactory();
		const { locks } = createLocks();
		const first = sinkFor(factory, locks);
		await first.append(record('a'));
		await first.close();

		const reopened = sinkFor(factory, locks);
		expect((await reopened.append(record('b'))).seq).toBe(2);
		await reopened.append(record('c'));
		await reopened.append(record('d'));

		const commands = async (range: Parameters<typeof reopened.read>[0]) =>
			(await reopened.read(range)).map((entry) => entry.command);
		expect(await commands({ from: 2, to: 3 })).toEqual(['b', 'c']);
		expect(await commands({ from: 3 })).toEqual(['c', 'd']);
		expect(await commands({ to: 1 })).toEqual(['a']);
		expect(await commands({ from: 1.5, to: 2.5 })).toEqual(['b']);
		expect(await commands({ from: 3, to: 2 })).toEqual([]);
		expect(await commands({ from: Number.NaN })).toEqual([]);
		expect(await commands({ from: 9 })).toEqual([]);
	});

	it('stores entries as JSON values, as the file sink writes them', async () => {
		const sink = sinkFor(new IDBFactory(), createLocks().locks);
		await sink.append(record('dated', { at: new Date(0), skipped: undefined }));

		expect((await sink.read())[0]?.result).toEqual({
			success: true,
			data: { at: '1970-01-01T00:00:00.000Z' },
		});
	});

	it('takes the <name>:writer lock before its first append and holds it until close', async () => {
		const { locks, held } = createLocks();
		const sink = sinkFor(new IDBFactory(), locks, 'app-journal');
		expect(sink.lockName).toBe('app-journal:writer');

		await sink.read();
		expect(held.has('app-journal:writer')).toBe(false);
		await sink.append(record('a'));
		expect(held.has('app-journal:writer')).toBe(true);

		await sink.close();
		await tick();
		expect(held.has('app-journal:writer')).toBe(false);
	});

	it('refuses append with JOURNAL_LOCKED while another context holds the lock', async () => {
		const factory = new IDBFactory();
		const { locks } = createLocks();
		const firstTab = sinkFor(factory, locks);
		const secondTab = sinkFor(factory, locks);
		await firstTab.append(record('a'));

		const refused = secondTab.append(record('b'));
		await expect(refused).rejects.toBeInstanceOf(IndexedDbJournalError);
		await expect(refused).rejects.toMatchObject({
			code: 'JOURNAL_LOCKED',
			suggestion: expect.stringContaining('Close the other tab'),
			retryable: false,
		});
		await expect(secondTab.lock()).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' });
		// The refusal wrote nothing, and reading needs no lock.
		expect((await secondTab.read()).map((entry) => entry.command)).toEqual(['a']);

		// wrapError keeps the code and the suggestion, for a CommandError.
		const wrapped = wrapError(await refused.catch((error: unknown) => error));
		expect(wrapped).toMatchObject({ code: 'JOURNAL_LOCKED', retryable: false });
		expect(wrapped.suggestion).toContain('Close the other tab');

		// Once the first context closes, the second can take over and continues the numbering.
		await firstTab.close();
		await tick();
		expect((await secondTab.append(record('b'))).seq).toBe(2);
	});

	it('lets lock() be called first, and gives the same answer to concurrent calls', async () => {
		const { locks } = createLocks();
		const sink = sinkFor(new IDBFactory(), locks);
		await Promise.all([sink.lock(), sink.lock(), sink.append(record('a'))]);
		await expect(sink.lock()).resolves.toBeUndefined();
	});

	it('asks for the lock again after another context steals it', async () => {
		const factory = new IDBFactory();
		const { locks } = createLocks();
		const sink = sinkFor(factory, locks);
		await sink.append(record('a'));

		await locks.request(sink.lockName, { steal: true }, async () => {
			await tick();
			await expect(sink.append(record('b'))).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' });
		});
		await tick();
		expect((await sink.append(record('c'))).seq).toBe(2);
	});

	it('uses the Web Locks API of the runtime when it has one', async () => {
		const runtimeLocks = globalThis.navigator?.locks;
		if (!runtimeLocks) return; // Node.js before the Web Locks API
		const factory = new IDBFactory();
		const name = `runtime-${crypto.randomUUID()}`;
		const first = new IndexedDbJournalSink({ name, indexedDB: factory });
		const second = new IndexedDbJournalSink({ name, indexedDB: factory });

		await first.append(record('a'));
		await expect(second.append(record('b'))).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' });
		await first.close();
		await expect(second.lock()).resolves.toBeUndefined();
		await second.close();
	});

	it('refuses to write without a Web Locks API', async () => {
		vi.stubGlobal('navigator', {});
		const sink = new IndexedDbJournalSink({ name: 'no-locks', indexedDB: new IDBFactory() });

		await expect(sink.append(record('a'))).rejects.toMatchObject({
			code: 'JOURNAL_LOCK_UNAVAILABLE',
			suggestion: expect.stringContaining('secure context'),
		});
		expect(await sink.read()).toEqual([]);
	});

	it('reports a missing IndexedDB and a database it did not create', async () => {
		expect(globalThis.indexedDB).toBeUndefined();
		const nowhere = new IndexedDbJournalSink({ name: 'nowhere', locks: createLocks().locks });
		await expect(nowhere.read()).rejects.toMatchObject({ code: 'JOURNAL_STORAGE_UNAVAILABLE' });

		const factory = new IDBFactory();
		await new Promise<void>((resolve, reject) => {
			const request = factory.open('foreign', 1);
			request.onsuccess = () => {
				request.result.close();
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
		const foreign = sinkFor(factory, createLocks().locks, 'foreign');
		await expect(foreign.append(record('a'))).rejects.toMatchObject({
			code: 'JOURNAL_STORAGE_ERROR',
			message: expect.stringContaining('not created by IndexedDbJournalSink'),
		});
		await expect(foreign.read()).rejects.toMatchObject({ code: 'JOURNAL_STORAGE_ERROR' });
	});

	it('closes its connection when another one deletes the database', async () => {
		const factory = new IDBFactory();
		const sink = sinkFor(factory, createLocks().locks);
		await sink.append(record('a'));

		await new Promise<void>((resolve, reject) => {
			const request = factory.deleteDatabase('journal');
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});

		expect(await sink.read()).toEqual([]);
		expect((await sink.append(record('b'))).seq).toBe(1);
	});

	it('needs a database name', () => {
		expect(() => new IndexedDbJournalSink({ name: '' })).toThrow(/nonempty database name/);
	});
});
