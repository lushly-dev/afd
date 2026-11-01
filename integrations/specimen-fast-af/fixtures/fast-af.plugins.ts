import { fastAf } from '../src/index.js';
import * as theme from './theme.js';

// How a FAST-AF consumer wires the plugin: its own theme module and alias registry.
export default fastAf({
	themes: theme,
	tokens: {
		id: 'fast-af',
		version: '0.1.0',
		aliases: { '--press-ink': '--fixture-ink' },
		tokens: { '--fixture-ink': 'color.ink' },
	},
});
