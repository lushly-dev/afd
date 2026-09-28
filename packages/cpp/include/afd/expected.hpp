// A minimal stand-in for C++23 std::expected, for this C++20 library. It never throws.
#pragma once

#include <cassert>
#include <string>
#include <type_traits>
#include <utility>
#include <variant>

namespace afd {

/// The error half of an `Expected`, as in C++23 `std::unexpected`.
template <class E>
struct Unexpected {
    E error;
};

/// Wraps `error` so it converts to a failed `Expected`.
template <class E>
Unexpected<std::decay_t<E>> unexpected(E&& error) {
    return Unexpected<std::decay_t<E>>{std::forward<E>(error)};
}

/// Either a value or an error. Accessing the wrong side is a precondition violation (asserted),
/// never an exception, so this works in builds without exceptions.
template <class T, class E = std::string>
class [[nodiscard]] Expected {
public:
    Expected(const T& value) : storage_(std::in_place_index<0>, value) {}
    Expected(T&& value) : storage_(std::in_place_index<0>, std::move(value)) {}
    template <class G>
    Expected(Unexpected<G> failure) : storage_(std::in_place_index<1>, std::move(failure.error)) {}

    [[nodiscard]] bool has_value() const noexcept { return storage_.index() == 0; }
    explicit operator bool() const noexcept { return has_value(); }

    T& value() & {
        assert(has_value());
        return *std::get_if<0>(&storage_);
    }
    const T& value() const& {
        assert(has_value());
        return *std::get_if<0>(&storage_);
    }
    T&& value() && {
        assert(has_value());
        return std::move(*std::get_if<0>(&storage_));
    }
    T& operator*() & { return value(); }
    const T& operator*() const& { return value(); }
    T* operator->() { return &value(); }
    const T* operator->() const { return &value(); }

    const E& error() const& {
        assert(!has_value());
        return *std::get_if<1>(&storage_);
    }

private:
    std::variant<T, E> storage_;
};

} // namespace afd
