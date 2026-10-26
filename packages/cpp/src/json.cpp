#include "afd/json.hpp"

#include <cmath>
#include <cstdio>
#include <utility>
#include <vector>

namespace afd {

namespace {

// Builds the document from SAX events, as nlohmann's own DOM parser does, and stops at the first
// container deeper than the limit. Not a parser callback: nlohmann's callback parser rescans the
// enclosing container for discarded values after every object, which is quadratic in the number of
// objects in an array (#397).
// With JSON_DIAGNOSTIC_POSITIONS (nlohmann 3.12), values carry no byte positions.
class BoundedDomBuilder {
public:
    explicit BoundedDomBuilder(std::size_t max_depth) : max_depth_(max_depth) {}

    bool null() { return add(nullptr); }
    bool boolean(bool value) { return add(value); }
    bool number_integer(Json::number_integer_t value) { return add(value); }
    bool number_unsigned(Json::number_unsigned_t value) { return add(value); }
    bool number_float(Json::number_float_t value, const Json::string_t&) { return add(value); }
    bool string(Json::string_t& value) { return add(std::move(value)); }
    bool binary(Json::binary_t& value) { return add(std::move(value)); }

    bool start_object(std::size_t) { return open(Json::value_t::object); }
    bool start_array(std::size_t) { return open(Json::value_t::array); }
    bool end_object() { return close(); }
    bool end_array() { return close(); }

    bool key(Json::string_t& name) {
        // operator[] keeps the last of duplicate keys, as Json::parse does.
        slot_ = &(*stack_.back())[std::move(name)];
        return true;
    }

    bool parse_error(std::size_t, const std::string&, const Json::exception&) {
        malformed_ = true;
        return false;
    }

    [[nodiscard]] bool too_deep() const { return too_deep_; }
    [[nodiscard]] bool malformed() const { return malformed_; }
    Json& root() { return root_; }

private:
    // Places `value` in the enclosing container (or as the root) and returns where it now lives.
    // Pointers on the stack stay valid: a container only grows while it is the innermost one.
    template <typename Value>
    Json* place(Value&& value) {
        if (stack_.empty()) {
            root_ = Json(std::forward<Value>(value));
            return &root_;
        }
        Json& parent = *stack_.back();
        if (parent.is_array()) {
            parent.push_back(Json(std::forward<Value>(value)));
            return &parent.back();
        }
        *slot_ = Json(std::forward<Value>(value));
        return slot_;
    }

    template <typename Value>
    bool add(Value&& value) {
        place(std::forward<Value>(value));
        return true;
    }

    bool open(Json::value_t type) {
        // The outermost container is level 1.
        if (stack_.size() + 1 > max_depth_) {
            too_deep_ = true;
            return false;
        }
        stack_.push_back(place(type));
        return true;
    }

    bool close() {
        stack_.pop_back();
        return true;
    }

    std::size_t max_depth_;
    Json root_;
    std::vector<Json*> stack_;
    Json* slot_ = nullptr;
    bool too_deep_ = false;
    bool malformed_ = false;
};

} // namespace

Expected<Json, JsonParseError> parse_bounded(std::string_view text, ParseLimits limits) {
    if (text.size() > limits.max_bytes) {
        return unexpected(JsonParseError{JsonParseError::Kind::too_large,
                                         "JSON input is larger than " +
                                             std::to_string(limits.max_bytes) + " bytes"});
    }

    // Parsing stops at whichever comes first, a container over the limit or a syntax error, so
    // input that is too deep before it goes wrong is reported as too deep.
    BoundedDomBuilder builder(limits.max_depth);
    const bool parsed = Json::sax_parse(text.begin(), text.end(), &builder);
    if (builder.too_deep()) {
        return unexpected(JsonParseError{JsonParseError::Kind::too_deep,
                                         "JSON input is nested deeper than " +
                                             std::to_string(limits.max_depth) + " levels"});
    }
    if (!parsed || builder.malformed()) {
        return unexpected(
            JsonParseError{JsonParseError::Kind::malformed, "JSON input is malformed"});
    }
    return std::move(builder.root());
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

    // Sized for the widest values the format could print, so GCC's -Wformat-truncation can prove
    // the output always fits. Real output is 24 characters.
    char buffer[128];
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
