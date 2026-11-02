import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect } from 'storybook/test';
import { claim } from '../../src/evidence.js';
import '../elements/fixture-field.js';
import '../elements/plain-button.js';

// A play linking its assertions to what they prove. Storybook runs them too: `claim` does nothing
// there, so these end the same way in both runners.
const meta = { title: 'Fixtures/Claims' } satisfies Meta;
export default meta;
type Story = StoryObj;

export const DisabledInPlay: Story = {
	render: () => {
		const button = document.createElement('plain-button');
		button.setAttribute('disabled', '');
		return button;
	},
	play: async ({ canvasElement }) => {
		const button = canvasElement.querySelector('plain-button') as Element;
		await expect(button.hasAttribute('disabled')).toBe(true);
		claim(button, 'property:disabled=true', 'has-disabled');
	},
};

/** A play's word is not form evidence: with no real FormData in the run, this stays asserted. */
export const FormInPlay: Story = {
	render: () => document.createElement('fixture-field'),
	play: async ({ canvasElement }) => {
		const field = canvasElement.querySelector('fixture-field') as Element;
		await expect(field.localName).toBe('fixture-field');
		claim(field, 'form:participation', 'in-a-form');
	},
};

/** The same claim, when the play really read the form: the run saw it, so it counts. */
export const FormReadInPlay: Story = {
	render: () => {
		const form = document.createElement('form');
		form.append(document.createElement('fixture-field'));
		return form;
	},
	play: async ({ canvasElement }) => {
		const form = canvasElement.querySelector('form') as HTMLFormElement;
		const field = form.querySelector('fixture-field') as Element;
		await expect(new FormData(form) instanceof FormData).toBe(true);
		claim(field, 'form:participation', 'read-the-form');
	},
};

/** A claim about a state its target is not in is reported, and credits nothing. */
export const FalseInPlay: Story = {
	render: () => document.createElement('plain-button'),
	play: async ({ canvasElement }) => {
		const button = canvasElement.querySelector('plain-button') as Element;
		await expect(button.localName).toBe('plain-button');
		claim(button, 'property:disabled=false', 'not-disabled');
		claim(button, 'property:disabled=true', 'never-disabled');
	},
};
