/**
 * @fileoverview The notice loads when one is needed: few pages show it, and the first-paint chunk has
 * little room (phase 1 specification, 9.2).
 */

let loading: Promise<void> | null = null;

export function defineNotice(): Promise<void> {
	loading ??= import('./notice.js').then(async ({ LoamNotice, noticeDefinition }) => {
		if (!customElements.get(noticeDefinition.name)) await LoamNotice.define(noticeDefinition);
	});
	return loading;
}
