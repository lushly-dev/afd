// Private: range clamping for RandomSource::next() so hostile sources or tapes never trigger
// out-of-bounds indexing or FP-to-int undefined behaviour.
#pragma once

#include <cmath>
#include <cstddef>

namespace afd::detail {

/// Clamps a `RandomSource::next()` sample into `[0.0, 1.0)`.
[[nodiscard]] inline double clamp_unit_random(double value) noexcept {
    if (!std::isfinite(value) || value <= 0.0) {
        return 0.0;
    }
    // Largest IEEE-754 double strictly below 1.0 (1.0 - 2^-53).
    constexpr double max_unit = 0x1.fffffffffffffp-1;
    if (value >= 1.0) {
        return max_unit;
    }
    return value;
}

/// Scales a `RandomSource::next()` sample into `[0, bound - 1]` for `bound > 0`.
[[nodiscard]] inline std::size_t random_index(double value, std::size_t bound) noexcept {
    if (bound <= 1) {
        return 0;
    }
    const double unit = clamp_unit_random(value);
    const auto index = static_cast<std::size_t>(unit * static_cast<double>(bound));
    return index < bound ? index : bound - 1;
}

} // namespace afd::detail
