// The language-neutral vectors in spec/vectors/recovery.json (spec/recovery.md): every valid
// CommandError passes spec/schema/error.json and round-trips through afd::CommandError unchanged,
// a normalizes case passes and reads to its readsAs, and every invalid one fails the schema and
// reads to exactly its readsAs: the error with each recovery that breaks $defs/recovery dropped
// (rule 7).
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <string>

#include "json_schema_validator.hpp"
#include <doctest.h>

namespace recovery_vectors {

afd::Json load_vectors(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

afd::CommandError parse_error(const afd::Json& value) {
    auto parsed = afd::CommandError::from_json(value);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error());
    return *parsed;
}

// Every recovery in `value`'s cause chain was read: none was dropped as unreadable.
void require_recoveries_kept(const afd::Json& value, const afd::CommandError& error) {
    if (const auto it = value.find("recovery"); it != value.end()) {
        REQUIRE(error.recovery.has_value());
        CHECK(afd::recovery_kind_name(error.recovery->kind) == it->at("kind").get<std::string>());
    }
    if (const auto it = value.find("cause"); it != value.end()) {
        REQUIRE(error.cause != nullptr);
        require_recoveries_kept(*it, *error.cause);
    }
}

// Reads `original` and writes it back, requiring the same JSON value as `expected`, and that every
// integer in `expected` is written as an integer.
void require_reads_as(const afd::Json& original, const afd::Json& expected,
                      const std::string& name) {
    const afd::Json reencoded = parse_error(original);
    CHECK_MESSAGE(reencoded == expected, name << "\nexpected: " << expected.dump(2)
                                              << "\nactual:   " << reencoded.dump(2));
    CHECK_MESSAGE(reencoded.dump() == expected.dump(), name << ": written as " << reencoded.dump());
}

afd::Json error_with(afd::Json recovery) {
    return afd::Json{
        {"code", "SOME_ERROR"}, {"message", "It failed"},   {"suggestion", "What to do next"},
        {"retryable", true},    {"details", {{"id", "x"}}}, {"recovery", std::move(recovery)}};
}

} // namespace recovery_vectors

TEST_CASE("recovery vectors: every valid error passes the schema and round-trips") {
    const afd::Json vectors = recovery_vectors::load_vectors("recovery.json");
    const auto schemas = afd_test::SchemaRegistry::load();
    REQUIRE(vectors.at("valid").is_array());
    REQUIRE_FALSE(vectors.at("valid").empty());
    for (const auto& item : vectors.at("valid")) {
        const std::string name = item.at("name").get<std::string>();
        CAPTURE(name);
        const afd::Json& original = item.at("error");
        const auto problem = schemas.validate("error.json", original);
        CHECK_MESSAGE(!problem.has_value(), name << ": " << problem.value_or(""));

        const afd::CommandError parsed = recovery_vectors::parse_error(original);
        recovery_vectors::require_recoveries_kept(original, parsed);
        if (parsed.recovery) {
            CHECK_FALSE(parsed.recovery->validate().has_value());
            CHECK(afd::is_command_recovery(original.at("recovery")));
        }
        recovery_vectors::require_reads_as(original, original, name);
    }
}

TEST_CASE("recovery vectors: a normalizes case passes the schema and reads to its readsAs") {
    const afd::Json vectors = recovery_vectors::load_vectors("recovery.json");
    const auto schemas = afd_test::SchemaRegistry::load();
    REQUIRE(vectors.at("normalizes").is_array());
    REQUIRE_FALSE(vectors.at("normalizes").empty());
    for (const auto& item : vectors.at("normalizes")) {
        const std::string name = item.at("name").get<std::string>();
        CAPTURE(name);
        const afd::Json& original = item.at("error");
        const auto problem = schemas.validate("error.json", original);
        CHECK_MESSAGE(!problem.has_value(), name << ": " << problem.value_or(""));
        const afd::Json& reads_as = item.at("readsAs");
        const auto reads_as_problem = schemas.validate("error.json", reads_as);
        CHECK_MESSAGE(!reads_as_problem.has_value(),
                      name << " readsAs: " << reads_as_problem.value_or(""));
        recovery_vectors::require_reads_as(original, reads_as, name);
    }
}

TEST_CASE("recovery vectors: every invalid error fails the schema and reads to its readsAs") {
    const afd::Json vectors = recovery_vectors::load_vectors("recovery.json");
    const auto schemas = afd_test::SchemaRegistry::load();
    REQUIRE(vectors.at("invalid").is_array());
    REQUIRE_FALSE(vectors.at("invalid").empty());
    for (const auto& item : vectors.at("invalid")) {
        const std::string name = item.at("name").get<std::string>();
        const std::string rule = item.at("rule").get<std::string>();
        CAPTURE(name);
        const afd::Json& original = item.at("error");
        CHECK_MESSAGE(schemas.validate("error.json", original).has_value(),
                      name << " passed the schema but breaks: " << rule);

        // Rule 7: a reader never refuses the error over its recovery. It drops each recovery
        // that breaks $defs/recovery, on the error and its cause, and keeps everything else.
        recovery_vectors::require_reads_as(original, item.at("readsAs"), name);
    }
}

