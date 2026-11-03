/** @fileoverview Registering what the chrome defines for apps, globally under `loam-` (5.4). */

import { LoamList, listDefinition } from '../elements/list.js';
import { LoamModal, modalDefinition } from '../elements/modal.js';
import { LoamMount } from '../elements/mount.js';
import { defineNotice } from '../elements/notice-loader.js';
import { LoamPartHeader, partHeaderDefinition } from '../elements/part-header.js';
import { LoamStatusAction, statusActionDefinition } from '../elements/status-action.js';
import {
	LoamToast,
	LoamToastRegion,
	toastDefinition,
	toastRegionDefinition,
} from '../elements/toast.js';
import { registerAppIcons } from './icons.js';

/** The elements of this chunk that app surfaces use. */
export const APP_ELEMENTS: readonly string[] = Object.freeze([
	'loam-mount',
	listDefinition.name,
	partHeaderDefinition.name,
	statusActionDefinition.name,
	toastRegionDefinition.name,
	toastDefinition.name,
	modalDefinition.name,
]);

let defined: Promise<void> | null = null;

/** Define every element of this chunk once, with the notice. The chrome's own are defined by now. */
export function defineAppElements(): Promise<void> {
	defined ??= (async () => {
		// `ICONS_V1`, after the first frame: its entries were drawn with a blank slot (2.4).
		registerAppIcons();
		await defineNotice();
		if (!customElements.get('loam-mount')) customElements.define('loam-mount', LoamMount);
		for (const [type, definition] of [
			[LoamList, listDefinition],
			[LoamPartHeader, partHeaderDefinition],
			[LoamStatusAction, statusActionDefinition],
			[LoamToastRegion, toastRegionDefinition],
			[LoamToast, toastDefinition],
			[LoamModal, modalDefinition],
		] as const) {
			if (customElements.get(definition.name)) continue;
			// biome-ignore lint/suspicious/noExplicitAny: each definition matches its own element type
			await (type as any).define(definition);
		}
	})();
	return defined;
}
