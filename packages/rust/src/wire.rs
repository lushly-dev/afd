//! Serde helpers shared by the wire types.
//!
//! The canonical wire shapes live in `spec/wire/*.json` and are produced by the
//! TypeScript implementation. These helpers make the Rust types emit the same
//! JSON as `JSON.stringify` would.

use serde::de::{self, Deserialize, Deserializer};
use serde::Serializer;
use std::fmt;
use std::marker::PhantomData;

/// Largest integer that a JavaScript number represents exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Serialize an `f64` the way JavaScript's `JSON.stringify` does.
///
/// Integral values are written without a fractional part (`0`, not `0.0`), so a
/// value that crosses the wire keeps its exact JSON representation.
pub(crate) fn number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    let value = *value;
    if value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER {
        // The checks above make both casts exact.
        if value >= 0.0 {
            serializer.serialize_u64(value as u64)
        } else {
            serializer.serialize_i64(value as i64)
        }
    } else {
        serializer.serialize_f64(value)
    }
}

/// [`number`] for optional values. Use together with `skip_serializing_if = "Option::is_none"`.
pub(crate) fn opt_number<S: Serializer>(
    value: &Option<f64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => number(value, serializer),
        None => serializer.serialize_none(),
    }
}

/// Serialize a `(reference, number)` condition operand with [`number`].
pub(crate) fn reference_and_number<S: Serializer>(
    value: &(String, f64),
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeTuple;

    struct Number(f64);
    impl serde::Serialize for Number {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            number(&self.0, serializer)
        }
    }

    let mut tuple = serializer.serialize_tuple(2)?;
    tuple.serialize_element(&value.0)?;
    tuple.serialize_element(&Number(value.1))?;
    tuple.end()
}

/// Deserialize an optional field whose JSON `null` is a real value.
///
/// Plain `Option<T>` turns `"data": null` into `None`, so `success(Value::Null)`
/// would lose its data on a round trip. With this helper a present field is
/// always `Some`, including `null` when `T` accepts it (`serde_json::Value`,
/// `Option<_>`, `()`). A missing field stays `None` through `#[serde(default)]`.
/// A `null` that `T` cannot represent is treated as absent.
pub(crate) fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct PresentVisitor<T>(PhantomData<T>);

    impl<'de, T: Deserialize<'de>> de::Visitor<'de> for PresentVisitor<T> {
        type Value = Option<T>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("any value")
        }

        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(T::deserialize(de::value::UnitDeserializer::<E>::new()).ok())
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            self.visit_none()
        }

        fn visit_some<D2: Deserializer<'de>>(
            self,
            deserializer: D2,
        ) -> Result<Self::Value, D2::Error> {
            T::deserialize(deserializer).map(Some)
        }
    }

    deserializer.deserialize_option(PresentVisitor(PhantomData))
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, Debug, PartialEq)]
    struct Numbers {
        #[serde(serialize_with = "super::number")]
        value: f64,
        #[serde(
            default,
            serialize_with = "super::opt_number",
            skip_serializing_if = "Option::is_none"
        )]
        optional: Option<f64>,
    }

    #[test]
    fn integral_floats_serialize_like_javascript() {
        let json = serde_json::to_value(Numbers {
            value: 1.0,
            optional: Some(-3.0),
        })
        .unwrap();
        assert_eq!(json, serde_json::json!({"value": 1, "optional": -3}));
        assert_eq!(json.to_string(), r#"{"optional":-3,"value":1}"#);
    }

    #[test]
    fn fractional_and_non_finite_floats_keep_their_representation() {
        let json = serde_json::to_string(&Numbers {
            value: 0.25,
            optional: Some(f64::NAN),
        })
        .unwrap();
        assert_eq!(json, r#"{"value":0.25,"optional":null}"#);
        // Beyond Number.MAX_SAFE_INTEGER the float form is kept (JavaScript also writes 1e+300).
        let large = Numbers {
            value: 1e300,
            optional: None,
        };
        assert_eq!(
            serde_json::to_string(&large).unwrap(),
            r#"{"value":1e+300}"#
        );
    }

    #[derive(Deserialize, Debug, PartialEq)]
    #[serde(bound(deserialize = "T: Deserialize<'de>"))]
    struct Holder<T> {
        #[serde(default, deserialize_with = "super::present")]
        data: Option<T>,
    }

    #[test]
    fn present_keeps_null_for_types_that_accept_it() {
        let value: Holder<serde_json::Value> = serde_json::from_str(r#"{"data":null}"#).unwrap();
        assert_eq!(value.data, Some(serde_json::Value::Null));
        let unit: Holder<()> = serde_json::from_str(r#"{"data":null}"#).unwrap();
        assert_eq!(unit.data, Some(()));
        let missing: Holder<serde_json::Value> = serde_json::from_str("{}").unwrap();
        assert_eq!(missing.data, None);
        let string: Holder<String> = serde_json::from_str(r#"{"data":null}"#).unwrap();
        assert_eq!(string.data, None);
        let present: Holder<String> = serde_json::from_str(r#"{"data":"x"}"#).unwrap();
        assert_eq!(present.data, Some("x".to_string()));
    }
}
