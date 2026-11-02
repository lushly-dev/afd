/**
 * @fileoverview Hello as a native app. The elements load in `activate`, so importing this module for a
 * command touches neither the DOM nor a registry (5.1).
 */

import { defineApp } from '@lushly-dev/loam-sdk';
import { handlers } from './handlers.js';

export default defineApp({
	sdk: 1,
	handlers,
	async activate(context) {
		await context.kit.define(['violet-button', 'violet-text-field']);
		const { defineHelloElements } = await import('./elements.js');
		await defineHelloElements(context);
	},
});
