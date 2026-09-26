#include "afd/json.hpp"

#include <cmath>
#include <cstdio>

namespace afd {

Expected<Json, JsonParseError> parse_bounded(std::string_view text, ParseLimits limits) {
    if (text.size() > limits.max_bytes) {
        return unexpected(JsonParseError{JsonParseError::Kind::too_large,
                                         "JSON input is larger than " +
                                             std::to_string(limits.max_bytes) + " bytes"});
    }

    // nlohmann reports the depth of the enclosing container at a start event, so the outermost
    // object or array arrives with depth 0 and is level 1.
    bool too_deep = false;
    const Json::parser_callback_t callback = [&](int depth, Json::parse_event_t event, Json&) {
        const bool opens =
            event == Json::parse_event_t::object_start || event == Json::parse_event_t::array_start;
        if (opens && static_cast<std::size_t>(depth) + 1 > limits.max_depth) {
            too_deep = true;
        }
        return !too_deep;
    };

    // A callback that rejects a value makes nlohmann drop it silently and still report success
    // (Phase 0 spike), so the flag decides, not is_discarded().
    Json parsed = Json::parse(text.begin(), text.end(), callback, /*allow_exceptions=*/false);
    if (too_deep) {
        return unexpected(JsonParseError{JsonParseError::Kind::too_deep,
                                         "JSON input is nested deeper than " +
                                             std::to_string(limits.max_depth) + " levels"});
    }
    if (parsed.is_discarded()) {
        return unexpected(
            JsonParseError{JsonParseError::Kind::malformed, "JSON input is malformed"});
    }
    return parsed;
}

namespace wire {

Json number(double value) {
    if (!std::isfinite(value)) {
        return nullptr;
    }
    constexpr double max_safe_integer = 9007199254740991.0; // 2^53 - 1
    if (std::trunc(value) == value && std::fabs(value) <= max_safe_integer) {
        return static_cast<std::int64_t>(value); // -0.0 becomes 0, as in JavaScript
    }
    return value;
}

namespace {

// Howard Hinnant's civil_from_days: days since 1970-01-01 to a proleptic Gregorian date.
void civil_from_days(std::int64_t days, std::int64_t& year, unsigned& month, unsigned& day) {
    days += 719468;
    const std::int64_t era = (days >= 0 ? days : days - 146096) / 146097;
    const auto day_of_era = static_cast<unsigned>(days - era * 146097);
    const unsigned year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146096) / 365;
    const unsigned day_of_year =
        day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    const unsigned shifted_month = (5 * day_of_year + 2) / 153;
    day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    month = shifted_month < 10 ? shifted_month + 3 : shifted_month - 9;
    year = static_cast<std::int64_t>(year_of_era) + era * 400 + (month <= 2 ? 1 : 0);
}

std::int64_t floor_div(std::int64_t value, std::int64_t divisor) {
    std::int64_t quotient = value / divisor;
    if ((value % divisor != 0) && ((value < 0) != (divisor < 0))) {
        --quotient;
    }
    return quotient;
}

} // namespace

std::string iso8601_utc(std::int64_t ms) {
    constexpr std::int64_t ms_per_day = 86400000;
    const std::int64_t days = floor_div(ms, ms_per_day);
    const std::int64_t ms_of_day = ms - days * ms_per_day;

    std::int64_t year = 0;
    unsigned month = 0;
    unsigned day = 0;
    civil_from_days(days, year, month, day);

    char buffer[32];
    std::snprintf(
        buffer, sizeof buffer, "%04lld-%02u-%02uT%02lld:%02lld:%02lld.%03lldZ",
        static_cast<long long>(year), month, day, static_cast<long long>(ms_of_day / 3600000),
        static_cast<long long>(ms_of_day / 60000 % 60),
        static_cast<long long>(ms_of_day / 1000 % 60), static_cast<long long>(ms_of_day % 1000));
    return buffer;
}

std::string serialize(const Json& value) {
    return value.dump(-1, ' ', false, Json::error_handler_t::replace);
}

} // namespace wire
} // namespace afd
