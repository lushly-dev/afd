//! The real keyboard a retained play reaches through `vitest/browser`'s `userEvent.keyboard`.
//! The text is read as testing-library's key syntax, as Vitest reads it, and each key is sent as
//! Playwright's keyboard sends it, so the page gets trusted events and real focus navigation.

use crate::page::Page;
use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutKey {
    code: String,
    key: String,
    key_code_without_location: u32,
    shift_key: Option<String>,
    text: String,
    location: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    layout: Vec<LayoutKey>,
    mac_commands: HashMap<String, Vec<String>>,
    key_map: Vec<(String, String)>,
    pressed_keys: HashSet<String>,
}

fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("keyboard_data.json")).expect("the key tables parse")
    })
}

#[derive(Clone, Debug, PartialEq)]
struct Description {
    key: String,
    key_code: u32,
    code: String,
    text: String,
    location: u32,
    shifted: Option<Box<Description>>,
}

/// Playwright's `buildLayoutClosure`: each key by its code, aliases, key and shifted key.
fn layout() -> &'static HashMap<String, Description> {
    static LAYOUT: OnceLock<HashMap<String, Description>> = OnceLock::new();
    LAYOUT.get_or_init(|| {
        let aliases: HashMap<&str, &[&str]> = HashMap::from([
            ("ShiftLeft", &["Shift"][..]),
            ("ControlLeft", &["Control"][..]),
            ("AltLeft", &["Alt"][..]),
            ("MetaLeft", &["Meta"][..]),
            ("Enter", &["\n", "\r"][..]),
        ]);
        let mut result = HashMap::new();
        for definition in &data().layout {
            let single = definition.key.chars().count() == 1;
            let description = Description {
                key: definition.key.clone(),
                key_code: definition.key_code_without_location,
                code: definition.code.clone(),
                text: if single {
                    definition.key.clone()
                } else {
                    definition.text.clone()
                },
                location: definition.location,
                shifted: None,
            };
            let shifted = definition.shift_key.as_ref().map(|key| Description {
                key: key.clone(),
                text: key.clone(),
                ..description.clone()
            });
            result.insert(
                definition.code.clone(),
                Description {
                    shifted: shifted.clone().map(Box::new),
                    ..description.clone()
                },
            );
            for alias in aliases
                .get(definition.code.as_str())
                .copied()
                .unwrap_or(&[])
            {
                result.insert((*alias).to_string(), description.clone());
            }
            if definition.location != 0 {
                continue;
            }
            if single {
                result.insert(description.key.clone(), description.clone());
            }
            if let Some(shifted) = shifted {
                result.insert(shifted.key.clone(), shifted);
            }
        }
        result
    })
}

#[derive(Debug, PartialEq)]
struct Action {
    key: String,
    release_previous: bool,
    release_self: bool,
    repeat: u32,
}

fn expected(what: &str, found: Option<char>, text: &str) -> anyhow::Error {
    anyhow!(
        "Expected {what} but found \"{}\" in \"{text}\". See https://testing-library.com/docs/user-event/keyboard for how the keys are written.",
        found.map(String::from).unwrap_or_default()
    )
}

