import type { StorybookConfig } from '@storybook/web-components-vite';

// Deliberately failing fixtures, kept out of the passing project: both runners must report them.
const config: StorybookConfig = {
	stories: ['../*.stories.ts'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: { name: '@storybook/web-components-vite', options: {} },
	core: { disableTelemetry: true },
};

export default config;
