afd_fetch_doctest()

add_executable(
    afd_tests
    batch_test.cpp
    command_test.cpp
    direct_client_test.cpp
    handoff_test.cpp
    helpers_test.cpp
    json_test.cpp
    main.cpp
    middleware_test.cpp
    pipeline_test.cpp
    pipeline_variables_test.cpp
    registry_test.cpp
    result_test.cpp
    schema_test.cpp
    similarity_test.cpp
    smoke_test.cpp
    stream_test.cpp
    vectors_test.cpp
    wire_fixtures_test.cpp)
target_link_libraries(afd_tests PRIVATE afd::afd afd_doctest)
# main.cpp compiles doctest's implementation; in a unity build it must not share a translation
# unit with a test file that included doctest.h first.
set_source_files_properties(main.cpp PROPERTIES SKIP_UNITY_BUILD_INCLUSION ON)
afd_configure_target(afd_tests)

# The golden wire fixtures every AFD implementation round-trips (spec/wire/README.md).
cmake_path(SET afd_wire_dir NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/wire")
target_compile_definitions(afd_tests PRIVATE AFD_WIRE_DIR="${afd_wire_dir}")
# Language-neutral behavior vectors, generated from the TypeScript implementation.
cmake_path(SET afd_vectors_dir NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/vectors")
target_compile_definitions(afd_tests PRIVATE AFD_VECTORS_DIR="${afd_vectors_dir}")
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

if(AFD_MACRO_HYGIENE_CHECK)
    # Compiles every public header with the collisions defined; building it is the check.
    add_library(afd_macro_hygiene_check OBJECT macro_hygiene_check.cpp)
    target_link_libraries(afd_macro_hygiene_check PRIVATE afd::afd)
    afd_configure_target(afd_macro_hygiene_check)
    afd_apply_macro_hygiene(afd_macro_hygiene_check)
    add_dependencies(afd_tests afd_macro_hygiene_check)
endif()