/// testing-library's `parseKeyDef`: `{key}` by key, `[code]` by code, anything else by character,
/// `{{` and `[[` for the bracket itself, `{key>}` held, `{key>3}` repeated and held, `{key>3/}`
/// repeated and released, and `{/key}` released.
fn parse(text: &str) -> Result<Vec<Action>> {
    let chars: Vec<char> = text.chars().collect();
    let mut actions = Vec::new();
    let mut pos = 0;
    while pos < chars.len() {
        let bracket = chars[pos];
        let closing = match bracket {
            '{' => Some('}'),
            '[' => Some(']'),
            _ => None,
        };
        let Some(closing) = closing.filter(|_| chars.get(pos + 1) != Some(&bracket)) else {
            // A printable character, or an escaped bracket, which takes both characters.
            let character = chars[pos].to_string();
            pos += if closing.is_some() { 2 } else { 1 };
            let key = data()
                .key_map
                .iter()
                .find(|(key, _)| *key == character)
                .map_or(character.clone(), |(key, _)| key.clone());
            actions.push(Action {
                key,
                release_previous: false,
                release_self: true,
                repeat: 1,
            });
            continue;
        };
        pos += 1;
        let release_previous = chars.get(pos) == Some(&'/');
        pos += usize::from(release_previous);
        let escaped = bracket == '{' && chars.get(pos) == Some(&'\\');
        pos += usize::from(escaped);
        let word = chars[pos..]
            .iter()
            .take_while(|c| c.is_ascii_alphanumeric() || **c == '_')
            .count();
        let length = if escaped {
            usize::from(pos < chars.len())
        } else if word > 0 {
            word
        } else if bracket == '{'
            && chars
                .get(pos)
                .is_some_and(|c| !matches!(*c, '}' | '>' | '/'))
        {
            1
        } else {
            0
        };
        if length == 0 {
            return Err(expected("key descriptor", chars.get(pos).copied(), text));
        }
        let descriptor: String = chars[pos..pos + length].iter().collect();
        pos += length;
        let digits = if chars.get(pos) == Some(&'>') {
            chars[pos + 1..]
                .iter()
                .take_while(|c| c.is_ascii_digit())
                .count()
        } else {
            0
        };
        let repeat = if digits > 0 {
            let value: String = chars[pos + 1..pos + 1 + digits].iter().collect();
            pos += digits + 1;
            Some(value.parse::<u32>().unwrap_or(1).max(1))
        } else {
            None
        };
        let modifier = match chars.get(pos) {
            Some('/') => Some('/'),
            Some('>') if repeat.is_none() => Some('>'),
            _ => None,
        };
        pos += usize::from(modifier.is_some());
        if chars.get(pos) != Some(&closing) {
            return Err(expected(
                &format!("\"{closing}\""),
                chars.get(pos).copied(),
                text,
            ));
        }
        pos += 1;
        let release_self = match (modifier, repeat) {
            (Some(modifier), _) => modifier == '/',
            (None, Some(_)) => false,
            (None, None) => true,
        };
        let map = &data().key_map;
        let key = if bracket == '[' {
            map.iter()
                .find(|(_, code)| *code == descriptor)
                .map_or("Unknown".to_string(), |(key, _)| key.clone())
        } else {
            let lower = descriptor.to_lowercase();
            map.iter()
                .find(|(key, _)| key.to_lowercase() == lower)
                .map_or(descriptor.clone(), |(key, _)| key.clone())
        };
        actions.push(Action {
            key,
            release_previous,
            release_self,
            repeat: repeat.unwrap_or(1),
        });
    }
    Ok(actions)
}

const MODIFIERS: [(&str, u32); 4] = [("Alt", 1), ("Control", 2), ("Meta", 4), ("Shift", 8)];

/// One page's keyboard: what Vitest and Playwright each keep between calls.
#[derive(Default)]
pub struct Keyboard {
    /// Keys a play is holding, as Vitest's `unreleased` state.
    unreleased: HashSet<String>,
    pressed_codes: HashSet<String>,
    modifiers: HashSet<String>,
}

impl Keyboard {
    /// Vitest's `keyboard` command: keys Playwright's layout has are pressed, other text is
    /// inserted, and a held key stays held for the next call.
    pub async fn press(&mut self, page: &Page<'_>, text: &str) -> Result<()> {
        for action in parse(text)? {
            let real = data().pressed_keys.contains(&action.key);
            if self.unreleased.remove(&action.key) && real {
                self.up(page, &action.key).await?;
            }
            if action.release_previous {
                continue;
            }
            if action.key == "selectall" {
                page.evaluate("document.activeElement?.select?.()").await?;
                continue;
            }
            for _ in 0..action.repeat {
                if real {
                    self.down(page, &action.key).await?;
                } else {
                    page.send("Input.insertText", json!({ "text": action.key }))
                        .await?;
                }
            }
            if !action.release_self {
                self.unreleased.insert(action.key);
            } else if real {
                self.up(page, &action.key).await?;
            }
        }
        Ok(())
    }

    /// Playwright's `_keyDescriptionForString`: shifted under Shift, with no text under a
    /// modifier other than Shift.
    fn describe(&self, key: &str) -> Result<Description> {
        let name = if key == "ControlOrMeta" {
            if cfg!(target_os = "macos") {
                "Meta"
            } else {
                "Control"
            }
        } else {
            key
        };
        let found = layout()
            .get(name)
            .ok_or_else(|| anyhow!("Unknown key: \"{name}\""))?;
        let mut description = match (&found.shifted, self.modifiers.contains("Shift")) {
            (Some(shifted), true) => (**shifted).clone(),
            _ => found.clone(),
        };
        let shift = self.modifiers.contains("Shift");
        if self.modifiers.len() > 1 || (!shift && self.modifiers.len() == 1) {
            description.text = String::new();
        }
        Ok(description)
    }

    fn mask(&self) -> u32 {
        MODIFIERS
            .iter()
            .filter(|(name, _)| self.modifiers.contains(*name))
            .map(|(_, bit)| bit)
            .sum()
    }

