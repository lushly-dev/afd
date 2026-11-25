/**
 * @fileoverview Conformance tests loading every section of `spec/authorization-client.json`
 * (`spec/authorization.md`, M9).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redactHeaderValue, redactUrl } from './credentials.js';
import {
	authorizationServerMetadataUrls,
	canonicalResourceUri,
	isClientIdMetadataDocumentUrl,
	parseWwwAuthenticate,
	pkceChallengeS256,
	protectedResourceMetadataUrls,
	sameOrigin,
} from './oauth-protocol.js';

interface ClientCases {
	wwwAuthenticate: {
		description: string;
		header: string;
		expected: Record<string, unknown> | null;
	}[];
	protectedResourceMetadataUrls: {
		description: string;
		resource: string;
		urls: string[];
	}[];
	authorizationServerMetadataUrls: {
		description: string;
		issuer: string;
		urls: string[];
	}[];
	pkceS256: {
		description: string;
		verifier: string;
		challenge: string;
	}[];
	clientIdMetadataDocuments: {
		description: string;
		clientId: string;
		valid: boolean;
	}[];
	resourceValidation: {
		description: string;
		serverUrl: string;
		expectedCanonical?: string;
		resourceMetadata?: string;
		sameOrigin?: boolean;
	}[];
	redaction: {
		description: string;
		kind: 'url' | 'header';
		input?: string;
		name?: string;
		value?: string;
		expected: string;
	}[];
}

const raw = JSON.parse(
	readFileSync(new URL('../../../spec/authorization-client.json', import.meta.url), 'utf8')
) as ClientCases & Record<string, unknown>;

const EXPECTED_SECTIONS = [
	'authorizationServerMetadataUrls',
	'clientIdMetadataDocuments',
	'pkceS256',
	'protectedResourceMetadataUrls',
	'redaction',
	'resourceValidation',
	'wwwAuthenticate',
];

describe('spec/authorization-client.json (M9)', () => {
	it('loads every section in the vector file', () => {
		const arrayKeys = Object.entries(raw)
			.filter(([, v]) => Array.isArray(v))
			.map(([k]) => k)
			.sort();
		expect(arrayKeys).toEqual(EXPECTED_SECTIONS);
	});

	describe('wwwAuthenticate', () => {
		it.each(raw.wwwAuthenticate)('$description', ({ header, expected }) => {
			expect(parseWwwAuthenticate(header)).toEqual(expected);
		});
	});

	describe('protectedResourceMetadataUrls', () => {
		it.each(raw.protectedResourceMetadataUrls)('$description', ({ resource, urls }) => {
			expect(protectedResourceMetadataUrls(resource)).toEqual(urls);
		});
	});

	describe('authorizationServerMetadataUrls', () => {
		it.each(raw.authorizationServerMetadataUrls)('$description', ({ issuer, urls }) => {
			expect(authorizationServerMetadataUrls(issuer)).toEqual(urls);
		});
	});

	describe('pkceS256', () => {
		it.each(raw.pkceS256)('$description', ({ verifier, challenge }) => {
			expect(pkceChallengeS256(verifier)).toBe(challenge);
		});
	});

	describe('clientIdMetadataDocuments', () => {
		it.each(raw.clientIdMetadataDocuments)('$description', ({ clientId, valid }) => {
			expect(isClientIdMetadataDocumentUrl(clientId)).toBe(valid);
		});
	});

	describe('resourceValidation', () => {
		it.each(raw.resourceValidation)('$description', (entry) => {
			if (entry.expectedCanonical !== undefined) {
				expect(canonicalResourceUri(entry.serverUrl)).toBe(entry.expectedCanonical);
			}
			if (entry.resourceMetadata !== undefined && entry.sameOrigin !== undefined) {
				expect(sameOrigin(entry.serverUrl, entry.resourceMetadata)).toBe(entry.sameOrigin);
			}
		});
	});

	describe('redaction', () => {
		it.each(raw.redaction)('$description', (entry) => {
			if (entry.kind === 'url') {
				expect(redactUrl(entry.input as string)).toBe(entry.expected);
			} else {
				expect(redactHeaderValue(entry.name as string, entry.value as string)).toBe(entry.expected);
			}
		});
	});
});
