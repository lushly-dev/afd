import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { mountNotesApp } from './notes-app.js';

export const NotesApp: SpecimenDefinition = {
	targets: {
		app: { selector: '#notes-app' },
		draft: { selector: '#draft-input' },
	},
	render() {
		return mountNotesApp('comfortable');
	},
};

export const NotesAppCompact: SpecimenDefinition = {
	targets: {
		app: { selector: '#notes-app' },
		draft: { selector: '#draft-input' },
	},
	render() {
		return mountNotesApp('compact');
	},
};

export const DirectCommandApp: SpecimenDefinition = {
	targets: {
		app: { selector: '#notes-app' },
	},
	render() {
		return mountNotesApp('comfortable');
	},
	scenario: [
		{
			id: 'create-note',
			command: {
				runner: 'afd',
				name: 'note-create',
				target: 'app',
				input: { title: 'Direct dispatch' },
			},
		},
		{ capture: 'created' },
	],
};
