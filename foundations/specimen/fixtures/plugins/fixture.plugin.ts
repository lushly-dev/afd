import { definePlugin } from '../../src/plugin.js';

// One plugin exercising all four plugin points on a plain custom element.
export default definePlugin({
	id: 'fixture',
	// A schema source that knows what the manifest cannot: the element's commands.
	schema(tag, schema) {
		if (tag !== 'plain-switch' || !schema) return schema;
		return {
			...schema,
			commands: [{ id: 'toggle', label: 'Toggle watering' }],
			unknown: schema.unknown.filter((field) => field !== 'commands'),
		};
	},
	// A context provider's named theme.
	themes: {
		dark: ({ document, root }) => {
			document.documentElement.dataset.fixturePreset = 'dark';
			root.dataset.fixturePreset = 'dark';
			return () => {
				delete document.documentElement.dataset.fixturePreset;
			};
		},
	},
	// A token map: a public name and the private alias the element reads.
	tokens: {
		id: 'fixture',
		version: '1.0.0',
		tokens: { '--fixture-accent': 'color.accent' },
		aliases: { '--_switch-accent': '--fixture-accent' },
	},
	// A command runner for explicit command steps.
	runners: {
		fixture: {
			commands: (element) =>
				typeof (element as { toggle?: unknown }).toggle === 'function' ? ['toggle'] : [],
			run: (element, name) => {
				if (name !== 'toggle') throw new Error(`The fixture runner has no command '${name}'.`);
				(element as unknown as { toggle(): void }).toggle();
			},
		},
	},
});
