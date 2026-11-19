/**
 * @fileoverview The shell's ask of the editor area to save, when a person's save binding is a sequence whose second key
 * the area cannot read as save (phase 4 specification, 8.1): first paint's `SAVE_ASKED_EVENT`, repeated so the
 * `editor` chunk imports nothing of first paint (phase 3 specification, 13); `keyboard.test.ts` holds the two equal.
 */

export const SAVE_ASKED = 'loam-save-asked';
