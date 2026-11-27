// The idempotency key's form (K2), derived keys (K4) and the refusal of a malformed key.
#include "afd/afd.hpp"

#include <string>

#include <doctest.h>

TEST_CASE("an idempotency key has K2's form") {
    CHECK(afd::is_idempotency_key("Order-2026.11_26~retry1"));
    CHECK(afd::is_idempotency_key(std::string(200, 'k')));
    CHECK_FALSE(afd::is_idempotency_key(std::string(201, 'k')));
    for (const char* bad : {"", "a:b", "a b", "a/b", "caf\xC3\xA9"}) {
        CHECK_FALSE(afd::is_idempotency_key(bad));
    }
}

TEST_CASE("batch items and pipeline steps derive their keys (K4)") {
    CHECK(afd::derive_idempotency_key("k1", afd::IdempotencyRequestKind::batch, 12) == "k1:12");
    CHECK(afd::derive_idempotency_key("k1", afd::IdempotencyRequestKind::pipeline, 3) ==
          "k1:step:3");
}

TEST_CASE("declarations and the refusal of a malformed key") {
    CHECK(afd::is_idempotency_support("natural"));
    CHECK(afd::is_idempotency_support("keyed"));
    CHECK_FALSE(afd::is_idempotency_support("always"));
    CHECK(afd::idempotency_support_name(afd::IdempotencySupport::keyed) == "keyed");
    const auto error = afd::invalid_idempotency_key_error();
    CHECK(error.code == afd::error_codes::VALIDATION_ERROR);
    CHECK(error.retryable == false);
    CHECK(error.suggestion.has_value());
    REQUIRE(error.details.has_value());
    CHECK((*error.details)["meta"] == "dev.afd/idempotencyKey");
    CHECK((*error.details)["field"] == "idempotencyKey");
}
