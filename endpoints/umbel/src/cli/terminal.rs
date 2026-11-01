//! Make server-controlled text safe to print to a terminal.
//!
//! A command decides the text of its error messages, suggestions and data. Printed raw, an escape
//! sequence in any of them can set the window title (OSC 0 and 2), plant a hyperlink (OSC 8),
//! write the clipboard (OSC 52), move the cursor over earlier output (CSI) or reset the terminal.
//! Text mode passes every such string through [`sanitize`]. JSON mode needs no cleaning, because
//! JSON escapes control characters.
//!
//! This is `sanitizeForTerminal` from `packages/cli/src/terminal.ts`, rule for rule.

const ESC: char = '\u{1b}';
const BEL: char = '\u{07}';
const C1_CSI: char = '\u{9b}';
const C1_ST: char = '\u{9c}';

fn is_c1(c: char) -> bool {
    ('\u{80}'..='\u{9f}').contains(&c)
}

/// A C1 string introducer: DCS, SOS, OSC, PM or APC.
fn is_c1_string_introducer(c: char) -> bool {
    matches!(c, '\u{90}' | '\u{98}' | '\u{9d}' | '\u{9e}' | '\u{9f}')
}

/// The second character of a 7-bit string sequence: OSC `]`, DCS `P`, SOS `X`, PM `^`, APC `_`.
fn is_string_introducer(c: char) -> bool {
    matches!(c, ']' | 'P' | 'X' | '^' | '_')
}

/// End of a CSI sequence whose parameters start at `start`: parameter bytes (0x30 to 0x3F),
/// intermediate bytes (0x20 to 0x2F), then one final byte (0x40 to 0x7E). A malformed sequence
/// ends before the first unexpected character.
fn skip_csi(chars: &[char], start: usize) -> usize {
    let mut i = start;
    while let Some(&c) = chars.get(i) {
        let code = u32::from(c);
        if (0x20..=0x3f).contains(&code) {
            i += 1;
            continue;
        }
        return if (0x40..=0x7e).contains(&code) {
            i + 1
        } else {
            i
        };
    }
    i
}

/// End of a string sequence whose payload starts at `start`, including its BEL or ST terminator.
/// An unterminated sequence returns `start`, so only the introducer is dropped and the payload
/// prints as plain text (its control characters are still removed).
fn skip_string(chars: &[char], start: usize) -> usize {
    let mut i = start;
    while let Some(&c) = chars.get(i) {
        if c == BEL || c == C1_ST {
            return i + 1;
        }
        if c == ESC {
            return if chars.get(i + 1) == Some(&'\\') {
                i + 2
            } else {
                start
            };
        }
        i += 1;
    }
    start
}

/// End of the escape or control sequence that starts at `start`.
fn skip_control_sequence(chars: &[char], start: usize) -> usize {
    let c = chars[start];
    if c != ESC {
        if c == C1_CSI {
            return skip_csi(chars, start + 1);
        }
        if is_c1_string_introducer(c) {
            return skip_string(chars, start + 1);
        }
        return start + 1;
    }
    match chars.get(start + 1) {
        Some('[') => return skip_csi(chars, start + 2),
        Some(&next) if is_string_introducer(next) => return skip_string(chars, start + 2),
        _ => {}
    }
    // nF sequences (such as `ESC ( 0` charset selection): intermediates, then a final byte.
    let mut i = start + 1;
    while chars
        .get(i)
        .is_some_and(|c| (0x20..=0x2f).contains(&u32::from(*c)))
    {
        i += 1;
    }
    match chars.get(i) {
        // Fp, Fe and Fs (such as `ESC c` reset and `ESC 7` save cursor), or the end of an nF.
        Some(c) if (0x30..=0x7e).contains(&u32::from(*c)) => i + 1,
        _ => i,
    }
}

/// Remove terminal control characters and escape sequences from `text`.
///
/// Removes every C0 control except newline and tab (so CR and backspace, which can overwrite a
/// line, go), DEL, every C1 control, and complete ESC and C1 sequences: CSI (cursor movement,
/// erase, colours), OSC (title, hyperlinks, clipboard), DCS, SOS, PM and APC strings, and
/// two-byte escapes. Visible text, including non-ASCII characters, is kept.
pub(crate) fn sanitize(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == ESC || is_c1(c) {
            i = skip_control_sequence(&chars, i);
            continue;
        }
        if (c < ' ' && c != '\n' && c != '\t') || c == '\u{7f}' {
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn plain_text_passes_through() {
        assert_eq!(sanitize("héllo\tworld\nnext ✓"), "héllo\tworld\nnext ✓");
    }

    #[test]
    fn c0_controls_other_than_newline_and_tab_are_removed() {
        assert_eq!(sanitize("a\rb\u{8}c\u{0}d\u{7f}e"), "abcde");
    }

    #[test]
    fn csi_sequences_are_removed() {
        assert_eq!(sanitize("\u{1b}[31mred\u{1b}[0m"), "red");
        assert_eq!(sanitize("a\u{1b}[2K\u{1b}[1Gb"), "ab");
        assert_eq!(sanitize("a\u{9b}31mb"), "ab");
    }

    #[test]
    fn osc_sequences_are_removed_with_either_terminator() {
        assert_eq!(sanitize("a\u{1b}]0;title\u{7}b"), "ab");
        assert_eq!(sanitize("a\u{1b}]52;c;AAAA\u{1b}\\b"), "ab");
        assert_eq!(
            sanitize("\u{1b}]8;;http://x\u{7}link\u{1b}]8;;\u{7}"),
            "link"
        );
        assert_eq!(sanitize("a\u{9d}0;title\u{9c}b"), "ab");
    }

    #[test]
    fn other_string_sequences_are_removed() {
        assert_eq!(sanitize("a\u{1b}Pdata\u{1b}\\b"), "ab");
        assert_eq!(sanitize("a\u{1b}_apc\u{7}b"), "ab");
        assert_eq!(sanitize("a\u{1b}^pm\u{7}b"), "ab");
        assert_eq!(sanitize("a\u{1b}Xsos\u{7}b"), "ab");
    }

    #[test]
    fn an_unterminated_string_drops_only_its_introducer() {
        assert_eq!(sanitize("a\u{1b}]0;title"), "a0;title");
    }

    #[test]
    fn two_byte_and_nf_escapes_are_removed() {
        assert_eq!(sanitize("a\u{1b}cb"), "ab");
        assert_eq!(sanitize("a\u{1b}7b"), "ab");
        assert_eq!(sanitize("a\u{1b}(0b"), "ab");
    }

    #[test]
    fn c1_controls_are_removed() {
        assert_eq!(sanitize("a\u{85}b\u{80}c"), "abc");
    }

    #[test]
    fn a_lone_escape_at_the_end_is_removed() {
        assert_eq!(sanitize("a\u{1b}"), "a");
        assert_eq!(sanitize("a\u{1b}["), "a");
    }
}
