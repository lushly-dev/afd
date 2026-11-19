/**
 * Checks on <change-bar>: cases that prove something, where the states in
 * change-bar.specimens.js only show it.
 *
 * Each one acts on the bar with real browser input or reads its live state,
 * and says which fact that proves. Specimen marks a fact `verified` in the
 * component pack only when its check ran and held. A fact nobody checks stays
 * `observed`, `declared` or `authored`, and the pack says so.
 */
import './change-bar.js';

function bar(attributes = {}) {
	const element = document.createElement('change-bar');
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	element.textContent = '3 changes to Atlas Dark';
	return element;
}

/** Selectors reach into the bar's open shadow root. */
const targets = {
	bar: { selector: 'change-bar' },
	keep: { selector: 'change-bar .keep' },
	drop: { selector: 'change-bar .drop' },
	away: { selector: 'change-bar .away' },
};

const after = (obligation, ...expectations) => ({
	target: 'bar',
	obligation,
	checkpoint: 'after-run',
	expectations,
});

/** Each button sends its event when it is pressed. */
export const Events = {
	render: () => bar(),
	targets,
	events: ['save', 'discard', 'dismiss'].map((type) => ({ type, target: 'bar' })),
	scenario: [
		{ id: 'press-save', action: { click: 'keep' } },
		{ id: 'saved', expect: { event: 'save', target: 'bar', since: 'press-save' } },
		{ id: 'press-discard', action: { click: 'drop' } },
		{ id: 'discarded', expect: { event: 'discard', target: 'bar', since: 'press-discard' } },
		{ id: 'press-dismiss', action: { click: 'away' } },
		{ id: 'dismissed', expect: { event: 'dismiss', target: 'bar', since: 'press-dismiss' } },
	],
	coverage: [after('event:save', 'saved'), after('event:discard', 'discarded'), after('event:dismiss', 'dismissed')],
};

/** The label attribute is what the main button says. */
export const Label = {
	render: () => bar({ label: 'Save changes' }),
	targets,
	scenario: [
		{ id: 'label-set', expect: { target: 'bar', state: { attribute: 'label', equals: 'Save changes' } } },
		{ id: 'button-says-it', expect: { target: 'keep', state: { property: 'textContent', equals: 'Save changes' } } },
	],
	coverage: [after('guide:change-bar.label', 'label-set', 'button-says-it')],
};

/** save-disabled switches off the main button, and only that one. */
export const SaveDisabled = {
	render: () => bar({ 'save-disabled': '' }),
	targets,
	scenario: [
		{ id: 'set', expect: { target: 'bar', state: { property: 'saveDisabled', equals: true } } },
		{ id: 'save-off', expect: { target: 'keep', state: { property: 'disabled', equals: true } } },
		{ id: 'discard-on', expect: { target: 'drop', state: { property: 'disabled', equals: false } } },
		{ id: 'dismiss-on', expect: { target: 'away', state: { property: 'disabled', equals: false } } },
	],
	coverage: [
		after('property:saveDisabled=true', 'set'),
		after('guide:change-bar.save-disabled', 'set', 'save-off', 'discard-on', 'dismiss-on'),
	],
};
