/**
 * @fileoverview An app's status items in the status bar (phase 1 specification, 9.3): made once per app it
 * shows, in the manifest's order, a `loam-status-action` for one with a command, and their values read from
 * `app-get`, which answers for the active scope (phase 2 specification, 7.6). Each is updated in place, so
 * a status button keeps focus when its value changes.
 */

import type { AppDetailV1, LoamKernelV3 } from '@lushly-dev/loam-kernel';
import type { LoamStatusAction } from '../elements/status-action.js';
import type { LoamStatusItem } from '../elements/status-item.js';

/** One item as the manifest declares it under `ui.surfaces.status.items`. */
interface Declared {
	id: string;
	label: string;
	command?: string;
	priority?: number;
}

export class StatusItems {
	#elements: HTMLElement[] = [];
	#for: string | null = null;

	/** Every element, to leave with the app. */
	get elements(): readonly HTMLElement[] {
		return this.#elements;
	}

	/** Forget them: the app left, and its elements with it. */
	clear(): void {
		this.#elements = [];
		this.#for = null;
	}

	/** Make `instance`'s items in `bar` once, then show their values; `current` says it is still showing. */
	async read(
		kernel: LoamKernelV3,
		bar: HTMLElement,
		instance: string,
		declared: readonly Declared[],
		current: () => boolean
	): Promise<void> {
		if (declared.length === 0 || !current()) return;
		const detail = await kernel.call<AppDetailV1>('app-get', { instance });
		if (!current()) return;
		const values = detail.data?.statusItems ?? {};
		if (this.#for !== instance) {
			const anchor = bar.querySelector('.journal-status');
			const needsInput = new Map(
				kernel.listCommands().map(({ name, needsInput }) => [name, needsInput])
			);
			const sorted = [...declared].sort(
				(a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
			);
			this.#elements = sorted.map((item) => {
				const element = bar.ownerDocument.createElement(
					item.command !== undefined ? 'loam-status-action' : 'loam-status-item'
				) as LoamStatusItem;
				element.slot = 'end';
				element.dataset.statusItem = item.id;
				element.label = item.label;
				if (item.command !== undefined) {
					const action = element as unknown as LoamStatusAction;
					action.command = item.command;
					action.disabled = needsInput.get(item.command) === true;
				}
				bar.insertBefore(element, anchor);
				return element;
			});
			this.#for = instance;
		}
		for (const element of this.#elements) {
			const value = values[element.dataset.statusItem as string] ?? '';
			if (element.textContent !== value) element.textContent = value;
		}
	}
}
