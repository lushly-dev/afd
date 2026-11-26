/**
 * @fileoverview The command palette's host for `loam-shell` (phase 0 specification, 7): the palette's
 * search, run and close, each a command, and its rows' flags from the kernel's command summaries. It loads
 * with the palette, when the page is idle, so first paint holds only the boundary (phase 2 specification,
 * 2.4). A document's row, `palette-search`'s `kind: 'document'`, opens it with `document-open`; a setting's,
 * `kind: 'setting'`, opens the settings section at its key with `section-open` (phase 4 specification, 3.10); a query that
 * starts `new` lists what New creates, as `New: <title>`, from the `new` chunk, loaded on that first query
 * (documents specification, 7 and 8.2). A query for the inbox lists "Open inbox" first, `section-open { section:
 * 'inbox' }` (phase 4 specification, 7.1 and 10.3).
 *
 * Phase 4's step 6 (its 7.1; A-P0-1): every enabled, loaded app's commands are listed, ranked by the active app, each
 * naming its app; a command that needs input runs through `palette-run`, whose prompt asks for it in the slot.
 */

import {
	type CommandSummary,
	type LoamKernel,
	type PaletteItem,
	SHELL_KEY_ACTIONS,
} from '@lushly-dev/loam-kernel';
import type { NewItemV1 } from '@lushly-dev/loam-sdk';
import type { NewHost } from '../new/new-menu.js';
import type { LoamPalette, PaletteFailure, PaletteResult } from './palette.js';

/** What the host reads of the shell. */
interface PaletteShell extends NewHost {
	readonly kernel: LoamKernel | null;
	readonly palette: LoamPalette;
}

/**
 * A row that is not a plain command: a document to open, a setting to show, what New creates, the inbox, or a command
 * that needs input, which the palette's input prompt asks for (7.1).
 */
type Row =
	| { document: string }
	| { setting: string }
	| { item: NewItemV1 }
	| { inbox: true }
	| { input: string };

/** The "Open inbox" row's name, no command's (a command's name has no colon). */
const OPEN_INBOX = 'inbox:open';

/** Whether a query asks for the inbox: a part of "Open inbox", or a word for what it holds. */
const asksInbox = (query: string): boolean => {
	const wanted = query.trim().toLowerCase();
	return wanted.length > 1 && ('open inbox'.includes(wanted) || /inbox|notif|notice/.test(wanted));
};

export class ShellPalette {
	readonly #shell: PaletteShell;
	readonly #define: () => Promise<void>;
	#palette: Promise<LoamPalette | null> | null = null;

	/** `define` is the shell's `definePalette`, so this chunk shares no module with first paint. */
	constructor(shell: PaletteShell, define: () => Promise<void>) {
		this.#shell = shell;
		this.#define = define;
	}