TEST_CASE("an error whose recovery this version cannot read keeps everything else") {
    for (const afd::Json& recovery : {
             afd::Json{{"kind", "reboot"}},
             afd::Json{{"command", "issue-check"}},
             afd::Json{{"kind", "call"}},
             afd::Json{{"kind", "call"}, {"command", ""}},
             afd::Json{{"kind", "external"}, {"command", "issue-check"}},
             afd::Json{{"kind", "fix-input"}, {"thenRetry", true}},
             afd::Json{{"kind", "call"}, {"command", "issue-check"}, {"afterMs", 10}},
             afd::Json{{"kind", "retry"}, {"input", {{"a", 1}}}},
             afd::Json{{"kind", "stop"}, {"needs", afd::Json::array({"a"})}},
             afd::Json{{"kind", "retry"}, {"afterMs", -1}},
             afd::Json{{"kind", "retry"}, {"afterMs", 1.5}},
             afd::Json{{"kind", "fix-input"}, {"input", afd::Json::array({1})}},
             afd::Json{
                 {"kind", "call"}, {"command", "x-y"}, {"needs", afd::Json::array({"a", "a"})}},
             afd::Json{{"kind", "fix-input"}, {"needs", afd::Json::array({""})}},
             afd::Json{{"kind", "fix-input"}, {"needs", afd::Json::array()}},
             afd::Json{{"kind", "fix-input"}, {"needs", afd::Json::array({1})}},
             afd::Json{{"kind", "fix-input"}},
             afd::Json{{"kind", "fix-input"}, {"input", afd::Json::object()}},
             afd::Json{{"kind", "fix-input"}, {"input", {{"confirm", true}}}},
             afd::Json{{"kind", "fix-input"}, {"input", nullptr}},
             afd::Json{{"kind", "call"}, {"command", 7}},
             afd::Json{{"kind", "call"}, {"command", "issue-check"}, {"thenRetry", "true"}},
             afd::Json{{"kind", "call"}, {"command", "issue-check"}, {"thenRetry", nullptr}},
             afd::Json{{"kind", "retry"}, {"afterMs", "30000"}},
             afd::Json{{"kind", "retry"}, {"afterMs", true}},
             afd::Json{{"kind", "retry"}, {"afterMs", 1e19}},
             afd::Json{{"kind", "stop"}, {"reason", "a later field"}},
             afd::Json{{"kind", nullptr}},
             afd::Json{{"kind", 3}},
             afd::Json("retry"),
             afd::Json::array(),
         }) {
        CAPTURE(recovery.dump());
        CHECK_FALSE(afd::is_command_recovery(recovery));
        CHECK_FALSE(afd::Recovery::from_json(recovery).has_value());
        const afd::CommandError error =
            recovery_vectors::parse_error(recovery_vectors::error_with(recovery));
        CHECK_FALSE(error.recovery.has_value());
        CHECK(error.code == "SOME_ERROR");
        CHECK(error.message == "It failed");
        CHECK(error.suggestion == "What to do next");
        CHECK(error.retryable == true);
        REQUIRE(error.details.has_value());
        CHECK(*error.details == afd::Json{{"id", "x"}});
        // Written back, the error carries no recovery rather than the one it could not read.
        CHECK_FALSE(afd::Json(error).contains("recovery"));
    }

    // A cause's unreadable recovery is dropped the same way; the cause itself is kept.
    afd::Json outer = recovery_vectors::error_with({{"kind", "external"}});
    outer["cause"] = recovery_vectors::error_with({{"kind", "reboot"}});
    const afd::CommandError error = recovery_vectors::parse_error(outer);
    REQUIRE(error.recovery.has_value());
    CHECK(error.recovery->kind == afd::RecoveryKind::external);
    REQUIRE(error.cause != nullptr);
    CHECK_FALSE(error.cause->recovery.has_value());
    CHECK(error.cause->suggestion == "What to do next");

    // An explicit null is an absent recovery, as for every optional wire field.
    CHECK_FALSE(
        recovery_vectors::parse_error(recovery_vectors::error_with(nullptr)).recovery.has_value());
}

