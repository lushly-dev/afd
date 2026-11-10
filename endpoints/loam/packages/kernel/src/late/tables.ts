/**
 * @fileoverview Phase 3's table names, in `late/`, where their only readers and writers load (13).
 */

/**
 * Phase 3's workspace tables (phase 3 specification, 12): `persona`, listed by `person`, and
 * `agent-member`, listed by `sponsor`. A store keys rows by table and id alone, so each is "indexed" by a
 * `list` filter on that field, which both adapters answer (`scope/identity.test.ts`).
 */
export const PERSONA_TABLE = 'persona';
export const AGENT_MEMBER_TABLE = 'agent-member';
