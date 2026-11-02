/**
 * @fileoverview A result as the console shows it (phase 1 specification, 7.7): the adapters' HTML with
 * classes and no `style` attribute, which `style-src 'self'` would refuse, and the labels beside it.
 * Results come from apps and mounted servers, so they are untrusted: `WebAdapter` escapes every value it
 * writes, the labels are set as text, and a shape it cannot read throws here, not in the element.
 */

import { type CommandResultInput, WebAdapter } from '@lushly-dev/afd-adapters';

/** The adapters' HTML for a result. Throws on a shape it cannot read, such as a `null` warning. */
export function resultHtml(result: unknown): string {
	return WebAdapter.renderCommandResult(result as CommandResultInput, { styling: 'classes' });
}

const display = (value: unknown): string =>
	typeof value === 'string' ? value : JSON.stringify(value);

/** What `metadata` says about where a result came from and whether a replay reaches it again. */
export function resultLabels(metadata: unknown): string[] {
	if (typeof metadata !== 'object' || metadata === null) return [];
	const fields = metadata as Readonly<Record<string, unknown>>;
	const labels: string[] = [];
	if (fields['dev.loam/trust'] === 'untrusted') {
		labels.push(`Untrusted: from ${display(fields['dev.loam/instance'] ?? 'an unknown server')}`);
	}
	if (Object.hasOwn(fields, 'dev.loam/replay')) labels.push('Recorded, not replayable');
	if (typeof fields['dev.loam/seq'] === 'number') {
		labels.push(`Journal entry ${fields['dev.loam/seq']}`);
	}
	if (Object.hasOwn(fields, 'dev.umbel/trust')) {
		labels.push(`dev.umbel/trust: ${display(fields['dev.umbel/trust'])}`);
	}
	return labels;
}
