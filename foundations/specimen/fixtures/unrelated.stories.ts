throw new Error('unrelated-module-executed');

export const Unrelated = {
	render: () => document.createElement('div'),
};
