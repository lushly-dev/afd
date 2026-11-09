/**
 * @fileoverview Notes as a native app: its editor loads in `activate`, which the editor area runs on the
 * first note opened, though notes has no rail entry (documents specification, 5.6 and 10).
 */

import { defineApp } from '@lushly-dev/loam-sdk';
import { handlers } from './handlers.js';

export default defineApp({
	sdk: 1,
	handlers,
	async activate(context) {
		await context.kit.define([
			'violet-button',
			'violet-text-area',
			'violet-text-field',
			'loam-embed',
		]);
		const { defineNotesElements } = await import('./notes-editor.js');
		await defineNotesElements(context);
	},
});
