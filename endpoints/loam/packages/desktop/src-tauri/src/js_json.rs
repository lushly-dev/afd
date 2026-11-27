//! JSON as `@lushly-dev/loam-cli` writes it, byte for byte (phase 5 no-terminal amendment, 9.3; D168): the
//! headless materializer's files must equal what `loam deployment write` writes from the same input, and
//! `serde_json` neither keeps an object's key order nor prints as `JSON.stringify` does.
//!
//! [`Json`] keeps each object's keys in the order they were read or built, and refuses a duplicate key, which
//! `JSON.parse` would silently resolve to its last value. [`pretty`] is `JSON.stringify(value, null, '\t')` and
//! [`canonical`] is the CLI's `canonicalJson` (`deployment.ts`), each with ECMAScript's key order and escapes.
//! A number is read as JavaScript reads it, an IEEE double, and printed as `Number.prototype.toString` prints it
//! (`1.0` as `1`, `1e21` as `1e+21`, `9007199254740993` as `9007199254740992`), since a packed app's settings may hold
//! a fraction (`profile-cases.json`'s `ui-settings-shapes-accepted`).
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use std::cmp::Ordering;
use std::fmt;

/// The largest integer JavaScript holds exactly.
const SAFE_INTEGER: i64 = (1 << 53) - 1;

