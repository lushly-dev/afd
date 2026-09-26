#include "detail/json_io.hpp"

#include <cmath>
#include <limits>

namespace afd::detail {

bool read_value(const Json& value, const std::string& path, std::string& out, std::string& error) {
    if (const auto* text = value.get_ptr<const Json::string_t*>()) {
        out = *text;
        return true;
    }
    record(error, path, "expected a string");
    return false;
}

bool read_value(const Json& value, const std::string& path, bool& out, std::string& error) {
    if (const auto* flag = value.get_ptr<const Json::boolean_t*>()) {
        out = *flag;
        return true;
    }
    record(error, path, "expected a boolean");
    return false;
}

bool read_value(const Json& value, const std::string& path, double& out, std::string& error) {
    if (const auto* real = value.get_ptr<const Json::number_float_t*>()) {
        out = *real;
        return true;
    }
    if (const auto* integer = value.get_ptr<const Json::number_integer_t*>()) {
        out = static_cast<double>(*integer);
        return true;
    }
    if (const auto* natural = value.get_ptr<const Json::number_unsigned_t*>()) {
        out = static_cast<double>(*natural);
        return true;
    }
    record(error, path, "expected a number");
    return false;
}

bool read_value(const Json& value, const std::string& path, std::int64_t& out, std::string& error) {
    if (const auto* integer = value.get_ptr<const Json::number_integer_t*>()) {
        out = *integer;
        return true;
    }
    if (const auto* natural = value.get_ptr<const Json::number_unsigned_t*>()) {
        if (*natural <=
            static_cast<Json::number_unsigned_t>((std::numeric_limits<std::int64_t>::max)())) {
            out = static_cast<std::int64_t>(*natural);
            return true;
        }
    }
    // Another implementation may write an integral count as a float, such as 2.0.
    if (const auto* real = value.get_ptr<const Json::number_float_t*>()) {
        constexpr double max_safe_integer = 9007199254740991.0;
        if (std::trunc(*real) == *real && std::fabs(*real) <= max_safe_integer) {
            out = static_cast<std::int64_t>(*real);
            return true;
        }
    }
    record(error, path, "expected an integer");
    return false;
}

bool read_value(const Json& value, const std::string& /*path*/, Json& out, std::string& /*error*/) {
    out = value;
    return true;
}

bool read_object(const Json& value, const std::string& path, Json& out, std::string& error) {
    if (!value.is_object()) {
        record(error, path, "expected an object");
        return false;
    }
    out = value;
    return true;
}

std::string format_number(double value) {
    return wire::serialize(wire::number(value));
}

} // namespace afd::detail
