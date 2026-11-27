afd_fetch_doctest()

add_executable(
    afd_tests
    app_calls_vectors_test.cpp
    approval_fail_closed_test.cpp
    approval_test.cpp
    approval_vectors_test.cpp
    approver_client_vectors_test.cpp
    batch_test.cpp
    batch_vectors_test.cpp
    bootstrap_test.cpp
    command_test.cpp
    context_fields_test.cpp
    context_test.cpp
    contexts_test.cpp
    direct_client_test.cpp
    dispatch_vectors_test.cpp
    execution_controls_vectors_test.cpp
    handoff_test.cpp
    human_relay_vectors_test.cpp
    helpers_test.cpp
    idempotency_keys_test.cpp
    idempotency_vectors_test.cpp
    journal_context_cap_vectors_test.cpp
    journal_seams_vectors_test.cpp
    journal_secret_test.cpp
    journal_test.cpp
    journal_wire_test.cpp
    json_test.cpp
    main.cpp
    mcp_test.cpp
    middleware_test.cpp
    output_budget_vectors_test.cpp
    pipeline_test.cpp
    pipeline_variables_test.cpp
    recovery_vectors_test.cpp
    registry_test.cpp
    result_test.cpp
    schema_test.cpp
    similarity_test.cpp
    smoke_test.cpp
    stream_test.cpp
    tool_meta_test.cpp
    vectors_test.cpp
    wire_fixtures_test.cpp)
if(AFD_JOURNAL_FILE)
    target_sources(afd_tests PRIVATE journal_file_test.cpp)
endif()
target_link_libraries(afd_tests PRIVATE afd::afd afd_doctest)
if(AFD_BUILD_MCP_STDIO)
    target_sources(afd_tests PRIVATE frontmatter_test.cpp mcp_resources_vectors_test.cpp
                                     tool_strategies_vectors_test.cpp mcp_stdio_test.cpp
                                     mcp_tools_test.cpp)
    target_link_libraries(afd_tests PRIVATE afd::mcp_stdio)
    target_compile_definitions(afd_tests PRIVATE AFD_HAS_MCP_STDIO=1)
endif()
# approval_test.cpp checks the private HMAC and base64url helpers (header-only) directly.
target_include_directories(afd_tests PRIVATE ${PROJECT_SOURCE_DIR}/src)
# main.cpp compiles doctest's implementation; in a unity build it must not share a translation
# unit with a test file that included doctest.h first.
set_source_files_properties(main.cpp PROPERTIES SKIP_UNITY_BUILD_INCLUSION ON)
afd_configure_target(afd_tests)

# The golden wire fixtures every AFD implementation round-trips (spec/wire/README.md).
cmake_path(SET afd_wire_dir NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/wire")
target_compile_definitions(afd_tests PRIVATE AFD_WIRE_DIR="${afd_wire_dir}")
# The JSON Schema 2020-12 definitions every implementation validates against (spec/schema/README.md).
cmake_path(SET afd_schema_dir NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/schema")
target_compile_definitions(afd_tests PRIVATE AFD_SCHEMA_DIR="${afd_schema_dir}")
# Language-neutral behavior vectors, generated from the TypeScript implementation.
cmake_path(SET afd_vectors_dir NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/vectors")
target_compile_definitions(afd_tests PRIVATE AFD_VECTORS_DIR="${afd_vectors_dir}")
# The AFD contract version that afd::contract_version must match.
cmake_path(SET afd_spec_version_file NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/VERSION")
target_compile_definitions(afd_tests PRIVATE AFD_SPEC_VERSION_FILE="${afd_spec_version_file}")
# The meta-tool definitions the MCP server lists, field for field.
cmake_path(SET afd_meta_tools_file NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/meta-tools.json")
target_compile_definitions(afd_tests PRIVATE AFD_META_TOOLS_FILE="${afd_meta_tools_file}")
# The todo example's shared contract, whose input schemas the validator must accept.
cmake_path(SET afd_todo_spec_dir NORMALIZE "${PROJECT_SOURCE_DIR}/../examples/todo/spec")
target_compile_definitions(afd_tests PRIVATE AFD_TODO_SPEC_DIR="${afd_todo_spec_dir}")

# Keep every assertion working in builds without exceptions (proposal D3).
target_compile_definitions(afd_tests PRIVATE DOCTEST_CONFIG_NO_EXCEPTIONS_BUT_WITH_ALL_ASSERTS)

if(EMSCRIPTEN)
    # Tests run under Node. NODERAWFS lets them read spec/ fixtures from the real file system.
    target_link_options(afd_tests PRIVATE -sNODERAWFS=1 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=1)
    # The repository's root package.json sets "type": "module", which makes Node load a .js file
    # as an ES module. Emscripten's Node output is CommonJS, so name it .cjs.
    set_target_properties(afd_tests PROPERTIES SUFFIX ".cjs")
endif()

add_test(NAME afd_tests COMMAND afd_tests)

add_test(
    NAME afd_cmake_compiler_policy
    COMMAND
        ${CMAKE_COMMAND} -DAFD_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -DAFD_TEST_BINARY_DIR=${CMAKE_CURRENT_BINARY_DIR}/compiler-policy
        -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/run_compiler_policy_tests.cmake)

if(AFD_MACRO_HYGIENE_CHECK)
    # Compiles every public header with the collisions defined; building it is the check.
    add_library(afd_macro_hygiene_check OBJECT macro_hygiene_check.cpp)
    target_link_libraries(afd_macro_hygiene_check PRIVATE afd::afd)
    if(AFD_BUILD_MCP_STDIO)
        target_link_libraries(afd_macro_hygiene_check PRIVATE afd::mcp_stdio)
        target_compile_definitions(afd_macro_hygiene_check PRIVATE AFD_HAS_MCP_STDIO=1)
    endif()
    afd_configure_target(afd_macro_hygiene_check)
    afd_apply_macro_hygiene(afd_macro_hygiene_check)
    add_dependencies(afd_tests afd_macro_hygiene_check)
endif()
