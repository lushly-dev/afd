// Runtime seams: time, randomness and cancellation. Hosts and tests inject these; afd-cpp never
// reads ambient time or randomness directly (proposal D4).
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <random>

namespace afd {

/// A source of time. `steady_ms` is monotonic, for durations and deadlines. `wall_ms` is
/// milliseconds since the Unix epoch, for timestamps.
class Clock {
public:
    virtual ~Clock() = default;
    [[nodiscard]] virtual double steady_ms() const = 0;
    [[nodiscard]] virtual std::int64_t wall_ms() const = 0;
};

/// The real clock: `std::chrono::steady_clock` and `std::chrono::system_clock`.
class SystemClock final : public Clock {
public:
    [[nodiscard]] double steady_ms() const override;
    [[nodiscard]] std::int64_t wall_ms() const override;
};

/// A clock that moves only when told to. For deterministic tests.
class ManualClock final : public Clock {
public:
    explicit ManualClock(std::int64_t wall_ms = 0) : wall_ms_(wall_ms) {}
    [[nodiscard]] double steady_ms() const override { return steady_ms_.load(); }
    [[nodiscard]] std::int64_t wall_ms() const override { return wall_ms_.load(); }
    /// Moves both clocks forward by `ms`.
    void advance(double ms);

private:
    std::atomic<double> steady_ms_{0};
    std::atomic<std::int64_t> wall_ms_;
};

/// A source of uniform random numbers in [0, 1).
class RandomSource {
public:
    virtual ~RandomSource() = default;
    [[nodiscard]] virtual double next() = 0;
};

/// A seeded, thread-safe `std::mt19937_64`. The default constructor seeds from
/// `std::random_device`; pass a seed for reproducible tests.
class SeededRandom final : public RandomSource {
public:
    SeededRandom();
    explicit SeededRandom(std::uint64_t seed) : engine_(seed) {}
    [[nodiscard]] double next() override;

private:
    std::mutex mutex_;
    std::mt19937_64 engine_;
};

namespace detail {
struct CancellationState {
    std::atomic<bool> cancelled{false};
    std::optional<double> deadline_ms;
    std::shared_ptr<const Clock> clock;
};
} // namespace detail

/// Cooperative cancellation, the C++ counterpart of TypeScript's `AbortSignal`. A handler polls
/// `is_cancelled()`; nothing is ever interrupted. A default-constructed token is never cancelled.
class CancellationToken {
public:
    CancellationToken() = default;

    /// True once the source cancels, or once the deadline (if any) has passed.
    [[nodiscard]] bool is_cancelled() const noexcept;
    /// The steady-clock deadline, in `Clock::steady_ms` units, if one is set.
    [[nodiscard]] std::optional<double> deadline_ms() const noexcept;

private:
    friend class CancellationSource;
    explicit CancellationToken(std::shared_ptr<detail::CancellationState> state)
        : state_(std::move(state)) {}
    std::shared_ptr<detail::CancellationState> state_;
};

/// Owns cancellation for one operation and hands out tokens for it.
class CancellationSource {
public:
    CancellationSource();
    /// A source whose tokens also report cancelled once `clock.steady_ms()` passes `deadline_ms`.
    CancellationSource(double deadline_ms, std::shared_ptr<const Clock> clock);

    [[nodiscard]] CancellationToken token() const { return CancellationToken(state_); }
    void cancel() noexcept { state_->cancelled.store(true); }

private:
    std::shared_ptr<detail::CancellationState> state_;
};

} // namespace afd
