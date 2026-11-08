//! The bearer token on a request (`spec/authorization.md`, M2).

use super::RuleCode;

/// The one bearer token of a request (`spec/authorization.md`, M2), or the rule a request breaks.
///
/// - `authorization` holds every `Authorization` header value, in order (an empty slice for
///   none). The value is `Bearer` (any ASCII case), one or more spaces and a `b64token`
///   (`1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"="`); surrounding spaces and tabs
///   are stripped first, as an HTTP parser does.
/// - `query` is the request's query string, and `form_body` the body of a request whose
///   `Content-Type` is `application/x-www-form-urlencoded`. An `access_token` parameter in either
///   (its name percent-decoded) refuses the request, even beside a valid header.
///
/// # Errors
/// [`RuleCode::TokenLocation`] for a token in the query or a form body or a second
/// `Authorization` header (checked first), [`RuleCode::NoToken`] for no header, and
/// [`RuleCode::TokenMalformed`] for a value that is not `Bearer <b64token>`.
pub fn extract_bearer<'a>(
    authorization: &[&'a [u8]],
    query: Option<&str>,
    form_body: Option<&[u8]>,
) -> Result<&'a str, RuleCode> {
    if query.is_some_and(|query| names_access_token(query.as_bytes()))
        || form_body.is_some_and(names_access_token)
        || authorization.len() > 1
    {
        return Err(RuleCode::TokenLocation);
    }
    let Some(value) = authorization.first() else {
        return Err(RuleCode::NoToken);
    };
    parse_bearer(value).ok_or(RuleCode::TokenMalformed)
}

/// `Bearer 1*SP b64token`, after stripping surrounding optional whitespace.
fn parse_bearer(value: &[u8]) -> Option<&str> {
    let value = std::str::from_utf8(value).ok()?;
    let value = value.trim_matches(|c| c == ' ' || c == '\t');
    let (scheme, rest) = value.split_at_checked(6)?;
    if !scheme.eq_ignore_ascii_case("bearer") || !rest.starts_with(' ') {
        return None;
    }
    let token = rest.trim_start_matches(' ');
    is_b64token(token).then_some(token)
}

/// RFC 6750 2.1's `b64token`.
fn is_b64token(token: &str) -> bool {
    let body = token.trim_end_matches('=');
    !body.is_empty()
        && body.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'+' | b'/')
        })
}

/// Whether an `application/x-www-form-urlencoded` string has a parameter named `access_token`.
fn names_access_token(encoded: &[u8]) -> bool {
    encoded.split(|byte| *byte == b'&').any(|pair| {
        let name = pair.split(|byte| *byte == b'=').next().unwrap_or_default();
        form_decode(name) == b"access_token"
    })
}

/// Percent- and `+`-decoding of one form name. A malformed escape is kept as written.
fn form_decode(encoded: &[u8]) -> Vec<u8> {
    let mut decoded = Vec::with_capacity(encoded.len());
    let mut index = 0;
    while index < encoded.len() {
        match encoded[index] {
            b'+' => decoded.push(b' '),
            b'%' if index + 2 < encoded.len() => {
                match (hex(encoded[index + 1]), hex(encoded[index + 2])) {
                    (Some(high), Some(low)) => {
                        decoded.push(high << 4 | low);
                        index += 2;
                    }
                    _ => decoded.push(b'%'),
                }
            }
            byte => decoded.push(byte),
        }
        index += 1;
    }
    decoded
}

fn hex(digit: u8) -> Option<u8> {
    match digit {
        b'0'..=b'9' => Some(digit - b'0'),
        b'a'..=b'f' => Some(digit - b'a' + 10),
        b'A'..=b'F' => Some(digit - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_names_are_decoded() {
        assert!(names_access_token(b"access%5Ftoken=x"));
        assert!(names_access_token(b"a=1&access_token"));
        assert!(!names_access_token(b"access_token_hint=1"));
        assert!(!names_access_token(b"access%5"));
        assert_eq!(form_decode(b"a+b%41%"), b"a bA%");
    }
}