    /// Playwright's `_commandsForCode`: macOS editing commands, which Chromium needs for a key
    /// to edit or move a caret there, without those that insert text.
    fn commands(&self, code: &str) -> Vec<String> {
        if !cfg!(target_os = "macos") {
            return Vec::new();
        }
        let mut parts: Vec<&str> = ["Shift", "Control", "Alt", "Meta"]
            .into_iter()
            .filter(|name| self.modifiers.contains(*name))
            .collect();
        parts.push(code);
        data()
            .mac_commands
            .get(&parts.join("+"))
            .into_iter()
            .flatten()
            .filter(|command| !command.starts_with("insert"))
            .map(|command| command.trim_end_matches(':').to_string())
            .collect()
    }

    async fn down(&mut self, page: &Page<'_>, key: &str) -> Result<()> {
        let description = self.describe(key)?;
        let auto_repeat = !self.pressed_codes.insert(description.code.clone());
        if MODIFIERS.iter().any(|(name, _)| *name == description.key) {
            self.modifiers.insert(description.key.clone());
        }
        page.send(
            "Input.dispatchKeyEvent",
            json!({
                "type": if description.text.is_empty() { "rawKeyDown" } else { "keyDown" },
                "modifiers": self.mask(),
                "windowsVirtualKeyCode": description.key_code,
                "code": description.code,
                "commands": self.commands(&description.code),
                "key": description.key,
                "text": description.text,
                "unmodifiedText": description.text,
                "autoRepeat": auto_repeat,
                "location": description.location,
                "isKeypad": description.location == 3,
            }),
        )
        .await?;
        Ok(())
    }

    async fn up(&mut self, page: &Page<'_>, key: &str) -> Result<()> {
        let description = self.describe(key)?;
        self.modifiers.remove(&description.key);
        self.pressed_codes.remove(&description.code);
        page.send(
            "Input.dispatchKeyEvent",
            json!({
                "type": "keyUp",
                "modifiers": self.mask(),
                "key": description.key,
                "windowsVirtualKeyCode": description.key_code,
                "code": description.code,
                "location": description.location,
            }),
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(text: &str) -> Vec<(String, bool, bool, u32)> {
        parse(text)
            .unwrap()
            .into_iter()
            .map(|action| {
                (
                    action.key,
                    action.release_previous,
                    action.release_self,
                    action.repeat,
                )
            })
            .collect()
    }

    #[test]
    fn reads_testing_library_key_syntax() {
        let pressed = |key: &str| (key.to_string(), false, true, 1);
        assert_eq!(
            keys("{enter}a[KeyB]{{[["),
            [
                pressed("Enter"),
                pressed("a"),
                pressed("b"),
                pressed("{"),
                pressed("[")
            ]
        );
        assert_eq!(
            keys("{Shift>}R{/Shift}"),
            [
                ("Shift".to_string(), false, false, 1),
                pressed("R"),
                ("Shift".to_string(), true, true, 1)
            ]
        );
        assert_eq!(
            keys("{a>3}{b>2/}{ControlOrMeta>}"),
            [
                ("a".to_string(), false, false, 3),
                ("b".to_string(), false, true, 2),
                ("ControlOrMeta".to_string(), false, false, 1)
            ]
        );
        assert_eq!(keys(" ")[0].0, " ");
    }

    #[test]
    fn explains_key_syntax_it_cannot_read() {
        for (text, message) in [
            ("{Enter", "\"}\""),
            ("{}", "key descriptor"),
            ("[!]", "key descriptor"),
        ] {
            let error = parse(text).unwrap_err().to_string();
            assert!(error.contains(message), "{text}: {error}");
        }
    }

    #[test]
    fn describes_keys_as_playwright_does() {
        let mut keyboard = Keyboard::default();
        let enter = keyboard.describe("Enter").unwrap();
        assert_eq!(
            (enter.code.as_str(), enter.key_code, enter.text.as_str()),
            ("Enter", 13, "\r")
        );
        assert_eq!(keyboard.describe("a").unwrap().text, "a");
        assert_eq!(keyboard.describe("A").unwrap().code, "KeyA");
        keyboard.modifiers.insert("Shift".into());
        let digit = keyboard.describe("Digit1").unwrap();
        assert_eq!((digit.key.as_str(), digit.text.as_str()), ("!", "!"));
        keyboard.modifiers.insert("Control".into());
        assert_eq!(keyboard.describe("a").unwrap().text, "");
        assert_eq!(keyboard.mask(), 10);
        assert!(keyboard.describe("NotAKey").is_err());
    }
}
