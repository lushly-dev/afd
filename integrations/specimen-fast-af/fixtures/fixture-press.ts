import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

/** A FAST element with attributes, a slot and a CSS property. */
export class FixturePress extends FASTElement {
	declare label: string;
	declare disabled: boolean;
}
attr(FixturePress.prototype, 'label');
attr({ mode: 'boolean' })(FixturePress.prototype, 'disabled');

await FixturePress.define({
	name: 'fixture-press',
	template: html<FixturePress>`<button type="button" ?disabled=${(x) => x.disabled}>${(x) => x.label}</button><slot name="after"></slot>`,
	styles: css`
		:host {
			--press-ink: var(--fixture-ink, rgb(0, 0, 0));
			color: var(--press-ink);
		}
	`,
});
