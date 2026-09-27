#include "afd/runtime.hpp"

#include <chrono>
#include <vector>

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

SeededRandom::SeededRandom() : engine_(std::random_device{}()) {}

double SeededRandom::next() {
    const std::lock_guard lock(mutex_);
    return std::uniform_real_distribution<double>(0.0, 1.0)(engine_);
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
    std::vector<std::thread> threads;
    threads.reserve(count - 1);
    for (std::size_t i = 1; i < count; ++i) {
        threads.emplace_back([&task, i] { task(i); });
    }
    task(0);
    for (auto& thread : threads) {
        thread.join();
    }
}
#endif

} // namespace afd
