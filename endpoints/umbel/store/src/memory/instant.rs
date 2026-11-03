//! Instants: milliseconds UTC in the store, RFC 3339 with `Z` on the wire (phase 3 section 4.1).
//! The crate takes no date dependency, so the civil calendar is computed here.

use crate::error::{Result, StoreError};

/// Milliseconds since 1970-01-01T00:00:00Z. Every memory instant is one; the command context's
/// clock supplies them, and the store reads none of its own.
pub type Millis = i64;

/// One hour, in milliseconds.
pub const HOUR_MS: Millis = 3_600_000;
/// One day, in milliseconds.
pub const DAY_MS: Millis = 24 * HOUR_MS;

/// The earliest instant this crate formats: 0000-01-01T00:00:00.000Z.
const MIN_MS: Millis = -62_167_219_200_000;
/// The latest: 9999-12-31T23:59:59.999Z.
const MAX_MS: Millis = 253_402_300_799_999;

/// Days since 1970-01-01 of a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The proleptic Gregorian date of a day count since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// `2026-11-02T10:00:00.000Z`: always three fractional digits. Instants outside years 0 to 9999
/// are clamped to that range, which no clock reaches.
#[must_use]
pub fn format_instant(ms: Millis) -> String {
    let ms = ms.clamp(MIN_MS, MAX_MS);
    let days = ms.div_euclid(DAY_MS);
    let rest = ms.rem_euclid(DAY_MS);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / HOUR_MS,
        rest / 60_000 % 60,
        rest / 1000 % 60,
        rest % 1000
    )
}

/// Parse `YYYY-MM-DDTHH:MM:SS[.fraction]Z`. Digits of the fraction past milliseconds are
/// truncated.
///
/// # Errors
/// [`StoreError::Invalid`] when the text is not in that form or names no real date.
pub fn parse_instant(text: &str) -> Result<Millis> {
    let invalid = || {
        StoreError::invalid(format!(
            "`{text}` is not an instant: use YYYY-MM-DDTHH:MM:SS[.fff]Z"
        ))
    };
    let bytes = text.as_bytes();
    if bytes.len() < 20 || !text.is_ascii() || bytes[bytes.len() - 1] != b'Z' {
        return Err(invalid());
    }
    let number = |range: std::ops::Range<usize>| -> Result<i64> {
        let part = &text[range];
        if part.bytes().all(|b| b.is_ascii_digit()) {
            part.parse::<i64>().map_err(|_| invalid())
        } else {
            Err(invalid())
        }
    };
    let separators = [(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':')];
    if separators.iter().any(|(at, want)| bytes[*at] != *want) {
        return Err(invalid());
    }
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let fraction = &text[19..text.len() - 1];
    let millis = if fraction.is_empty() {
        0
    } else {
        let digits = fraction.strip_prefix('.').ok_or_else(invalid)?;
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return Err(invalid());
        }
        let padded = format!("{:0<3}", &digits[..digits.len().min(3)]);
        padded.parse::<i64>().map_err(|_| invalid())?
    };
    if !(1..=12).contains(&month)
        || !(1..=days_in_month(year, month)).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return Err(invalid());
    }
    let days = days_from_civil(year, month, day);
    Ok(days * DAY_MS + hour * HOUR_MS + minute * 60_000 + second * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_known_values() {
        assert_eq!(format_instant(0), "1970-01-01T00:00:00.000Z");
        let at = parse_instant("2026-11-02T10:15:30.123Z").unwrap();
        assert_eq!(format_instant(at), "2026-11-02T10:15:30.123Z");
        assert_eq!(parse_instant("2026-11-02T10:15:30Z").unwrap(), at - 123);
        assert_eq!(parse_instant("2026-11-02T10:15:30.1239Z").unwrap(), at);
        assert_eq!(
            parse_instant("2024-02-29T00:00:00.000Z").unwrap() % DAY_MS,
            0
        );
        assert_eq!(
            format_instant(parse_instant("1969-12-31T23:59:59.999Z").unwrap()),
            "1969-12-31T23:59:59.999Z"
        );
        for n in [
            -1_000_000_000_000_i64,
            -1,
            1,
            951_782_400_000,
            4_102_444_800_000,
        ] {
            assert_eq!(parse_instant(&format_instant(n)).unwrap(), n);
        }
    }

    #[test]
    fn refuses_what_is_not_an_instant() {
        for bad in [
            "",
            "2026-11-02",
            "2026-11-02T10:15:30+00:00",
            "2026-13-02T10:15:30Z",
            "2025-02-29T10:15:30Z",
            "2026-11-02T24:00:00Z",
            "2026-11-02T10:15:30.Z",
            "2026-11-02 10:15:30Z",
            "2026-1a-02T10:15:30Z",
        ] {
            assert!(parse_instant(bad).is_err(), "{bad}");
        }
    }
}
