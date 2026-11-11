import type { Meta, StoryObj } from '@storybook/web-components-vite';

// In a file of its own: every story in a file loads its module, so all of them would fail.
void Promise.reject(new Error('planted module rejection'));

const meta = { title: 'Fixtures/Page Errors/Module' } satisfies Meta;

export default meta;

export const RejectsAsItLoads: StoryObj = {
	render: () => {
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Planted';
		return paragraph;
	},
};
