/**
 * @fileoverview The command palette's host for `loam-shell` (phase 0 specification, 7): the palette's
 * search, run and close, each a command, and its rows' flags from the kernel's command summaries. It loads
 * with the palette, when the page is idle, so first paint holds only the boundary (phase 2 specification,
 * 2.4).
 */

import type { CommandSummaryV0, LoamKernelV2, PaletteItem } from '@lushly-dev/loam-kernel';
import type { LoamPalette, PaletteFailure, PaletteResult } from './palette.js';

/** What the host reads of the shell. */
interface PaletteShell {
	readonly kernel: LoamKernelV2 | null;
	readonly palette: LoamPalette;
}

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

	async #search(query: string): Promise<PaletteResult[]> {
		const result = await this.#shell.kernel?.call<{ items: PaletteItem[] }>('palette-search', {
			query,
			limit: 20,
		});
		if (!result?.success) return [];
		// The rows' flags from the commands as they are now: stage B adds more.
		const commands = new Map<string, CommandSummaryV0>(
			this.#shell.kernel?.listCommands().map((command) => [command.name, command])
		);
		return (result.data as { items: PaletteItem[] }).items.map((item) => {
			const summary = commands.get(item.name);
			return {
				name: item.name,
				...(item.title !== undefined ? { title: item.title } : {}),
				description: item.description,
				disabled: summary?.needsInput === true,
				...(summary?.keybinding !== undefined ? { keybinding: summary.keybinding } : {}),
			};
		});
	}

	async #run(name: string): Promise<PaletteFailure | null> {
		const kernel = this.#shell.kernel;
		if (!kernel) return null;
		const result = await kernel.call(name, {});
		if (!result.success) {
			return {
				message: result.error?.message ?? `${name} failed`,
				...(result.error?.suggestion !== undefined ? { suggestion: result.error.suggestion } : {}),
			};
		}
		if (name !== 'palette-close' && name !== 'palette-open') await kernel.call('palette-close');
		return null;
	}
}
