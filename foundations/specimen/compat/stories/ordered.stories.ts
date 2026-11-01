import type { Meta, StoryObj } from '@storybook/web-components-vite';
import '../elements/plain-button.js';

// An explicit component id and export order.
const meta = {
	title: 'Fixtures/Ordered',
	id: 'fixtures-custom-id',
	component: 'plain-button',
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Alpha: Story = { args: { label: 'Alpha' } };
export const Beta: Story = { args: { label: 'Beta' } };
export const __namedExportsOrder = ['Beta', 'Alpha'];
