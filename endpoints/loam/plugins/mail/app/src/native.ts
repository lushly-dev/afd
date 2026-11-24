/** @fileoverview Mail's app as a native app: its view loads in `activate` (phase 1 specification, 5.1). */

import { defineApp } from '@lushly-dev/loam-sdk';

export default defineApp({
	sdk: 1,
	handlers: {},
	async activate(context) {
		await context.kit.define(['violet-button', 'violet-text-field', 'violet-text-area']);
		const { defineMailElements } = await import('./elements.js');
		await defineMailElements(context);
	},
});
