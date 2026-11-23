// Private: shared ISO-8601 timestamp parser for journal replay and telemetry events.
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string_view>

namespace afd::detail {

/// Howard Hinnant's days_from_civil: a proleptic Gregorian date to days since 1970-01-01.
[[nodiscard]] inline std::int64_t days_from_civil(std::int64_t year, unsigned month,
                                                  unsigned day) noexcept {
    year -= month <= 2 ? 1 : 0;
    const std::int64_t era = (year >= 0 ? year : year - 399) / 400;
    const auto year_of_era = static_cast<unsigned>(year - era * 400);
    const unsigned day_of_year = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
    const unsigned day_of_era =
        year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    return era * 146097 + static_cast<std::int64_t>(day_of_era) - 719468;
}

/// Parses `YYYY-MM-DD[THH:MM[:SS[.fff…]]][Z|±HH:MM]` as epoch milliseconds. A time without an
/// offset is read as UTC.
[[nodiscard]] inline std::optional<std::int64_t> parse_iso8601_ms(std::string_view text) noexcept {
    std::size_t at = 0;
    const auto digits = [&](std::size_t count, int& out) noexcept {
        if (at + count > text.size()) {
            return false;
        }
        out = 0;
        for (std::size_t i = 0; i < count; ++i) {
            const char c = text[at + i];
            if (c < '0' || c > '9') {
                return false;
            }
            out = out * 10 + (c - '0');
        }
        at += count;
        return true;
    };
    const auto literal = [&](char c) noexcept {
        if (at < text.size() && text[at] == c) {
            ++at;
            return true;
        }
        return false;
    };
    int year = 0;
    int month = 0;
    int day = 0;
    int hour = 0;
    int minute = 0;
    int second = 0;
    int millisecond = 0;
    if (!digits(4, year) || !literal('-') || !digits(2, month) || !literal('-') ||
        !digits(2, day) || month < 1 || month > 12 || day < 1 || day > 31) {
        return std::nullopt;
    }
    std::int64_t offset_minutes = 0;
    if (literal('T') || literal('t')) {
        if (!digits(2, hour) || !literal(':') || !digits(2, minute) || hour > 23 || minute > 59) {
            return std::nullopt;
        }
        if (literal(':')) {
            if (!digits(2, second) || second > 59) {
                return std::nullopt;
            }
            if (literal('.')) {
                const std::size_t first = at;
                int scale = 100;
                while (at < text.size() && text[at] >= '0' && text[at] <= '9') {
                    millisecond += (text[at] - '0') * scale;
                    scale /= 10;
                    ++at;
                }
                if (at == first) {
                    return std::nullopt;
                }
            }
        }
        const bool positive = literal('+');
        const bool negative = !positive && literal('-');
        if (positive || negative) {
            int offset_hours = 0;
            int offset_mins = 0;
            if (!digits(2, offset_hours) || !literal(':') || !digits(2, offset_mins) ||
                offset_hours > 23 || offset_mins > 59) {
                return std::nullopt;
            }
            offset_minutes = (negative ? -1 : 1) * (offset_hours * 60 + offset_mins);
        } else if (!literal('Z')) {
            (void)literal('z');
        }
    }
    if (at != text.size()) {
        return std::nullopt;
    }
    const std::int64_t days =
        days_from_civil(year, static_cast<unsigned>(month), static_cast<unsigned>(day));
    return ((days * 24 + hour) * 60 + minute - offset_minutes) * 60000 +
           static_cast<std::int64_t>(second) * 1000 + millisecond;
}

} // namespace afd::detail
