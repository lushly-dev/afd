/** @fileoverview Tally as a native app: its elements load in `activate` (phase 1 specification, 5.1). */

import { defineApp } from '@lushly-dev/loam-sdk';
import { handlers } from './handlers.js';

export default defineApp({
	sdk: 1,
	handlers,
	async activate(context) {
		await context.kit.define(['violet-button']);
		const { defineTallyElements } = await import('./elements.js');
		await defineTallyElements(context);
	},
});
