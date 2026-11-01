import type { Meta, StoryObj } from '@storybook/web-components-vite';
import '../elements/plain-button.js';

// Identity rules: export-name start case, explicit names, tags and excluded exports.
const meta = {
	title: 'Fixtures/Identity Cases',
	component: 'plain-button',
	tags: ['fixture'],
	excludeStories: /^(helperData|internal)/,
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const helperData = { label: 'Not a story' };
export const internalCase: Story = {};
export const Primary: Story = { args: { label: 'Save' } };
export const WithURLAndH1Heading2x: Story = { args: { label: 'Acronyms' } };
export const snake_case_name: Story = { args: { label: 'Snake' } };
export const Named: Story = { name: 'Explicit display name', args: { label: 'Named' } };
export const Tagged: Story = { tags: ['!autodocs', 'extra'], args: { label: 'Tagged' } };
const base = { args: { label: 'Base' } };
export const Spread: Story = { ...base, name: 'From a spread' };
export function FunctionStory() {
	const button = document.createElement('plain-button');
	button.label = 'Function';
	return button;
}
