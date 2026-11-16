/**
 * JSX types for the violet elements the page renders. React 19 sets a prop as a property when the
 * element has one (`value`, `checked`, `open`) and as an attribute otherwise. Native events that
 * bubble (`onClick`, `onKeyDown`) work as props; the elements' own events (`change`, `approve`,
 * `dismiss`, `request-close`) are wired with `useElementEvents`.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type VioletProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
	[attribute: string]: unknown;
};

declare module 'react' {
	namespace JSX {
		interface IntrinsicElements {
			'violet-alert': VioletProps;
			'violet-approval-card': VioletProps;
			'violet-badge': VioletProps;
			'violet-button': VioletProps;
			'violet-checkbox': VioletProps;
			'violet-dialog': VioletProps;
			'violet-empty-state': VioletProps;
			'violet-option': VioletProps;
			'violet-progress': VioletProps;
			'violet-segment': VioletProps;
			'violet-segmented-control': VioletProps;
			'violet-select': VioletProps;
			'violet-snackbar': VioletProps;
			'violet-source-citation': VioletProps;
			'violet-text-field': VioletProps;
			'violet-tool-call-card': VioletProps;
		}
	}
}
