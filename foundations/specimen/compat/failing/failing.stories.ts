import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect } from 'storybook/test';

// Each failing case fails both runners for the same reason; the passing cases around them
// show that one failure leaves nothing behind for the next story.
const meta = {
	title: 'Fixtures/Failing',
	render: () => {
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Fixture text';
		return paragraph;
	},
} satisfies Meta;

export default meta;
type Story = StoryObj;

function unlabelledImage(): HTMLElement {
	const image = document.createElement('img');
	image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
	image.width = 16;
	image.height = 16;
	return image;
}

/** An interaction failure: the play's assertion does not hold. */
export const InteractionFailure: Story = {
	play: async ({ canvasElement }) => {
		await expect(canvasElement.textContent).toBe('Different text');
	},
};

/** An accessibility failure under `a11y.test: 'error'`: an image without alternative text. */
export const AccessibilityFailure: Story = {
	render: unlabelledImage,
};

/** The same violation under `a11y.test: 'todo'`: reported, but the story passes. */
export const AccessibilityTodo: Story = {
	render: unlabelledImage,
	parameters: { a11y: { test: 'todo' } },
};

/** The same violation with the check off. */
export const AccessibilityOff: Story = {
	render: unlabelledImage,
	parameters: { a11y: { test: 'off' } },
};

/** A render that throws fails the story before any play. */
export const RenderFailure: Story = {
	render: () => {
		throw new Error('The fixture render failed');
	},
};

/** After the failures: nothing from an earlier story remains in the document. */
export const CleanAfterFailure: Story = {
	play: async () => {
		await expect(document.querySelectorAll('img')).toHaveLength(0);
		await expect(document.body.textContent).toContain('Fixture text');
	},
};

/** A viewport name no option defines: both runners render at the default size. */
export const UnknownViewport: Story = {
	globals: { viewport: { value: 'not-a-viewport' } },
	play: async () => {
		await expect(window.innerWidth).toBe(1200);
	},
};

/** A theme value the project's toolbar does not offer. */
export const UnknownTheme: Story = {
	globals: { theme: 'sepia' },
};
