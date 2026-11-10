/**
 * @fileoverview `loam-embed` (documents specification, 9.2; D81): the kit element a native editor puts in its
 * own surface, `kit.define(['loam-embed'])`, rendering another document read-only. Access is checked at
 * render, by `document-get` with the reader's actor and no scope override, and again on every change the
 * kernel announces; a refused or missing target is `Not available`, the same for both. It renders the target
 * type's `embed` in a mount or a view frame of that type's plugin, made through a surface port the chrome
 * fixes to the target's scope and makes read-only, so every mutation through it is `EMBED_READ_ONLY`; a type
 * with none shows its title, icon and a link. Depth is at most 3, and a cycle stops at its first repeat,
 * `EMBED_DEPTH_EXCEEDED`, in place. Its owner is the embedding document: it goes when its editor goes. A
 * chunk of its own, which the kit loads, since the `editor` chunk is near its ceiling (Status, step 12).
 */

import { css, FASTElement, html, observable } from '@lushly-dev/fast-element';
import type { KernelEventV3, LoamKernelV3 } from '@lushly-dev/loam-kernel';
import type {
	DocumentRecordV1,
	DocumentRefV1,
	DocumentTypeV1,
	LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';
import type { LoamMount } from '../elements/mount.js';
import type { LoamShell } from '../elements/shell.js';
import { resourceLinkUrl } from '../resource-link.js';
import type { LoamViewFrame } from '../view/view-frame.js';
import type { SurfaceHostV1 } from './editor-frame.js';

/** How deep embeds nest, the outermost one 1 (9.2). */
export const EMBED_DEPTH_MAX = 3;

type State = 'loading' | 'ready' | 'link' | 'unavailable' | 'deep';

const template = html<LoamEmbed>`
	<div
		class="embed"
		role="group"
		aria-label="${(x) => `Embedded: ${x.heading}`}"
		aria-description="Read-only"
	>
		<p class="head" ?hidden="${(x) => x.state !== 'ready' && x.state !== 'link'}">
			<violet-icon class="icon" icon="${(x) => x.icon}" decorative></violet-icon>
			${(x) =>
				x.url
					? html<LoamEmbed>`<a href="${(y) => y.url}">${(y) => y.heading}</a>`
					: html<LoamEmbed>`<span>${(y) => y.heading}</span>`}
		</p>
		<p
			class="note"
			role="status"
			data-code="${(x) => (x.state === 'deep' ? 'EMBED_DEPTH_EXCEEDED' : '')}"
			?hidden="${(x) => x.state === 'ready' || x.state === 'link'}"
		>
			${(x) =>
				x.state === 'loading'
					? 'Loading…'
					: x.state === 'deep'
						? `${x.heading} is embedded too deeply, or in itself, to show here`
						: 'Not available'}
		</p>
		<div class="body"></div>
	</div>
`;

const styles = css`
	:host {
		display: block;
		color: var(--color-text-primary);
	}
	[hidden] {
		display: none;
	}
	.embed {
		display: grid;
		gap: var(--space-stack-sm);
		padding: var(--space-stack-sm) var(--space-inline-md);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-subtle);
	}
	p {
		display: flex;
		align-items: center;
		gap: var(--space-inline-sm);
		margin: 0;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
	}
	.head {
		font-weight: var(--type-label-sm-weight);
	}
	.note {
		color: var(--color-text-secondary);
	}
	a {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--size-target-compact);
		color: var(--color-text-primary);
	}
	a:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	.body:empty {
		display: none;
	}
	@media (forced-colors: active) {
		.embed {
			border-color: CanvasText;
			background: Canvas;
		}
		a {
			color: LinkText;
		}
		a:focus-visible {
			outline-color: Highlight;
		}
	}
`;

const stop = (event: Event) => event.stopPropagation();

/** The parent of `node` across shadow roots. */
const up = (node: Node): Node | null => (node instanceof ShadowRoot ? node.host : node.parentNode);

export class LoamEmbed extends FASTElement {
	/** The id of the document it shows, a property (9.2). */
	declare document: string;
	declare state: State;
	declare heading: string;
	declare icon: string;
	declare url: string;
	#shell: LoamShell | null = null;
	#stop: (() => void) | undefined;
	/** The rendered target's mount or view frame, and the record it rendered. */
	#inner: LoamMount | LoamViewFrame | null = null;
	#shown: DocumentRecordV1 | null = null;
	#rendering = 0;

	constructor() {
		super();
		this.document = '';
		this.state = 'loading';
		this.heading = 'Document';
		this.icon = 'system/document';
		this.url = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// What the embedded document's editor dispatches stays here: it is not the embedding tab's (T-S1).
		for (const type of ['loam-editor-dirty', 'loam-editor-selection', 'loam-editor-save'])
			this.shadowRoot?.addEventListener(type, stop);
		void this.#render();
	}

	/**
	 * Moved by `moveBefore`, it keeps its state: without this, the move falls back to a disconnect and a
	 * connect, which would end its view (5.6; the re-check's N-B1).
	 */
	connectedMoveCallback(): void {}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		// A render still reading finds it stale, and mounts nothing (G-S3).
		this.#rendering += 1;
		this.#stop?.();
		this.#stop = undefined;
		this.#drop();
	}

	documentChanged(): void {
		if (this.isConnected) void this.#render();
	}

	/** The documents of the editor and every embed around this one, outermost last, and the shell. */
	#around(): { documents: string[]; embeds: number } {
		const documents: string[] = [];
		let embeds = 0;
		for (let node = up(this); node; node = up(node)) {
			const name = (node as Element).localName;
			if (name === 'loam-embed') {
				embeds += 1;
				documents.push((node as LoamEmbed).document);
			} else if (name === 'loam-editor-frame') {
				documents.push((node as unknown as { document: string }).document);
			} else if (name === 'loam-shell') {
				this.#shell = node as LoamShell;
				break;
			}
		}
		return { documents, embeds };
	}

	#drop(): void {
		const inner = this.#inner;
		this.#inner = null;
		this.#shown = null;
		if (inner?.localName === 'loam-view-frame') void (inner as LoamViewFrame).dispose();
		else if (inner) {
			try {
				void ((inner as LoamMount).surface as LoamEditorElementV1 | null)?.dispose?.();
			} catch (cause) {
				reportError(cause);
			}
			inner.remove();
		}
	}

	#fail(state: State, heading = 'Document'): void {
		this.#drop();
		this.url = '';
		this.heading = heading;
		this.state = state;
	}

	/** Read the target again, as the reader, and show it, or why not: refused and missing alike. */
	async #render(): Promise<void> {
		const turn = ++this.#rendering;
		const { documents, embeds } = this.#around();
		// A stop names its document only once the reader may read it, so it says nothing of a refused one.
		if (embeds + 1 > EMBED_DEPTH_MAX || documents.includes(this.document)) {
			const kernel = this.#shell?.kernel as LoamKernelV3 | undefined;
			const read = await kernel?.call<DocumentRecordV1>('document-get', {
				document: this.document,
			});
			if (turn === this.#rendering) this.#fail('deep', read?.data?.title ?? 'This document');
			return;
		}
		const kernel = this.#shell?.kernel as LoamKernelV3 | undefined;
		if (!kernel) return this.#fail('unavailable');
		this.#stop ??= kernel.subscribe((event) => this.#heard(event));
		const read = await kernel.call<DocumentRecordV1>('document-get', { document: this.document });
		if (turn !== this.#rendering) return;
		const record = read.success ? read.data : undefined;
		if (!record) return this.#fail('unavailable');
		const held = this.#shown;
		this.heading = record.title;
		// The same target in the same scope keeps what it renders; only its title moved.
		if (held?.id === record.id && held.scope.project === record.scope.project && this.#inner)
			return;
		this.#drop();
		const types = await kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', {
			all: true,
		});
		const type = types.data?.types.find((each) => each.id === record.type);
		const projects = await kernel.call<{ projects: Array<{ id: string; slug: string }> }>(
			'project-list',
			{}
		);
		if (turn !== this.#rendering) return;
		this.icon = type?.icon ?? 'system/document';
		this.url =
			resourceLinkUrl(
				{ kind: 'document', document: record.id, scope: record.scope },
				(this.#shell as LoamShell).base,
				{
					workspace: record.workspace,
					slugOf: (id) => projects.data?.projects.find((project) => project.id === id)?.slug,
				}
			) ?? '';
		const declared = type
			? kernel.appPort(type.instance).manifest.ui?.documents?.find((each) => each.id === type.id)
					?.embed
			: undefined;
		const reference: DocumentRefV1 = {
			id: record.id,
			type: record.type,
			title: record.title,
			scope: record.scope,
			contentVersion: record.contentVersion,
			binding: record.binding,
			readOnly: true,
		};
		const inner = declared && type ? await this.#make(type, declared, reference) : null;
		if (turn !== this.#rendering) {
			if (inner) {
				this.#inner = inner;
				this.#drop();
			}
			return;
		}
		this.#shown = record;
		this.#inner = inner;
		if (inner) this.shadowRoot?.querySelector('.body')?.append(inner);
		this.state = inner ? 'ready' : 'link';
	}

	/** The target type's embed, in a mount or a view frame of its plugin, read-only at the target's scope. */
	async #make(
		type: DocumentTypeV1,
		declared: { element?: string; resource?: string },
		reference: DocumentRefV1
	): Promise<LoamMount | LoamViewFrame | null> {
		const shell = this.#shell as LoamShell;
		const kernel = shell.kernel as LoamKernelV3;
		try {
			if (declared.resource !== undefined) {
				const { documentView } = await import('../view/view.js');
				return await documentView(kernel.appPort(type.instance), reference, declared.resource, {
					hostVersion: String(kernel.version),
					theme: () => (shell.appearance.resolved === 'dark' ? 'dark' : 'light'),
				});
			}
			const host = (shell.apps as { host?(): SurfaceHostV1 } | null)?.host?.();
			if (!host || declared.element === undefined) return null;
			await host.ensureActivated(type.instance);
			return host.createMount(type.instance, declared.element, {
				scope: reference.scope,
				document: reference,
				readOnly: true,
			});
		} catch (cause) {
			reportError(cause);
			return null;
		}
	}

	/** A change the kernel announces: the target's own re-reads it, and access is checked again (9.2). */
	#heard(event: KernelEventV3): void {
		if (event.document === this.document && event.success) {
			const change = {
				document: event.document,
				command: event.command,
				...(event.seq !== undefined ? { seq: event.seq } : {}),
			};
			const inner = this.#inner;
			if (inner?.localName === 'loam-view-frame') (inner as LoamViewFrame).documentChanged(change);
			else
				((inner as LoamMount | null)?.surface as LoamEditorElementV1 | null)?.documentChanged?.(
					change
				);
		}
		if (
			event.scopeChanged ||
			event.document === this.document ||
			(event.success && event.mutation && /^(document-|auth-|project-)/.test(event.command))
		)
			void this.#render();
	}
}
observable(LoamEmbed.prototype, 'document');
observable(LoamEmbed.prototype, 'state');
observable(LoamEmbed.prototype, 'heading');
observable(LoamEmbed.prototype, 'icon');
observable(LoamEmbed.prototype, 'url');

export const embedDefinition = { name: 'loam-embed', template, styles } as const;

/** Defined once, globally, where the kit finds its definition for an app's registry (phase 1, 5.4). */
export const defined: Promise<unknown> = customElements.get(embedDefinition.name)
	? Promise.resolve()
	: Promise.resolve(LoamEmbed.define(embedDefinition));
