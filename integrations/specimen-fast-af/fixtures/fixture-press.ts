import { attr, css, FASTElement, html, observable } from '@lushly-dev/fast-element';
import { command } from '@lushly-dev/fast-element/command.js';

/** A FAST element with attributes, a slot, a CSS property and an `@command` command. */
export class FixturePress extends FASTElement {
	declare label: string;
	declare disabled: boolean;
	declare presses: number;

	press(): void {
		if (this.disabled) return;
		this.presses += 1;
		this.setAttribute('data-presses', String(this.presses));
	}
}
attr(FixturePress.prototype, 'label');
attr({ mode: 'boolean' })(FixturePress.prototype, 'disabled');
observable(FixturePress.prototype, 'presses');
FixturePress.prototype.presses = 0;
const descriptor = Object.getOwnPropertyDescriptor(FixturePress.prototype, 'press');
if (descriptor)
	command('fixture.press', { label: 'Press' })(FixturePress.prototype, 'press', descriptor);

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
