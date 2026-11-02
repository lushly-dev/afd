import { expect } from 'storybook/test';
import '../elements.js';

const render =
	(attributes = '') =>
	() => {
		const box = document.createElement('div');
		box.innerHTML = `<x-no-play ${attributes}></x-no-play>`;
		return box;
	};
const meta = {
	title: 'Contract/x-no-play',
	tags: ['autodocs'],
	parameters: { docs: { description: { component: 'A fixture.' } } },
};
export default meta;
export const Default = { render: render() };
export const Disabled = { render: render('disabled') };
void expect;
