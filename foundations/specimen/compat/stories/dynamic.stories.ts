import type { Meta, StoryObj } from '@storybook/web-components-vite';
import '../elements/plain-button.js';

// Stories built by a factory: their identity is static, their annotations are not.
const meta = { title: 'Fixtures/Dynamic', component: 'plain-button' } satisfies Meta;

export default meta;
type Story = StoryObj;

function labelled(label: string): Story {
	return { name: `Made: ${label}`, args: { label } };
}

export const Made: Story = labelled('Made');
export const Extended: Story = { ...labelled('Extended'), args: { label: 'Own args' } };
