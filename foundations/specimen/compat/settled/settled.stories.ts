import type { Meta, StoryObj } from '@storybook/web-components-vite';
import '../elements/late-style.js';

// Each story dims its text one frame after it renders. Storybook's check, and Specimen's at the
// same moment, sees the text before it dims; the settled check sees it after.
const meta = {
	title: 'Fixtures/Settled',
} satisfies Meta;

export default meta;
type Story = StoryObj;

/**
 * Never changes after it renders. First, because Storybook's first story in a file fetches axe
 * and lets a frame through, which would show it a later story's settled state.
 */
export const Steady: Story = {
	render: () => {
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Fixture text';
		return paragraph;
	},
};

/** Dimmed below 4.5:1 on its next frame: only the settled check finds it. */
export const LateContrast: Story = {
	render: () => document.createElement('late-style'),
};

/** Dimmed the same way, but disabled through `aria-disabled`, which WCAG and axe exempt. */
export const LateDisabled: Story = {
	render: () => {
		const element = document.createElement('late-style');
		element.setAttribute('disabled', '');
		return element;
	},
};
