import { definePlugin } from '../../src/plugin.js';

// Registers a runner id the fixture plugin already registers.
export default definePlugin({
	id: 'duplicate',
	runners: { fixture: { run: () => undefined } },
});
