import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect } from 'storybook/test';
import { claim } from '../../src/evidence.js';
import '../elements/plain-button.js';

// A play's guide claims: each carries the check that `claim()` runs, and only a check that holds
// verifies its statement. Under Storybook `claim()` records nothing and still runs the check.
const meta = { title: 'Fixtures/Guide claims' } satisfies Meta;
export default meta;
type Story = StoryObj;

const button = (canvasElement: HTMLElement) =>
	canvasElement.querySelector('plain-button') as HTMLElement & { label: string };

/** Its check holds, so the statement is verified. */
export const Labelled: Story = {
	render: () => {
		const element = document.createElement('plain-button') as HTMLElement & { label: string };
		element.label = 'Save';
		return element;
	},
	play: async ({ canvasElement }) => {
		const element = button(canvasElement);
		await claim(element, 'guide:plain-button.label', 'says-save', () =>
			expect(element.shadowRoot?.textContent).toBe('Save')
		);
		await claim(element, 'guide:plain-button.disabled-attribute', 'no-attribute', () =>
			expect(element.hasAttribute('disabled')).toBe(false)
		);
	},
};

/** Its check throws: the story fails, and the statement stays authored. */
export const FocusFails: Story = {
	render: () => document.createElement('plain-button'),
	play: async ({ canvasElement }) => {
		const element = button(canvasElement);
		await claim(element, 'guide:plain-button.focus', 'takes-focus', () =>
			expect(element.matches(':focus')).toBe(true)
		);
	},
};

/** Without a check a guide claim is the author's word, so it is invalid; so is an unknown id. */
export const Unchecked: Story = {
	render: () => document.createElement('plain-button'),
	play: async ({ canvasElement }) => {
		const element = button(canvasElement);
		await expect(element.localName).toBe('plain-button');
		claim(element, 'guide:plain-button.focus', 'said-so');
		await claim(element, 'guide:plain-button.nope', 'nothing', () => undefined);
	},
};
