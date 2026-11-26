/**
 * @fileoverview The skill catalog part of `afd validate --surface`: reads the server's
 * `skills/list` manifest (spec/mcp-resources.md, S3) and checks it against Claude Code's limits.
 */

import {
	checkClaudeCodeSkillLimits,
	type SkillLimitFinding,
	type SkillManifestEntry,
} from '@lushly-dev/afd-testing';

/** What the skill check needs of a client. */
export interface SkillsClient {
	request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
	/** The server's capabilities, when the client has them. */
	getStatus?(): { capabilities: unknown };
}

/** The Skills extension's identifier, which a server with a catalog declares (S1). */
const SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills';

/** Whether the server's capabilities declare a skill catalog, or are not known. */
function skillsDeclared(client: SkillsClient): 'declared' | 'absent' | 'unknown' {
	const capabilities = client.getStatus?.().capabilities;
	if (!capabilities || typeof capabilities !== 'object') return 'unknown';
	const extensions = (capabilities as { extensions?: unknown }).extensions;
	return typeof extensions === 'object' &&
		extensions !== null &&
		SKILLS_EXTENSION_ID in (extensions as Record<string, unknown>)
		? 'declared'
		: 'absent';
}

/** The result of checking a server's skill catalog. */
export interface SkillCatalogCheck {
	/** Skills the server listed; `undefined` when it serves no catalog or could not be read. */
	skillCount?: number;
	/** Every finding, `suppressed` set on those `--suppress` names. */
	findings: Array<SkillLimitFinding & { suppressed: boolean }>;
	/** Why the catalog could not be read, when it could not. */
	warning?: string;
}

/** JSON-RPC "method not found": a server with no catalog (S1). */
const METHOD_NOT_FOUND = -32601;

/** The most `skills/list` pages read before the check gives up. */
const MAX_PAGES = 50;

/** A rule name, or `rule:skill`, as `--suppress` takes it. */
function isSuppressed(finding: SkillLimitFinding, suppressions: readonly string[]): boolean {
	return (
		suppressions.includes(finding.rule) || suppressions.includes(`${finding.rule}:${finding.skill}`)
	);
}

/**
 * Read `skills/list` and check it against Claude Code's limits. A server whose capabilities
 * declare no `io.modelcontextprotocol/skills`, or that answers method-not-found, serves no
 * catalog, which is not a finding.
 */
export async function checkSkillCatalog(
	client: SkillsClient,
	suppressions: readonly string[] = []
): Promise<SkillCatalogCheck> {
	const declared = skillsDeclared(client);
	if (declared === 'absent') return { findings: [] };
	const skills: unknown[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined;
	for (let page = 0; ; page++) {
		let listed: unknown;
		try {
			listed = await client.request('skills/list', cursor === undefined ? {} : { cursor });
		} catch (error) {
			// The client's JsonRpcResponseError carries the code; read it by shape, so a second copy
			// of the client package still counts.
			if (page === 0 && (error as { code?: unknown } | null)?.code === METHOD_NOT_FOUND) {
				// A legacy endpoint (an AFD server's /message) can declare the extension and still
				// not route skills/list.
				return declared === 'declared'
					? {
							findings: [],
							warning: `The server declares ${SKILLS_EXTENSION_ID} but this connection does not serve skills/list, so its skills were not checked; connect to its MCP endpoint (/mcp on an AFD server)`,
						}
					: { findings: [] };
			}
			const reason = error instanceof Error ? error.message : String(error);
			return { findings: [], warning: `Could not read the skill catalog (skills/list): ${reason}` };
		}
		const result = listed as { skills?: unknown; nextCursor?: unknown } | undefined;
		if (!Array.isArray(result?.skills)) {
			return {
				findings: [],
				warning: 'The skill catalog (skills/list) has no skills array; its skills were not checked',
			};
		}
		skills.push(...result.skills);
		const next = result.nextCursor;
		if (typeof next !== 'string' || next.length === 0) break;
		if (seen.has(next) || page + 1 >= MAX_PAGES) {
			return {
				findings: [],
				warning: `The skill catalog (skills/list) did not end within ${MAX_PAGES} pages; its skills were not checked`,
			};
		}
		seen.add(next);
		cursor = next;
	}

	// Every entry counts toward the server's 100; one without a uri is named by its position.
	let unchecked = 0;
	const entries: SkillManifestEntry[] = skills.map((entry, index) => {
		if (
			typeof entry !== 'object' ||
			entry === null ||
			typeof (entry as { uri?: unknown }).uri !== 'string'
		) {
			unchecked += 1;
			return { uri: `skills/list entry ${index + 1}`, resources: [] };
		}
		const resources = (entry as SkillManifestEntry).resources;
		if (Array.isArray(resources)) {
			unchecked += resources.filter(
				(resource) =>
					typeof resource !== 'object' ||
					resource === null ||
					typeof (resource as { uri?: unknown }).uri !== 'string'
			).length;
		}
		return entry as SkillManifestEntry;
	});
	return {
		skillCount: skills.length,
		findings: checkClaudeCodeSkillLimits(entries).map((finding) => ({
			...finding,
			suppressed: isSuppressed(finding, suppressions),
		})),
		...(unchecked > 0
			? {
					warning: `${unchecked} skills/list entries or manifest files have no uri and were not checked`,
				}
			: {}),
	};
}