	/** Load and define the palette once, and give it its host. */
	prepare(): Promise<LoamPalette | null> {
		this.#palette ??= this.#define().then(() => {
			const { palette, kernel } = this.#shell;
			if (!palette || !kernel) {
				// Not rendered yet: try again on the next call rather than keep the miss.
				this.#palette = null;
				return null;
			}
			palette.host = {
				search: (query) => this.#search(query),
				run: (name) => this.#run(name),
				close: () => void kernel.call('palette-close'),
			};
			return palette;
		});
		return this.#palette;
	}

	/** Open it with `query`, once the shell has rendered it. */
	async show(query: string): Promise<void> {
		let palette = await this.prepare();
		// The shell may not have rendered its palette yet; `prepare` forgets a miss, so retry.
		for (let attempt = 0; attempt < 60 && !palette; attempt++) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			palette = await this.prepare();
		}
		await palette?.open(query);
	}

	/** The rows of the last search that are not commands, by their names. */
	#rows = new Map<string, Row>();

	async #search(query: string): Promise<PaletteResult[]> {
		const kernel = this.#shell.kernel;
		const [result, made] = await Promise.all([
			kernel?.call<{ items: PaletteItem[] }>('palette-search', { query, limit: 20 }),
			/^\s*new\b/i.test(query) && kernel
				? import('../new/new-menu.js').then(({ readNew }) => readNew(kernel))
				: undefined,
		]);
		this.#rows = new Map();
		// `new note` lists New's items whose titles hold the rest of the query.
		const rest = query
			.replace(/^\s*new\b/i, '')
			.trim()
			.toLowerCase();
		const rows: PaletteResult[] = (made?.items ?? [])
			.filter((item) => item.title.toLowerCase().includes(rest))
			.map((item, index) => {
				const name = `new:${index}`;
				this.#rows.set(name, { item });
				return {
					name,
					title: `New: ${item.title}`,
					description:
						item.kind === 'creator'
							? `Runs ${item.command}`
							: `Creates a document from ${item.title}`,
					disabled: false,
				};
			});
		if (asksInbox(query)) {
			this.#rows.set(OPEN_INBOX, { inbox: true });
			rows.unshift({
				name: OPEN_INBOX,
				title: 'Open inbox',
				description: 'Your notices, and what is waiting for you',
				disabled: false,
			});
		}
		if (!result?.success) return rows;
		// The rows' flags from the commands as they are now: stage B adds more.
		const commands = new Map<string, CommandSummary>(
			kernel?.listCommands().map((command) => [command.name, command])
		);
		for (const item of (result.data as { items: PaletteItem[] }).items) {
			if (item.kind === 'setting') {
				this.#rows.set(item.name, { setting: item.name });
				rows.push({
					name: item.name,
					...(item.title !== undefined ? { title: item.title } : {}),
					// Where it lives, so two keys of one title read apart: "Setting of Hello: …".
					description: `Setting of ${item.app ?? 'the shell'}: ${item.description}`,
					disabled: false,
				});
				continue;
			}
			if (item.kind === 'document') {
				this.#rows.set(item.name, { document: item.name });
				rows.push({
					name: item.name,
					...(item.title !== undefined ? { title: item.title } : {}),
					description: item.description,
					disabled: false,
				});
				continue;
			}
			const summary = commands.get(item.name);
			// A command that needs input asks for it in the palette's prompt (7.1), never disabled.
			if (summary?.needsInput === true) this.#rows.set(item.name, { input: item.name });
			rows.push({
				name: item.name,
				...(item.title !== undefined ? { title: item.title } : {}),
				// Each names its app (A-P0-1), as a setting's row does.
				description: item.app ? `${item.app}: ${item.description}` : item.description,
				disabled: false,
				...(summary?.keybinding !== undefined ? { keybinding: summary.keybinding } : {}),
			});
		}
		return rows;
	}

	async #run(name: string): Promise<PaletteFailure | null> {
		const kernel = this.#shell.kernel;
		if (!kernel) return null;
		const row = this.#rows.get(name);
		if (row && 'item' in row) {
			// The palette closes first, so focus can go to the new editor (7).
			await kernel.call('palette-close');
			const { runNew } = await import('../new/new-menu.js');
			await runNew(this.#shell, row.item);
			return null;
		}
		const shellKey = SHELL_KEY_ACTIONS.some((action) => action === name);
		if (shellKey) await kernel.call('palette-close');
		const result = !row
			? await kernel.call(name, {})
			: 'input' in row
				? // The input prompt opens in the slot, which closes the palette as it shows (7.1).
					await kernel.call('palette-run', { command: row.input })
				: 'inbox' in row
					? await kernel.call('section-open', { section: 'inbox' })
					: 'setting' in row
						? await kernel.call('section-open', { section: 'settings', target: row.setting })
						: await kernel.call('document-open', { document: row.document, preview: false });
		if (!result.success) {
			if (shellKey) {
				await kernel.call('toast-show', {
					message: (result.error?.message ?? `${name} failed`).slice(0, 200),
					tone: 'warning',
				});
				return null;
			}
			return {
				message: result.error?.message ?? `${name} failed`,
				...(result.error?.suggestion !== undefined ? { suggestion: result.error.suggestion } : {}),
			};
		}
		if (!shellKey && name !== 'palette-close' && name !== 'palette-open')
			await kernel.call('palette-close');
		return null;
	}
}
