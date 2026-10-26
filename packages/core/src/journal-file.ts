/**
 * @fileoverview A journal sink that appends JSON Lines to a file.
 *
 * Node.js only: import it from `@lushly-dev/afd-core/journal-file`. The root entry stays
 * browser-safe.
 */

import { appendFile, mkdir, readFile, truncate } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	type JournalEntry,
	type JournalRange,
	type JournalRecord,
	type JournalSink,
	parseJournal,
	selectJournalRange,
	serializeJournalEntry,
} from './journal.js';

function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * A {@link JournalSink} that appends one JSON line per entry to `path`.
 *
 * The file and its directory are created on the first append. An existing file is continued:
 * the next `seq` follows its last entry. Appends from one sink are written in order; do not
 * point two sinks (or two processes) at the same file.
 *
 * A last line without a newline is a write that did not finish (a crash mid-append). Reads skip
 * it when it is not a complete entry, and the first append removes it before writing; a
 * complete entry that only lacks its newline is kept and the newline is added. The first append
 * reads the whole existing file once, to find the last `seq`.
 *
 * @example
 * ```typescript
 * import { FileJournalSink } from '@lushly-dev/afd-core/journal-file';
 *
 * const sink = new FileJournalSink('./journal.jsonl');
 * const server = createMcpServer({ commands, middleware: [createJournalMiddleware(sink)] });
 * ```
 */
export class FileJournalSink implements JournalSink {
	/** The last `seq` written, once the existing file has been read. */
	private lastSeq: number | undefined;
	/** Serializes appends so lines and `seq` values stay in order. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(readonly path: string) {}

	append(record: JournalRecord): Promise<JournalEntry> {
		const write = this.queue.then(async () => {
			let prefix = '';
			if (this.lastSeq === undefined) {
				const existing = await this.readFile();
				this.lastSeq = existing.entries[existing.entries.length - 1]?.seq ?? 0;
				if (existing.tornAt !== undefined) await truncate(this.path, existing.tornAt);
				else if (existing.unterminated) prefix = '\n';
				await mkdir(dirname(this.path), { recursive: true });
			}
			const entry: JournalEntry = { seq: this.lastSeq + 1, ...record };
			await appendFile(this.path, `${prefix}${serializeJournalEntry(entry)}\n`, 'utf8');
			this.lastSeq = entry.seq;
			return entry;
		});
		// A failed append must not block the ones after it.
		this.queue = write.catch(() => {});
		return write;
	}

	async read(range?: JournalRange): Promise<JournalEntry[]> {
		// Wait for pending appends so a read sees every entry appended before it.
		await this.queue;
		return selectJournalRange(await this.readAll(), range);
	}

	private async readAll(): Promise<JournalEntry[]> {
		return (await this.readFile()).entries;
	}

	/**
	 * The entries in `seq` order. `unterminated` when the file does not end in a newline;
	 * `tornAt` (a byte offset) when that last line is also not a complete entry.
	 */
	private async readFile(): Promise<{
		entries: JournalEntry[];
		unterminated: boolean;
		tornAt?: number;
	}> {
		let text: string;
		try {
			text = await readFile(this.path, 'utf8');
		} catch (error) {
			if (isMissingFile(error)) return { entries: [], unterminated: false };
			throw error;
		}
		const cut = text.lastIndexOf('\n') + 1;
		const tail = text.slice(cut);
		const entries = parseJournal(text.slice(0, cut));
		let tornAt: number | undefined;
		if (tail.trim() !== '') {
			try {
				entries.push(...parseJournal(tail));
			} catch {
				tornAt = Buffer.byteLength(text.slice(0, cut), 'utf8');
			}
		}
		return {
			entries: entries.sort((a, b) => a.seq - b.seq),
			unterminated: tail !== '',
			...(tornAt !== undefined ? { tornAt } : {}),
		};
	}
}
