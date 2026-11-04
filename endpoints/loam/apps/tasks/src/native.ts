/** @fileoverview Tasks as a native app: its elements load in `activate` (phase 1 specification, 5.1). */

import { defineApp } from '@lushly-dev/loam-sdk';
import { handlers } from './handlers.js';

export default defineApp({
	sdk: 1,
	handlers,
	async activate(context) {
		await context.kit.define(['violet-button', 'violet-text-field']);
		const { defineTasksElements } = await import('./elements.js');
		await defineTasksElements(context);
	},
});
