/**
 * @fileoverview What the `sections` and `documents` chunks share, small enough that neither loads the other's
 * cards for it: elements whose text is always text, dates and numbers as text, and which kernel events change
 * what the documents section shows (phase 2 specification, 7.7 and 13; documents specification, 8).
 */

import type { KernelEventV2 } from '@lushly-dev/loam-kernel';

/** A date as text, or none: a time `Date` cannot hold makes `format` throw, and no row may fail the read (T1). */
export const dateOf = (at: number): string => {
	try {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(at));
	} catch {
		return '';
	}
};

export const numberOf = (value: number): string => new Intl.NumberFormat().format(value);

/** An ISO date for `<time datetime>`, or none where a `Date` cannot hold the time. */
export const isoOf = (at: number): string => {
	try {
		return new Date(at).toISOString();
	} catch {
		return '';
	}
};

type Child = Node | string;

/**
 * An element whose text is always text: strings are appended as text nodes and attributes are set as
 * values, never parsed as markup (13). The lists are built so, not by `repeat`, whose module first paint's
 * switcher shares with the kit's listbox: importing it here would split that chunk (2.4).
 */
export function el(
	tag: string,
	attributes: Record<string, string>,
	...children: Child[]
): HTMLElement {
	const element = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	element.append(...children);
	return element;
}

/**
 * Whether `event` changes what the documents section shows (documents specification, 8): a document's
 * record, an instance command's save, which stamps `updatedAt`, a project's name, an app enabled or
 * disabled, or the actor. A query's event changes nothing, and opening a tab neither.
 */
export const changesDocuments = (event: KernelEventV2): boolean =>
	event.success &&
	event.mutation &&
	(event.document !== undefined ||
		/^(document-(?!open$)|project-update$|workspace-app-set$|auth-)/.test(event.command));
