import { describe, expect, it } from 'vitest';
import { saysShellName } from './shell-name.js';

describe('saysShellName (phase 4 specification, 6.6, 12.1)', () => {
	it.each([
		'Loam',
		'Loam Notes',
		'my loam',
		'LOAM-notes',
		'Loam_Notes',
		'notes_loam',
		'Lo' + String.fromCharCode(0x200b) + 'am',
		'Lo' + String.fromCharCode(0x2060) + 'am notes',
		String.fromCharCode(0xff2c) +
			String.fromCharCode(0xff4f) +
			String.fromCharCode(0xff41) +
			String.fromCharCode(0xff4d),
		'(Loam)',
	])('takes %j to say the shell’s name', (text) => {
		expect(saysShellName(text)).toBe(true);
	});

	it.each(['Loamy notes', 'Loam2', 'Gloam', 'Notes', '', 'lo am'])('takes %j not to', (text) => {
		expect(saysShellName(text)).toBe(false);
	});
});
