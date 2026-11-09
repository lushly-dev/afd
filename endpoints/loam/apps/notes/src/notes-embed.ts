/**
 * @fileoverview `notes-embed` (documents specification, 9.2 and 10): a note as another document embeds it,
 * read-only by contract, holding no form. The first 2,000 characters of `notes-content-get`, as text, in a
 * block, and each document the note embeds as a `loam-embed` of its own, which the shell stops at a depth of
 * three or at a cycle. Its client is a read-only surface port fixed to the note's scope, so a mutation through
 * it is `EMBED_READ_ONLY`. It reads again on each change the shell tells it of.
 */

import { css, FASTElement, html, observable, repeat } from '@lushly-dev/fast-element';
import type {
	AppContextV1,
	DocumentChangeV1,
	DocumentRefV1,
	LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';

/** How much of a note an embed shows (10). */
export const EMBED_TEXT_MAX = 2_000;

const template = html<NotesEmbed>`
	<p class="text">${(x) => x.text}</p>
	<p class="more" ?hidden="${(x) => !x.more}">…</p>
	<ul ?hidden="${(x) => x.embeds.length === 0}">
		${repeat(
			(x) => x.embeds,
			html<string>`<li><loam-embed :document="${(id) => id}"></loam-embed></li>`
		)}
	</ul>
`;

const styles = css`
	:host {
		display: grid;
		gap: var(--space-stack-sm);
		color: var(--color-text-primary);
	}
	[hidden] {
		display: none;
	}
	p {
		margin: 0;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.more {
		color: var(--color-text-secondary);
	}
	ul {
		display: grid;
		gap: var(--space-stack-sm);
		margin: 0;
		padding: 0;
		list-style: none;
	}
`;

export class NotesEmbed extends FASTElement implements LoamEditorElementV1 {
	context?: AppContextV1;
	declare document?: DocumentRefV1;
	declare text: string;
	declare more: boolean;
	declare embeds: string[];

	constructor() {
		super();
		this.text = '';
		this.more = false;
		this.embeds = [];
	}

	override connectedCallback(): void {
		super.connectedCallback();
		void this.read();
	}

	async read(): Promise<void> {
		const id = this.document?.id;
		if (!id || !this.context) return;
		const result = await this.context.client.call<{ text: string; embeds?: string[] }>(
			'notes-content-get',
			{ document: id }
		);
		const text = result.success ? (result.data?.text ?? '') : '';
		this.text = text.slice(0, EMBED_TEXT_MAX);
		this.more = text.length > EMBED_TEXT_MAX;
		const embeds = result.data?.embeds ?? [];
		if (embeds.join(' ') !== this.embeds.join(' ')) this.embeds = [...embeds];
	}

	documentChanged(_change: DocumentChangeV1): void {
		void this.read();
	}
}
observable(NotesEmbed.prototype, 'document');
observable(NotesEmbed.prototype, 'text');
observable(NotesEmbed.prototype, 'more');
observable(NotesEmbed.prototype, 'embeds');

export const notesEmbedDefinition = { name: 'notes-embed', template, styles } as const;
