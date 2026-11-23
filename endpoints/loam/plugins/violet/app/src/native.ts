/**
 * @fileoverview Native Loam app entry for Violet in Loam (spec §3.1, §3.2).
 * Top-level code never touches the DOM or global custom element registry (`createAppTestKernel`).
 */
import { defineApp } from '@lushly-dev/loam-sdk';
import { handlers } from './handlers.js';

export default defineApp({
	sdk: 1,
	handlers,
	async activate(context) {
		await context.kit.define([
			'violet-badge',
			'violet-button',
			'violet-checkbox',
			'violet-divider',
			'violet-empty-state',
			'violet-option',
			'violet-select',
			'violet-text-field',
		]);
		const { defineVioletElements } = await import('./elements/index.js');
		await defineVioletElements(context);
	},
});
