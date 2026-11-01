import './fixture-press.js';

export default { title: 'FAST-AF/Press', component: 'fixture-press', args: { label: 'Water' } };

export const Default = {};

/** A command step through the FAST-AF runner, which calls the element's `@command` method. */
export const Pressed = {
	targets: { control: { selector: 'fixture-press' } },
	scenario: [
		{ id: 'press', command: { runner: 'fast-af', name: 'fixture.press', target: 'control' } },
		{ capture: 'pressed' },
	],
};

/** A command the element does not have. */
export const UnknownCommand = {
	targets: { control: { selector: 'fixture-press' } },
	scenario: [{ command: { runner: 'fast-af', name: 'fixture.missing', target: 'control' } }],
};