TEST_CASE("a recovery reader names what breaks $defs/recovery") {
    const auto read_error = [](const afd::Json& value) {
        const auto read = afd::Recovery::from_json(value);
        REQUIRE_FALSE(read.has_value());
        return read.error();
    };
    CHECK(read_error(afd::Json{{"kind", "stop"}, {"reason", "a later field"}}) ==
          "reason: is not a recovery member");
    CHECK(read_error(afd::Json{{"kind", "fix-input"}, {"input", nullptr}}) ==
          "input: must not be null; omit an unset field");
    CHECK(read_error(afd::Json{{"kind", "retry"}, {"afterMs", "30000"}}) ==
          "afterMs: expected an integer");
    CHECK(read_error(afd::Json{{"kind", "call"}, {"command", "x"}, {"thenRetry", "true"}}) ==
          "thenRetry: expected a boolean");
    CHECK(read_error(afd::Json("call")) == "(root): expected an object");
    CHECK(read_error(afd::Json{{"command", "x"}}) == "kind: is required");
}

TEST_CASE("a recovery reader reads a whole number with a zero fraction as an integer") {
    for (const afd::Json& after_ms : {afd::Json(30000.0), afd::Json(0.0), afd::Json(-0.0)}) {
        CAPTURE(after_ms.dump());
        const auto recovery =
            afd::Recovery::from_json(afd::Json{{"kind", "retry"}, {"afterMs", after_ms}});
        REQUIRE(recovery.has_value());
        CHECK(afd::Json(*recovery).dump() ==
              afd::Json{{"kind", "retry"}, {"afterMs", after_ms.get<std::int64_t>()}}.dump());
    }
    // 2^53 - 1, the schema's maximum, reads whichever way it is written; one more does not.
    for (const afd::Json& after_ms :
         {afd::Json(9007199254740991.0), afd::Json(std::uint64_t{9007199254740991})}) {
        const auto largest =
            afd::Recovery::from_json(afd::Json{{"kind", "retry"}, {"afterMs", after_ms}});
        REQUIRE(largest.has_value());
        CHECK(largest->after_ms == std::int64_t{9007199254740991});
    }
    for (const afd::Json& after_ms : {afd::Json(std::uint64_t{9007199254740992}),
                                      afd::Json(4611686018427387904.0), afd::Json(1e20)}) {
        CAPTURE(after_ms.dump());
        CHECK_FALSE(afd::Recovery::from_json(afd::Json{{"kind", "retry"}, {"afterMs", after_ms}})
                        .has_value());
    }
}

TEST_CASE("Recovery writes camelCase keys and omits unset fields") {
    CHECK(afd::Json(afd::Recovery{.kind = afd::RecoveryKind::stop}) == afd::Json{{"kind", "stop"}});
    CHECK(afd::Json(afd::Recovery{.kind = afd::RecoveryKind::retry, .after_ms = 30000}) ==
          afd::Json{{"kind", "retry"}, {"afterMs", 30000}});
    CHECK(afd::Json(afd::Recovery{.kind = afd::RecoveryKind::call,
                                  .command = "cell-register",
                                  .input = afd::Json{{"route", "sol/high"}},
                                  .needs = std::vector<std::string>{"issues"},
                                  .then_retry = true}) ==
          afd::Json{{"kind", "call"},
                    {"command", "cell-register"},
                    {"input", {{"route", "sol/high"}}},
                    {"needs", afd::Json::array({"issues"})},
                    {"thenRetry", true}});
    CHECK(afd::Json(afd::Recovery{.kind = afd::RecoveryKind::fix_input,
                                  .needs = std::vector<std::string>{"branch"}}) ==
          afd::Json{{"kind", "fix-input"}, {"needs", afd::Json::array({"branch"})}});

    // An error without a recovery writes none.
    CHECK_FALSE(afd::Json(afd::create_error("E", "m")).contains("recovery"));
}

TEST_CASE("RecoveryKind names match the wire") {
    REQUIRE(afd::recovery_kinds.size() == 5);
    const char* names[] = {"call", "fix-input", "retry", "external", "stop"};
    for (std::size_t i = 0; i < afd::recovery_kinds.size(); ++i) {
        CHECK(afd::recovery_kind_name(afd::recovery_kinds[i]) == names[i]);
        CHECK(afd::parse_recovery_kind(names[i]) == afd::recovery_kinds[i]);
    }
    CHECK_FALSE(afd::parse_recovery_kind("fix_input").has_value());
    CHECK_FALSE(afd::parse_recovery_kind("reboot").has_value());
}

