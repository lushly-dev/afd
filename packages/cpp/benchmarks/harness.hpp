// A dependency-free timing harness for the afd-cpp benchmarks. Each case doubles its batch until
// one batch lasts at least 50 ms, then times five batches and reports the median and the fastest.
// There are no thresholds: the numbers are evidence to compare across commits and machines, not a
// pass or fail gate.
#pragma once

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <string_view>

namespace afd_bench {

struct Measurement {
    double median_ns = 0;
    double min_ns = 0;
    long long batch = 0;
};

/// Times `op`, which returns false on an unexpected failure. Returns false if any call failed.
template <class Op>
bool measure(Op&& op, Measurement& out) {
    using Clock = std::chrono::steady_clock;
    constexpr auto min_batch_time = std::chrono::milliseconds(50);
    const auto run = [&](long long batch, double& ns) {
        const auto start = Clock::now();
        for (long long index = 0; index < batch; ++index) {
            if (!op()) {
                return false;
            }
        }
        ns = std::chrono::duration<double, std::nano>(Clock::now() - start).count();
        return true;
    };

    long long batch = 1;
    double elapsed = 0;
    while (true) {
        if (!run(batch, elapsed)) {
            return false;
        }
        if (elapsed >= std::chrono::duration<double, std::nano>(min_batch_time).count()) {
            break;
        }
        batch *= 2;
    }

    std::array<double, 5> samples{};
    for (auto& sample : samples) {
        if (!run(batch, elapsed)) {
            return false;
        }
        sample = elapsed / static_cast<double>(batch);
    }
    std::sort(samples.begin(), samples.end());
    out = {.median_ns = samples[2], .min_ns = samples[0], .batch = batch};
    return true;
}

/// Runs and prints one case unless `filter` is non-empty and not a substring of `name`. Returns
/// false if the case failed.
template <class Op>
bool run_case(std::string_view filter, std::string_view name, Op&& op) {
    if (!filter.empty() && name.find(filter) == std::string_view::npos) {
        return true;
    }
    Measurement result;
    if (!measure(op, result)) {
        std::fprintf(stderr, "%.*s: unexpected failure\n", static_cast<int>(name.size()),
                     name.data());
        return false;
    }
    std::printf("%-40.*s %14.0f %14.0f %8lld\n", static_cast<int>(name.size()), name.data(),
                result.median_ns, result.min_ns, result.batch);
    std::fflush(stdout);
    return true;
}

} // namespace afd_bench
