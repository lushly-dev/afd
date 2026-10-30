/**
 * Status icons, registered through violet-elements' public icon registry. Each status
 * has its own shape, so statuses that share a hue never rely on color to differ.
 */
import { registerVioletIcon } from '@lushly-dev/violet-elements';
import type { Status } from '../report/types';
import { STATUS_PRESENTATION } from '../report/view';

const svg = (body: string) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** Shapes keyed by status; names come from STATUS_PRESENTATION. */
export const STATUS_SHAPES: Record<Status, string> = {
	passed: svg('<path d="M5 12.5L10 17.5L19 7"/>'),
	failed: svg('<path d="M6.5 6.5L17.5 17.5"/><path d="M17.5 6.5L6.5 17.5"/>'),
	warn: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12.5"/><path d="M12 16.25V16.5"/>'),
	skipped: svg('<path d="M5 6.5L10.5 12L5 17.5"/><path d="M12.5 6.5L18 12L12.5 17.5"/>'),
	unavailable: svg('<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>'),
	error: svg('<path d="M12 3.5L21 19.5H3Z"/><path d="M12 9.5V14"/><path d="M12 17V17.25"/>'),
};

export function registerStatusIcons(): void {
	for (const [status, markup] of Object.entries(STATUS_SHAPES) as [Status, string][]) {
		const name = STATUS_PRESENTATION[status].icon;
		registerVioletIcon({
			name,
			sourceId: 'health-dashboard',
			originalFile: `${status}.svg`,
			svg: markup,
		});
	}
}