/// A JSON value whose objects keep their key order.
#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    /// An integer JavaScript holds exactly.
    Int(i64),
    /// Any other number, as JavaScript holds it.
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    /// An object from its entries, in this order.
    pub fn obj<const N: usize>(entries: [(&str, Json); N]) -> Self {
        Json::Obj(
            entries
                .into_iter()
                .map(|(key, value)| (key.to_owned(), value))
                .collect(),
        )
    }

    pub fn str(value: &str) -> Self {
        Json::Str(value.to_owned())
    }

    /// The value at `key` when this is an object that has it.
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(entries) => entries
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    /// `get`, with a `null` read as absent: what JavaScript's `?.` and `??` see.
    pub fn get_present(&self, key: &str) -> Option<&Json> {
        self.get(key).filter(|value| **value != Json::Null)
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(value) => Some(value),
            _ => None,
        }
    }

    /// The object's entries without `key`, in order.
    pub fn without(&self, key: &str) -> Json {
        match self {
            Json::Obj(entries) => Json::Obj(
                entries
                    .iter()
                    .filter(|(name, _)| name != key)
                    .cloned()
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    /// The value from JSON text, or `None` for text that is not JSON or holds a duplicate key.
    pub fn parse(bytes: &[u8]) -> Option<Json> {
        serde_json::from_slice(bytes).ok()
    }
}

impl<'de> Deserialize<'de> for Json {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(JsonVisitor)
    }
}

struct JsonVisitor;

impl<'de> Visitor<'de> for JsonVisitor {
    type Value = Json;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("JSON with unique keys")
    }

    fn visit_unit<E: de::Error>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Json, E> {
        Ok(Json::Bool(value))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Json, E> {
        Ok(number(value as f64))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Json, E> {
        Ok(number(value as f64))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Json, E> {
        if value.is_finite() {
            Ok(number(value))
        } else {
            Err(E::custom("a number past a double's range"))
        }
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Json, E> {
        Ok(Json::Str(value.to_owned()))
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<Json, E> {
        Ok(Json::Str(value))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Json::Arr(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
        let mut entries: Vec<(String, Json)> = Vec::new();
        while let Some(key) = map.next_key::<String>()? {
            if entries.iter().any(|(name, _)| *name == key) {
                return Err(de::Error::custom("a duplicate key"));
            }
            let value = map.next_value()?;
            entries.push((key, value));
        }
        Ok(Json::Obj(entries))
    }
}

/// A number as JavaScript holds it: an exact integer as [`Json::Int`], `-0` as `0`, which is how it prints.
fn number(value: f64) -> Json {
    if value.fract() == 0.0 && value.abs() <= SAFE_INTEGER as f64 {
        Json::Int(value as i64)
    } else {
        Json::Num(value)
    }
}

/// `Number.prototype.toString` for a finite double (ECMAScript's Number::toString with radix 10): the shortest
/// digits that round-trip, which Rust's `{:e}` also gives, laid out by the decimal exponent.
pub(crate) fn js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    let text = format!("{:e}", value.abs());
    let (mantissa, exponent) = text.split_once('e').expect("an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64;
    let n = exponent.parse::<i64>().expect("an exponent") + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n - 1 < 0 { '-' } else { '+' };
        let power = (n - 1).abs();
        if k == 1 {
            format!("{digits}e{sign}{power}")
        } else {
            format!("{}.{}e{sign}{power}", &digits[..1], &digits[1..])
        }
    };
    if value < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

/// Whether `key` is an array index, which an ECMAScript object lists first, in numeric order (OrdinaryOwnPropertyKeys).
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty()
        || (key.len() > 1 && key.starts_with('0'))
        || !key.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    key.parse::<u32>().ok().filter(|index| *index != u32::MAX)
}

/// An object's entries in the order `JSON.stringify` lists them: array indices ascending, then the rest as inserted.
fn js_order(entries: &[(String, Json)]) -> Vec<&(String, Json)> {
    let mut indexed: Vec<(u32, &(String, Json))> = entries
        .iter()
        .filter_map(|entry| array_index(&entry.0).map(|index| (index, entry)))
        .collect();
    indexed.sort_by_key(|(index, _)| *index);
    indexed
        .into_iter()
        .map(|(_, entry)| entry)
        .chain(
            entries
                .iter()
                .filter(|entry| array_index(&entry.0).is_none()),
        )
        .collect()
}

/// A string as `JSON.stringify` quotes it (QuoteJSONString): the short escapes, `\u00xx` in lowercase for the other
/// control characters, and every other character as itself.
fn quote(out: &mut String, value: &str) {
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", control as u32));
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

fn write_pretty(out: &mut String, value: &Json, depth: usize) {
    let indent = |out: &mut String, depth: usize| {
        for _ in 0..depth {
            out.push('\t');
        }
    };
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Json::Int(value) => out.push_str(&value.to_string()),
        Json::Num(value) => out.push_str(&js_number(*value)),
        Json::Str(value) => quote(out, value),
        Json::Arr(items) if items.is_empty() => out.push_str("[]"),
        Json::Arr(items) => {
            out.push('[');
            for (position, item) in items.iter().enumerate() {
                out.push_str(if position == 0 { "\n" } else { ",\n" });
                indent(out, depth + 1);
                write_pretty(out, item, depth + 1);
            }
            out.push('\n');
            indent(out, depth);
            out.push(']');
        }
        Json::Obj(entries) if entries.is_empty() => out.push_str("{}"),
        Json::Obj(entries) => {
            out.push('{');
            for (position, (key, item)) in js_order(entries).into_iter().enumerate() {
                out.push_str(if position == 0 { "\n" } else { ",\n" });
                indent(out, depth + 1);
                quote(out, key);
                out.push_str(": ");
                write_pretty(out, item, depth + 1);
            }
            out.push('\n');
            indent(out, depth);
            out.push('}');
        }
    }
}

/// `${JSON.stringify(value, null, '\t')}\n`: the bytes the CLI writes a file with.
pub fn pretty(value: &Json) -> String {
    let mut out = String::new();
    write_pretty(&mut out, value, 0);
    out.push('\n');
    out
}

/// JavaScript's `<` on strings: by UTF-16 code units.
fn utf16_order(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn write_canonical(out: &mut String, value: &Json) {
    match value {
        Json::Arr(items) => {
            out.push('[');
            for (position, item) in items.iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                write_canonical(out, item);
            }
            out.push(']');
        }
        Json::Obj(entries) => {
            let mut sorted: Vec<&(String, Json)> = entries.iter().collect();
            sorted.sort_by(|a, b| utf16_order(&a.0, &b.0));
            out.push('{');
            for (position, (key, item)) in sorted.into_iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                quote(out, key);
                out.push(':');
                write_canonical(out, item);
            }
            out.push('}');
        }
        other => write_pretty(out, other, 0),
    }
}

/// The CLI's `canonicalJson`: every object's keys sorted, no whitespace, so equal values give equal text.
pub fn canonical(value: &Json) -> String {
    let mut out = String::new();
    write_canonical(&mut out, value);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty_is_json_stringify_with_a_tab() {
        // The text and its expected bytes from Node 26: `JSON.stringify(value, null, '\t') + '\n'`.
        let text = "{\"b\":[],\"a\":{},\"10\":1,\"2\":[1,{\"x\":null}],\"s\":\"q\\\"\\\\\\b\\f\\n\\r\\t\\u0001\\u001f\u{7f}\u{2028}é😀\",\"t\":true,\"n\":-9007199254740991}";
        let value = Json::parse(text.as_bytes()).unwrap();
        assert_eq!(
            pretty(&value),
            "{\n\t\"2\": [\n\t\t1,\n\t\t{\n\t\t\t\"x\": null\n\t\t}\n\t],\n\t\"10\": 1,\n\t\"b\": [],\n\t\"a\": {},\n\t\"s\": \"q\\\"\\\\\\b\\f\\n\\r\\t\\u0001\\u001f\u{7f}\u{2028}é😀\",\n\t\"t\": true,\n\t\"n\": -9007199254740991\n}\n"
        );
    }

    #[test]
    fn keys_list_array_indices_first_as_javascript_does() {
        let value =
            Json::parse(br#"{"b":1,"10":1,"2":1,"01":1,"4294967295":1,"4294967294":1}"#).unwrap();
        let Json::Obj(entries) = &value else {
            panic!("an object")
        };
        let keys: Vec<&str> = js_order(entries)
            .into_iter()
            .map(|(key, _)| key.as_str())
            .collect();
        // Node 26's `Object.keys` of the same literal.
        assert_eq!(keys, ["2", "10", "4294967294", "b", "01", "4294967295"]);
    }

    #[test]
    fn canonical_sorts_by_utf16_code_units() {
        let value = Json::parse(
            "{\"b\":1,\"a\":[{\"y\":1,\"x\":2}],\"é\":1,\"😀\":1,\"\u{ffff}\":1,\"Z\":1}"
                .as_bytes(),
        )
        .unwrap();
        // Node 26 sorts the keys `Z, a, b, é, 😀, ￿`: UTF-8 bytes would put U+FFFF before the emoji.
        assert_eq!(
            canonical(&value),
            "{\"Z\":1,\"a\":[{\"x\":2,\"y\":1}],\"b\":1,\"é\":1,\"😀\":1,\"\u{ffff}\":1}"
        );
    }

    #[test]
    fn numbers_print_as_javascript_prints_them() {
        let text = b"[1.5,0.5,1.0,-0.0,100,1e21,1e-7,123456789012345680000,0.000001,1.2345e-7,-2.5e30,5e-324,1.7976931348623157e308,0.1,123.456,9007199254740993,1e20,12345678901234567890]";
        // Node 26's `JSON.stringify(JSON.parse(text))`.
        assert_eq!(
            canonical(&Json::parse(text).unwrap()),
            "[1.5,0.5,1,0,100,1e+21,1e-7,123456789012345680000,0.000001,1.2345e-7,-2.5e+30,5e-324,1.7976931348623157e+308,0.1,123.456,9007199254740992,100000000000000000000,12345678901234567000]"
        );
    }

    #[test]
    fn refuses_a_duplicate_key_and_a_number_past_a_double() {
        assert_eq!(Json::parse(br#"{"a":1,"a":2}"#), None);
        assert_eq!(Json::parse(br#"{"a":{"b":1,"b":1}}"#), None);
        assert_eq!(Json::parse(b"[1e400]"), None);
        assert_eq!(
            Json::parse(b"[9007199254740991, 1.0]"),
            Some(Json::Arr(vec![Json::Int(SAFE_INTEGER), Json::Int(1)]))
        );
    }
}
