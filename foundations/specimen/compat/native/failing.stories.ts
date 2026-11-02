import { expect, waitFor } from '../../src/test.js';
import type { Meta, StoryObj } from '../../src/types.js';

// Specimen's helpers fail a story as Storybook's do, in each way a play can.
const meta = {
	title: 'Fixtures/Failing Native',
	render: () => {
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Fixture text';
		return paragraph;
	},
} satisfies Meta;
export default meta;
type Story = StoryObj;

export const WrongValue: Story = {
	play: async ({ canvasElement }) => {
		await expect(canvasElement.textContent).toBe('Different text');
	},
};

export const JestDomMatcher: Story = {
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('p')).toHaveTextContent('Different text');
	},
};

export const NeverTrue: Story = {
	play: async ({ canvasElement }) => {
		await waitFor(() => expect(canvasElement.querySelector('button')).not.toBeNull(), {
			timeout: 100,
		});
	},
};
