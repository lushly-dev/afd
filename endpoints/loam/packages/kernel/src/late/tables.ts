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

/**
 * The records an `agent-member-update` or `-remove` replaced, by an opaque undo id (phase 3 specification, 8.2): the
 * undo names that id alone, so its arguments never name a project hidden from the caller (step 6's review, I3). Read and
 * deleted only by the undo that names it.
 */
export const AGENT_MEMBER_UNDO_TABLE = 'agent-member-undo';
