import './plain-switch.js';

export default { title: 'Plugins/Switch', component: 'plain-switch', args: { checked: false } };

/** A command step through the fixture plugin's runner. */
export const Toggled = {
	targets: { control: { selector: 'plain-switch' } },
	scenario: [
		{ id: 'toggle', command: { runner: 'fixture', name: 'toggle', target: 'control' } },
		{ capture: 'toggled' },
	],
};

/** A command step naming a runner no plugin registers. */
export const MissingRunner = {
	targets: { control: { selector: 'plain-switch' } },
	scenario: [{ command: { runner: 'absent', name: 'toggle', target: 'control' } }],
};
