/**
 * @fileoverview The projects section's cards and rows, built as DOM with text nodes and attribute values,
 * never markup (phase 2 specification, 7.7 and 13): what an app returned is always text.
 */

import type { ProjectSummaryRowV1 } from '@lushly-dev/loam-kernel';
import { el, numberOf } from './dom.js';

export { dateOf, el, isoOf, numberOf } from './dom.js';

type Child = Node | string;

export const REPORT = "Report this to the app's owner";

/**
 * `text` as a sentence: one that ends in `!`, `?` or `…` as it is, any other with one period, removing one
 * trailing period first, so "failure(...)" keeps its ellipsis (N4).
 */
const sentence = (text: string): string =>
	/[!?…]$/.test(text) ? text : `${text.replace(/\.$/, '')}.`;

/** A message and its suggestion as two sentences, as a field's refusal reads (A6). */
export const sentences = (message: string, suggestion?: string): string =>
	`${sentence(message)}${suggestion ? ` ${sentence(suggestion)}` : ''}`;

export interface LinkView {
	label: string;
	url: string | undefined;
}

/** One card, as the template shows it: text, and URLs the scheme formatted. */
export interface CardView {
	row: ProjectSummaryRowV1;
	url: string | undefined;
	recent: Array<LinkView & { updated: string; iso: string }>;
	links: LinkView[];
}

/** A link where the scheme gave a URL, else its text alone: navigation, never execution. */
const linkOrText = ({ label, url }: LinkView): HTMLElement =>
	url === undefined
		? el('span', { dir: 'auto' }, label)
		: el('a', { href: url, dir: 'auto' }, label);

export function cardOf({ row, url, recent, links }: CardView): HTMLElement {
	// What an app returned is text in its own direction (A, dir).
	const id = `card-${row.instance}`;
	const parts: Child[] = [
		el(
			'h2',
			{ id },
			el('violet-icon', { icon: row.icon, decorative: '' }),
			linkOrText({ label: row.title, url })
		),
	];
	if (row.error) {
		parts.push(
			el('p', { class: 'failure' }, `Error: ${sentences(row.error.message, row.error.suggestion)}`)
		);
	}
	const counts = row.summary?.counts ?? [];
	if (counts.length > 0) {
		parts.push(
			el(
				'dl',
				{ class: 'counts' },
				...counts.map((count) =>
					el('div', {}, el('dt', { dir: 'auto' }, count.label), el('dd', {}, numberOf(count.value)))
				)
			)
		);
	}
	if (recent.length > 0) {
		parts.push(
			el('h3', {}, 'Recent'),
			el(
				'ul',
				{ class: 'recent' },
				...recent.map((item) =>
					el(
						'li',
						{},
						linkOrText(item),
						...(item.updated
							? [
									el('span', { class: 'muted', 'aria-hidden': 'true' }, ' · '),
									el('time', { class: 'muted', datetime: item.iso }, item.updated),
								]
							: [])
					)
				)
			)
		);
	}
	if (links.length > 0) {
		parts.push(
			el('ul', { class: 'links' }, ...links.map((item) => el('li', {}, linkOrText(item))))
		);
	}
	const dropped = row.dropped ?? 0;
	if (dropped > 0) {
		parts.push(
			el(
				'p',
				{ class: 'muted' },
				`${numberOf(dropped)} ${dropped === 1 ? 'entry' : 'entries'} of this summary could not be shown.`
			)
		);
	}
	// An `article`, not a `section`: six apps add no six landmarks.
	return el('article', { class: 'card', 'aria-labelledby': id }, ...parts);
}

/** The project home's `Documents` card (documents specification, 8.3): per type, its count and five most recent. */
export interface DocumentsCardView {
	types: Array<{
		title: string;
		icon: string;
		total: number;
		recent: Array<LinkView & { updated: string; iso: string }>;
	}>;
}

/** The shell's own card, after the apps' summaries: a heading per type with its count, and its recent ones. */
export function documentsCardOf({ types }: DocumentsCardView): HTMLElement {
	return el(
		'article',
		{ class: 'card', 'aria-labelledby': 'card-documents' },
		el(
			'h2',
			{ id: 'card-documents' },
			el('violet-icon', { icon: 'system/document', decorative: '' }),
			'Documents'
		),
		...types.flatMap((type) => [
			el('h3', { dir: 'auto' }, `${type.title}: ${numberOf(type.total)}`),
			type.recent.length === 0
				? el('p', { class: 'muted' }, 'None yet')
				: el(
						'ul',
						{ class: 'recent' },
						...type.recent.map((item) =>
							el(
								'li',
								{},
								linkOrText(item),
								el('span', { class: 'muted', 'aria-hidden': 'true' }, ' · '),
								el('time', { class: 'muted', datetime: item.iso }, item.updated)
							)
						)
					),
		])
	);
}
