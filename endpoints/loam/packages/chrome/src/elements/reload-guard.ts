/**
 * @fileoverview Safe reload guard for `loam-shell.requestReload()` (phase 5 no-terminal amendment,
 * section 9.2 step 6). Loaded lazily only when `host-setup` triggers `setup_apply_reload`, so zero
 * bytes are added to first paint.
 */

import { css, FASTElement, html, observable } from '@lushly-dev/fast-element';
import type { EditorReadV1 } from '../editor/editor-parts.js';
import type { LoamShell } from './shell.js';

interface ReloadableFrame {
	dirty?: boolean;
	save(): Promise<void>;
}

interface ReloadableEditor {
	lifecycle?: readonly [
		unknown,
		Map<string, ReloadableFrame>,
		Map<string, ReloadableFrame>,
		unknown,
		unknown,
		unknown,
		unknown,
		unknown,
		unknown,
		unknown,
		Set<ReloadableFrame>?,
	];
	hasDirtyFrames?(): boolean;
	saveAllDirty?(): Promise<boolean>;
	idle?: Promise<void>;
}

function suppressUnloadSaves(editor: ReloadableEditor | undefined): void {
	const life = editor?.lifecycle;
	if (!life) return;
	// Clearing `dirty` and live/parked/kept frame references before navigating ensures neither
	// a pending autosave timer nor `editor.ts`'s `pagehide` handler saves explicitly discarded drafts.
	for (const f of life[1].values()) if (f && typeof f === 'object') f.dirty = false;
	for (const f of life[2].values()) if (f && typeof f === 'object') f.dirty = false;
	if (life[10]) for (const f of life[10]) if (f && typeof f === 'object') f.dirty = false;
	life[1].clear();
	life[2].clear();
	life[10]?.clear();
}

async function waitEditorIdle(editor: ReloadableEditor | undefined): Promise<void> {
	// `EditorController.#reconcile()` chains follow-up `#marks()` passes onto `#queue` (exposed via
	// `editor.idle`), so loop until the promise identity stabilizes.
	let prev: Promise<void> | undefined;
	for (let i = 0; i < 8; i++) {
		const cur = editor?.idle;
		if (!cur || cur === prev) break;
		prev = cur;
		await cur;
	}
}

function dirtyFramesOf(editor: ReloadableEditor | undefined): ReloadableFrame[] {
	const life = editor?.lifecycle;
	if (!life) return [];
	const seen = new Set<ReloadableFrame>();
	for (const f of life[1].values()) if (f.dirty) seen.add(f);
	for (const f of life[2].values()) if (f.dirty) seen.add(f);
	if (life[10]) for (const f of life[10]) if (f.dirty) seen.add(f);
	return [...seen];
}

const template = html<LoamReloadDialog>`
	<div class="backdrop" role="presentation">
		<div
			class="dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="reload-title"
			aria-describedby="reload-body"
			data-reload-dialog
		>
			<h2 id="reload-title" class="title">Unsaved changes</h2>
			<p id="reload-body" class="body">
				You have unsaved edits in open tabs. Save your changes before reloading Loam, discard them,
				or cancel to keep working.
			</p>
			<p class="error" role="alert" ?hidden="${(x) => !x.errorMessage}">${(x) => x.errorMessage}</p>
			<div class="actions">
				<button
					class="btn primary"
					type="button"
					?disabled="${(x) => x.saving}"
					@click="${(x) => x.choose('save')}"
				>
					Save &amp; Reload
				</button>
				<button
					class="btn danger"
					type="button"
					?disabled="${(x) => x.saving}"
					@click="${(x) => x.choose('discard')}"
				>
					Discard &amp; Reload
				</button>
				<button
					class="btn"
					type="button"
					?disabled="${(x) => x.saving}"
					@click="${(x) => x.choose('cancel')}"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
`;

const styles = css`
	:host {
		position: fixed;
		inset: 0;
		z-index: var(--violet-z-index-modal);
	}
	.backdrop {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 100%;
		block-size: 100%;
		padding: var(--violet-space-layout-panel);
		box-sizing: border-box;
		background: color-mix(in srgb, var(--violet-color-surface-page) 60%, transparent);
	}
	.dialog {
		box-sizing: border-box;
		inline-size: min(92vw, var(--violet-shell-size-main-min));
		padding: var(--violet-space-layout-panel);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-floating);
		background: var(--violet-color-surface-floating);
		color: var(--violet-color-text-primary);
		box-shadow: var(--violet-shadow-floating);
		display: flex;
		flex-direction: column;
		gap: var(--violet-space-stack-group);
	}
	.title {
		margin: 0;
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-type-heading-section-weight);
	}
	.body,
	.error {
		margin: 0;
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
	}
	.body {
		color: var(--violet-color-text-secondary);
	}
	.error {
		color: var(--violet-color-state-danger-text);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--violet-space-inline-tight);
	}
	.btn {
		box-sizing: border-box;
		min-block-size: var(--violet-size-target-natural);
		padding-block: 0;
		padding-inline: var(--violet-space-inline-group);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-card);
		color: var(--violet-color-text-primary);
		font: inherit;
		font-size: var(--violet-type-label-size);
		font-weight: var(--violet-type-label-weight);
		cursor: pointer;
	}
	.btn.primary {
		background: var(--violet-color-control-selected-background);
		border-color: var(--violet-color-control-selected-foreground);
		color: var(--violet-color-control-selected-foreground);
	}
	.btn:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-space-inline-hairline);
	}
	[hidden] {
		display: none;
	}
	@media (forced-colors: active) {
		.dialog {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
		.btn {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
		}
		.btn.primary {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
			forced-color-adjust: none;
		}
	}
`;

