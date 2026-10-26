#include "afd/runtime.hpp"

#include <chrono>
#include <exception>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/exceptions.hpp"

#if AFD_ENABLE_THREADS
#include <thread>
#endif

namespace afd {

double SystemClock::steady_ms() const {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration<double, std::milli>(now).count();
}

std::int64_t SystemClock::wall_ms() const {
    const auto now = std::chrono::system_clock::now().time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
}

void ManualClock::advance(double ms) {
    steady_ms_.store(steady_ms_.load() + ms);
    wall_ms_.fetch_add(static_cast<std::int64_t>(ms));
}

std::shared_ptr<ManualClock> fixed_clock(std::int64_t wall_ms) {
    return std::make_shared<ManualClock>(wall_ms);
}

SystemRandom::SystemRandom() : engine_(std::random_device{}()) {}

double SystemRandom::next() {
    const std::lock_guard lock(mutex_);
    return std::uniform_real_distribution<double>(0.0, 1.0)(engine_);
}

namespace {

// FNV-1a (32-bit). std::string holds the seed's UTF-8 bytes.
std::uint32_t fnv1a(std::string_view text) {
    std::uint32_t hash = 0x811c9dc5U;
    for (const char byte : text) {
        hash ^= static_cast<std::uint8_t>(byte);
        hash *= 0x01000193U;
    }
    return hash;
}

} // namespace

SeededRandom::SeededRandom(std::string seed) : seed_(std::move(seed)), state_(fnv1a(seed_)) {}

double SeededRandom::next() {
    // mulberry32, as in packages/core/src/clock.ts. Unsigned 32-bit arithmetic wraps exactly as
    // Math.imul and >>> 0 do.
    constexpr std::uint32_t increment = 0x6d2b79f5U;
    std::uint32_t t = state_.fetch_add(increment) + increment;
    t = (t ^ (t >> 15)) * (t | 1U);
    t ^= t + (t ^ (t >> 7)) * (t | 61U);
    return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
}

namespace {

bool state_deadline_passed(const detail::CancellationState& state) {
    return state.deadline_ms && state.clock && state.clock->steady_ms() >= *state.deadline_ms;
}

bool state_cancelled(const detail::CancellationState* state) {
    // Walk the chain iteratively; a parent is never cancelled by its child.
    for (; state != nullptr; state = state->parent.get()) {
        if (state->cancelled.load() || state_deadline_passed(*state)) {
            return true;
        }
    }
    return false;
}

} // namespace

bool CancellationToken::is_cancelled() const noexcept {
    return state_cancelled(state_.get());
}

bool CancellationToken::deadline_passed() const noexcept {
    return state_ && state_deadline_passed(*state_);
}

std::optional<double> CancellationToken::deadline_ms() const noexcept {
    return state_ ? state_->deadline_ms : std::nullopt;
}

CancellationSource::CancellationSource() : state_(std::make_shared<detail::CancellationState>()) {}

CancellationSource::CancellationSource(double deadline_ms, std::shared_ptr<const Clock> clock)
    : state_(std::make_shared<detail::CancellationState>()) {
    state_->deadline_ms = deadline_ms;
    state_->clock = std::move(clock);
}

CancellationSource::CancellationSource(const CancellationToken& parent,
                                       std::optional<double> deadline_ms,
                                       std::shared_ptr<const Clock> clock)
    : state_(std::make_shared<detail::CancellationState>()) {
    state_->deadline_ms = deadline_ms;
    state_->clock = std::move(clock);
    state_->parent = parent.state_;
}

void InlineTaskRunner::run_all(std::size_t count, const std::function<void(std::size_t)>& task) {
    for (std::size_t i = 0; i < count; ++i) {
        task(i);
    }
}

#if AFD_ENABLE_THREADS
void ThreadTaskRunner::run_all(std::size_t count, const std::function<void(std::size_t)>& task) {
    if (count == 0) {
        return;
    }
#if AFD_HAS_EXCEPTIONS
    std::exception_ptr first_error;
    std::mutex error_mutex;
    const auto run_task = [&](std::size_t index) {
        try {
            task(index);
        } catch (...) {
            const std::lock_guard lock(error_mutex);
            if (!first_error) {
                first_error = std::current_exception();
            }
        }
    };
#else
    const auto& run_task = task;
#endif
    {
        // Destruction joins started workers even if a later thread fails to start.
        // Keep the task and exception state alive until every worker has finished.
        std::vector<std::jthread> threads;
        threads.reserve(count - 1);
        for (std::size_t i = 1; i < count; ++i) {
            threads.emplace_back([&run_task, i] { run_task(i); });
        }
        run_task(0);
    }
#if AFD_HAS_EXCEPTIONS
    if (first_error) {
        std::rethrow_exception(first_error);
    }
#endif
}
#endif

} // namespace afd
