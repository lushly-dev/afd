import { describe, expect, it } from 'vitest';
import { sentences } from './cards.js';

describe('sentences', () => {
	it('ends the message and the suggestion with one period each', () => {
		expect(sentences('A project already has that slug', 'Choose another.')).toBe(
			'A project already has that slug. Choose another.'
		);
		expect(sentences('That did not work.')).toBe('That did not work.');
	});

	it('removes only one trailing period, so an ellipsis inside or at the end stays (N4)', () => {
		expect(sentences('It returned failure(...)', 'Read the app.. log.')).toBe(
			'It returned failure(...). Read the app.. log.'
		);
		expect(sentences('Still loading...', 'Wait...')).toBe('Still loading... Wait...');
	});

	it('adds no period after a sentence that ends in !, ? or …', () => {
		expect(sentences('It stopped!', 'Try again?')).toBe('It stopped! Try again?');
		expect(sentences('Still waiting…', 'Report this to the app’s owner')).toBe(
			'Still waiting… Report this to the app’s owner.'
		);
	});
});
