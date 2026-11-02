import type { StorybookConfig } from '@storybook/web-components-vite';

// The incumbent runner's configuration for the compatibility fixtures: Storybook's own
// indexer and Vitest addon are the reference Specimen's CSF adapter is compared with.
const config: StorybookConfig = {
	stories: ['../stories/**/*.stories.ts'],
	staticDirs: [{ from: '../public', to: '/fixture-static' }],
	addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: { name: '@storybook/web-components-vite', options: {} },
	core: { disableTelemetry: true },
};

export default config;
