/**
 * Claude Code's limits on MCP skills, against the shared vectors in skill-limits-vectors.json.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	CLAUDE_CODE_SKILL_LIMITS,
	checkClaudeCodeSkillLimits,
	type SkillManifestEntry,
} from './skill-limits.js';

interface Vector {
	name: string;
	entries: SkillManifestEntry[];
	generate?: { skills: number };
	expect: Array<{ rule: string; skill: string; file?: string }>;
}

const vectors = (
	JSON.parse(readFileSync(new URL('./skill-limits-vectors.json', import.meta.url), 'utf8')) as {
		cases: Vector[];
	}
).cases;

function skill(name: string, size = 1000): SkillManifestEntry {
	return {
		uri: `skill://${name}/SKILL.md`,
		frontmatter: { name, description: name },
		resources: [{ uri: `skill://${name}/SKILL.md`, size }],
	};
}

describe("Claude Code's skill limits", () => {
	it.each(vectors)('$name', (vector) => {
		const generated = Array.from({ length: vector.generate?.skills ?? 0 }, (_, i) =>
			skill(`generated-${i}`)
		);
		const findings = checkClaudeCodeSkillLimits([...vector.entries, ...generated]);
		expect(
			findings.map(({ rule, skill, file }) => ({ rule, skill, ...(file ? { file } : {}) }))
		).toEqual(vector.expect);
		for (const finding of findings) {
			expect(finding.severity).toBe('warning');
			expect(finding.source).toBe('Claude Code');
			expect(finding.message).toContain(`'${finding.skill}'`);
		}
	});

	it('name the skill, the limit and Claude Code in a size warning', () => {
		const [finding] = checkClaudeCodeSkillLimits(vectors[1]?.entries ?? []);
		expect(finding).toMatchObject({
			rule: 'claude-code-file-size',
			skill: 'pdf-tools',
			file: 'references/api.md',
			evidence: { size: 100_001, limit: CLAUDE_CODE_SKILL_LIMITS.textFileBytes },
		});
		expect(finding?.message).toBe(
			"Skill 'pdf-tools': 'references/api.md' is 100,001 bytes, over Claude Code's limit of 100 KB a text file for a skill it scans"
		);
	});

	it('warn once about the skills past the 100th, naming the first of them', () => {
		expect(
			checkClaudeCodeSkillLimits(Array.from({ length: 100 }, (_, i) => skill(`s-${i}`)))
		).toEqual([]);

		const entries = Array.from({ length: 108 }, (_, i) => skill(`s-${i}`));
		const findings = checkClaudeCodeSkillLimits(entries);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			rule: 'claude-code-skill-count',
			skill: 's-100',
			evidence: {
				count: 108,
				limit: 100,
				skills: entries.slice(100).map((e) => e.frontmatter?.name),
			},
		});
		expect(findings[0]?.message).toBe(
			"The catalog has 108 skills; Claude Code shows up to 100 a server, so it may not show 's-100', 's-101', 's-102', 's-103', 's-104', and 3 more"
		);
	});

	it('count a dynamic skill, which lists no files, toward the 100 a server', () => {
		const entries: SkillManifestEntry[] = [
			...Array.from({ length: 100 }, (_, i) => skill(`s-${i}`)),
			{ uri: 'skill://live/SKILL.md', frontmatter: { name: 'live' }, resources: 'dynamic' },
		];
		expect(checkClaudeCodeSkillLimits(entries)).toEqual([
			expect.objectContaining({ rule: 'claude-code-skill-count', skill: 'live' }),
		]);
	});
});
