#include "afd/runtime.hpp"

#include <chrono>

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

SeededRandom::SeededRandom() : engine_(std::random_device{}()) {}

double SeededRandom::next() {
    const std::lock_guard lock(mutex_);
    return std::uniform_real_distribution<double>(0.0, 1.0)(engine_);
}

bool CancellationToken::is_cancelled() const noexcept {
    if (!state_) {
        return false;
    }
    if (state_->cancelled.load()) {
        return true;
    }
    return state_->deadline_ms && state_->clock &&
           state_->clock->steady_ms() >= *state_->deadline_ms;
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

} // namespace afd