class LoamReloadDialog extends FASTElement {
	declare saving: boolean;
	declare errorMessage: string;
	onChoice: ((choice: 'save' | 'discard' | 'cancel') => void) | null = null;

	constructor() {
		super();
		this.saving = false;
		this.errorMessage = '';
	}

	choose(choice: 'save' | 'discard' | 'cancel'): void {
		this.onChoice?.(choice);
	}
}
observable(LoamReloadDialog.prototype, 'saving');
observable(LoamReloadDialog.prototype, 'errorMessage');

const RELOAD_DIALOG_DEF = { name: 'loam-reload-dialog', template, styles } as const;

function performPageReload(shell: LoamShell): void {
	if (typeof shell.performReload === 'function') {
		shell.performReload();
		return;
	}
	const view = shell.ownerDocument.defaultView ?? window;
	if (view.location.protocol === 'loam:') {
		view.location.replace('loam://localhost/');
	} else {
		view.location.reload();
	}
}

async function hasAnyDirtyTab(shell: LoamShell): Promise<boolean> {
	const editor = (shell as LoamShell & { editor?: ReloadableEditor }).editor;
	if (editor?.hasDirtyFrames?.() || dirtyFramesOf(editor).length > 0) return true;
	const read = await shell.kernel?.call<EditorReadV1>('editor-get');
	if (read?.success && read.data) {
		for (const group of read.data.groups) {
			if (group.tabs.some((tab) => tab.dirty)) return true;
		}
	}
	return false;
}

/**
 * Inspects open editor tabs' dirty state: reloads immediately if all tabs are clean, or opens
 * Loam's unsaved-changes confirmation modal (Save & Reload / Discard & Reload / Cancel).
 */
export async function requestShellReload(shell: LoamShell): Promise<'reloaded' | 'prompted'> {
	const dirty = await hasAnyDirtyTab(shell);
	if (!dirty) {
		await shell.kernel?.flush();
		performPageReload(shell);
		return 'reloaded';
	}
	if (!customElements.get(RELOAD_DIALOG_DEF.name)) {
		await (LoamReloadDialog as unknown as typeof FASTElement).define(RELOAD_DIALOG_DEF);
	}
	const host = shell.shadowRoot ?? shell.ownerDocument.body;
	const existing = host.querySelector<LoamReloadDialog>(RELOAD_DIALOG_DEF.name);
	if (existing) {
		existing.shadowRoot?.querySelector<HTMLButtonElement>('.btn.primary')?.focus();
		return 'prompted';
	}
	const previousFocus = shell.ownerDocument.activeElement as HTMLElement | null;
	const dialog = shell.ownerDocument.createElement(RELOAD_DIALOG_DEF.name) as LoamReloadDialog;
	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && !dialog.saving) {
			event.preventDefault();
			close();
			return;
		}
		if (event.key === 'Tab') {
			const focusable = [
				...(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
			];
			if (focusable.length === 0) return;
			const active = dialog.shadowRoot?.activeElement as HTMLElement | null;
			const idx = active ? focusable.indexOf(active as HTMLButtonElement) : -1;
			event.preventDefault();
			const nextIdx = event.shiftKey
				? idx <= 0
					? focusable.length - 1
					: idx - 1
				: idx === -1 || idx >= focusable.length - 1
					? 0
					: idx + 1;
			focusable[nextIdx]?.focus();
		}
	};
	const close = () => {
		dialog.removeEventListener('keydown', onKeydown);
		dialog.remove();
		previousFocus?.focus?.();
	};
	dialog.addEventListener('keydown', onKeydown);
	dialog.onChoice = async (choice) => {
		if (choice === 'cancel') {
			close();
			return;
		}
		if (choice === 'discard') {
			const editor = (shell as LoamShell & { editor?: ReloadableEditor }).editor;
			suppressUnloadSaves(editor);
			close();
			await shell.kernel?.flush();
			performPageReload(shell);
			return;
		}
		dialog.saving = true;
		dialog.errorMessage = '';
		try {
			const editor = (shell as LoamShell & { editor?: ReloadableEditor }).editor;
			let saved = true;
			if (editor?.saveAllDirty) {
				saved = await editor.saveAllDirty();
			} else {
				for (const frame of dirtyFramesOf(editor)) {
					try {
						await frame.save();
					} catch {
						saved = false;
					}
				}
			}
			// Wait for `EditorController.#reconcile()` to propagate `editor-dirty-set` before re-checking
			// dirty state across live frames and kernel `editor-get` so a real dirty tab save settles
			// cleanly while an unbacked dirty tab can never be silently discarded.
			await waitEditorIdle(editor);
			if (!saved || (await hasAnyDirtyTab(shell))) {
				dialog.saving = false;
				dialog.errorMessage =
					'One or more tabs still have unsaved changes and could not be saved automatically. Fix the error or choose Discard & Reload.';
				return;
			}
			close();
			await shell.kernel?.flush();
			performPageReload(shell);
		} catch {
			dialog.saving = false;
			dialog.errorMessage = 'Saving failed. Choose Discard & Reload or Cancel.';
		}
	};
	host.append(dialog);
	queueMicrotask(() => {
		dialog.shadowRoot?.querySelector<HTMLButtonElement>('.btn.primary')?.focus();
	});
	return 'prompted';
}
