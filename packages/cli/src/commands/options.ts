/**
 * @fileoverview Commander options shared by several commands.
 */

import { InvalidArgumentError, Option } from 'commander';
import type { CliTransport } from '../config.js';
import { HEADERS_ENV, parseHeader } from '../credentials.js';

export const TRANSPORTS: readonly CliTransport[] = ['sse', 'http'];

/**
 * Commander helper: collect repeatable option values into an array.
 */
export function collectValues(value: string, previous: string[]): string[] {
	return [...previous, value];
}

/** `-t, --transport <type>` limited to the supported transports. */
export function transportOption(
	description: string,
	defaultValue?: CliTransport,
	flags = '-t, --transport <type>'
): Option {
	const option = new Option(flags, description).choices(TRANSPORTS);
	return defaultValue ? option.default(defaultValue) : option;
}

/**
 * `-H, --header <header>`: a request header, repeatable. Each value is checked
 * when the command line is parsed. Headers are sent with every request and never
 * saved; `AFD_HEADERS` supplies the same headers from the environment.
 */
export function headerOption(): Option {
	return new Option(
		'-H, --header <header>',
		`Request header "Name: value", repeatable (never saved; also read from ${HEADERS_ENV})`
	).argParser((value: string, previous: string[] = []) => {
		try {
			parseHeader(value);
		} catch (error) {
			throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
		}
		return collectValues(value, previous);
	});
}
