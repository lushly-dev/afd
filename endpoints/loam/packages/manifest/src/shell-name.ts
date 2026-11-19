/**
 * @fileoverview The shell's name in a title (phase 4 specification, 6.6 and 12.1): no app's title, nor any name the
 * shell shows as an app's, may say "Loam" as a word, so nothing an app shows passes for the shell's. One rule for the
 * manifest's `MANIFEST_TITLE_RESERVED`, the deployment's `DEPLOYMENT_TITLE_RESERVED` and the kernel's owner line.
 */

/** Invisible format characters (Unicode's `Cf`: U+200B, U+200D, U+2060, U+FEFF, the bidirectional marks and more). */
const FORMAT = /\p{Cf}/gu;

/** "Loam" between non-letters and non-digits, once `_` counts as a separator. */
const WORD = /(^|[^\p{L}\p{N}])loam($|[^\p{L}\p{N}])/u;

/**
 * Whether `text` says "Loam" as a word: after NFKC (so full-width and other compatibility forms read as plain
 * letters), with invisible format characters removed (so `Lo​am` reads `Loam`) and `_` read as a separator (so
 * `Loam_Notes` says it), case-insensitively. `Loamy` and `Loam2` do not.
 */
export function saysShellName(text: string): boolean {
	const plain = text.normalize('NFKC').replace(FORMAT, '').replace(/_/g, ' ').toLowerCase();
	return WORD.test(plain);
}
