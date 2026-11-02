import { expect, fn, spyOn, userEvent, waitFor, within } from '../../src/test.js';
import type { Meta, StoryObj } from '../../src/types.js';

// The same stories under both runners with Specimen's helpers and types, and none of Storybook's:
// each helper a play uses, with jest-dom's matchers and the shapes `expect` has to get right.
type Args = { label: string; onPress?: () => void };

const meta: Meta<Args> = {
	title: 'Fixtures/Native',
	args: { label: 'Press' },
	render: ({ label, onPress }) => {
		const button = document.createElement('button');
		button.textContent = label;
		if (onPress) button.addEventListener('click', onPress);
		return button;
	},
};
export default meta;
type Story = StoryObj<Args>;

export const JestDomMatchers: Story = {
	play: async ({ canvasElement }) => {
		const button = within(canvasElement).getByRole('button', { name: 'Press' });
		await expect(button).toBeInTheDocument();
		await expect(button).toBeVisible();
		await expect(button).toHaveTextContent('Press');
		await expect(button).not.toHaveAttribute('disabled');
		await expect(button).toHaveAccessibleName('Press');
	},
};

export const SpiesAndUserEvents: Story = {
	args: { onPress: fn() },
	play: async ({ args, canvasElement }) => {
		const button = within(canvasElement).getByRole('button');
		await userEvent.click(button);
		await expect(args.onPress).toHaveBeenCalledOnce();
		await userEvent.keyboard('{Enter}');
		await expect(args.onPress).toHaveBeenCalledTimes(2);
		const spy = spyOn(button, 'focus');
		button.focus();
		await expect(spy).toHaveBeenCalled();
	},
};

export const TypingAndWaiting: Story = {
	render: () => {
		const input = document.createElement('input');
		input.setAttribute('aria-label', 'Name');
		const echo = document.createElement('output');
		input.addEventListener('input', () => {
			setTimeout(() => {
				echo.textContent = input.value;
			}, 20);
		});
		const root = document.createElement('div');
		root.append(input, echo);
		return root;
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox'), 'Lavender');
		await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Lavender'));
		await expect(canvas.getByRole('textbox')).toHaveValue('Lavender');
	},
};

export const AsymmetricAndStructural: Story = {
	play: async () => {
		await expect({ a: 1, b: [2, { c: 3 }] }).toEqual({
			a: expect.any(Number),
			b: expect.arrayContaining([2]),
		});
		await expect('Specimen').toMatch(/spec/i);
		await expect([1, 2]).toContain(2);
		await expect(() => {
			throw new Error('Refused');
		}).toThrow('Refused');
		await expect(Promise.resolve(1)).resolves.toBe(1);
	},
};