TEST_CASE("Recovery::validate names the rule a recovery built in C++ breaks") {
    using afd::RecoveryKind;
    CHECK_FALSE(
        afd::Recovery{.kind = RecoveryKind::call, .command = "issue-check"}.validate().has_value());
    CHECK_FALSE(afd::Recovery{.kind = RecoveryKind::external}.validate().has_value());

    const auto problem = [](const afd::Recovery& recovery) {
        return recovery.validate().value_or("");
    };
    CHECK(problem({.kind = RecoveryKind::call}) == "command: a call recovery names its command");
    CHECK(problem({.kind = RecoveryKind::call, .command = ""}) == "command: must not be empty");
    CHECK(problem({.kind = RecoveryKind::stop, .command = "issue-check"}) ==
          "command: belongs to a call recovery, not stop");
    CHECK(problem({.kind = RecoveryKind::fix_input, .then_retry = true}) ==
          "thenRetry: belongs to a call recovery, not fix-input");
    CHECK(problem({.kind = RecoveryKind::external, .after_ms = 5}) ==
          "afterMs: belongs to a retry recovery, not external");
    CHECK(problem({.kind = RecoveryKind::retry, .after_ms = -1}) == "afterMs: must be at least 0");
    CHECK(problem({.kind = RecoveryKind::retry, .input = afd::Json::object()}) ==
          "input: belongs to a call or fix-input recovery, not retry");
    CHECK(problem({.kind = RecoveryKind::stop, .needs = std::vector<std::string>{"a"}}) ==
          "needs: belongs to a call or fix-input recovery, not stop");
    CHECK(problem({.kind = RecoveryKind::fix_input, .input = afd::Json::array()}) ==
          "input: expected an object");
    CHECK(problem({.kind = RecoveryKind::fix_input, .needs = std::vector<std::string>{"a", "a"}}) ==
          "needs: names 'a' twice");
    CHECK(problem({.kind = RecoveryKind::fix_input, .input = afd::Json::object()}) ==
          "input: must have at least one member");
    CHECK(problem({.kind = RecoveryKind::fix_input, .input = afd::Json{{"confirm", true}}}) ==
          "input: must not carry confirm; a field the caller must decide goes in needs");
    CHECK(problem({.kind = RecoveryKind::call,
                   .command = "issue-check",
                   .needs = std::vector<std::string>{}}) == "needs: must name at least one field");
    CHECK(problem({.kind = RecoveryKind::fix_input}) ==
          "input: a fix-input recovery sets input or needs");

    // The reader reports the same rule, with the path to the recovery.
    const auto read = afd::Recovery::from_json(afd::Json{{"kind", "stop"}, {"command", "x"}});
    REQUIRE_FALSE(read.has_value());
    CHECK(read.error() == "(root): command: belongs to a call recovery, not stop");
}

TEST_CASE("create_error and error carry a recovery") {
    const afd::CommandError error = afd::create_error(
        "LANE_PAUSED", "The lane is paused",
        {.suggestion = "Call lane-resume, then lane-enqueue again",
         .recovery = afd::Recovery{
             .kind = afd::RecoveryKind::call, .command = "lane-resume", .then_retry = true}});
    CHECK(afd::Json(error) ==
          afd::Json{
              {"code", "LANE_PAUSED"},
              {"message", "The lane is paused"},
              {"suggestion", "Call lane-resume, then lane-enqueue again"},
              {"recovery", {{"kind", "call"}, {"command", "lane-resume"}, {"thenRetry", true}}}});

    const afd::CommandResult result = afd::error(
        "RATE_LIMITED", "Rate limit exceeded",
        {.suggestion = "Wait 30 seconds and try again",
         .retryable = true,
         .recovery = afd::Recovery{.kind = afd::RecoveryKind::retry, .after_ms = 30000}});
    REQUIRE(result.error.has_value());
    REQUIRE(result.error->recovery.has_value());
    CHECK(result.error->recovery->after_ms == 30000);
    const auto schemas = afd_test::SchemaRegistry::load();
    const auto problem = schemas.validate("result.json", afd::Json(result));
    CHECK_MESSAGE(!problem.has_value(), problem.value_or(""));
}

TEST_CASE("a recovery that breaks $defs/recovery is refused at construction and never written") {
    // create_error and error leave it off the error.
    const afd::Recovery broken{.kind = afd::RecoveryKind::fix_input};
    REQUIRE(broken.validate().has_value());
    CHECK_FALSE(afd::create_error("E", "m", {.recovery = broken}).recovery.has_value());
    const afd::CommandResult result = afd::error("E", "m", {.recovery = broken});
    REQUIRE(result.error.has_value());
    CHECK_FALSE(result.error->recovery.has_value());

    // An error whose field is set directly is written without it.
    afd::CommandError error = afd::create_error("E", "m", {.suggestion = "Do this"});
    error.recovery = afd::Recovery{.kind = afd::RecoveryKind::retry, .input = afd::Json{{"a", 1}}};
    CHECK(afd::Json(error) ==
          afd::Json{{"code", "E"}, {"message", "m"}, {"suggestion", "Do this"}});
}
