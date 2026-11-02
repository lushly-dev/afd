import { expect } from 'storybook/test';
import '../elements.js';

const meta = {
	title: 'Contract/x-form-good',
	tags: ['autodocs'],
	parameters: { docs: { description: { component: 'A fixture.' } } },
};
export default meta;
export const Default = {
	render: () => {
		const form = document.createElement('form');
		form.innerHTML = '<x-form-good name="crop"></x-form-good>';
		return form;
	},
	play: async ({ canvasElement }) => {
		const form = canvasElement.querySelector('form') as HTMLFormElement;
		await expect(new FormData(form).get('crop')).toBe('Water');
		const field = form.querySelector('x-form-good') as HTMLElement & { checkValidity(): boolean };
		await expect(field.checkValidity()).toBe(false);
	},
};
