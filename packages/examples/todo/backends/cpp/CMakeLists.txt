cmake_minimum_required(VERSION 3.25)

project(
    afd_todo_cpp
    VERSION 1.0.0
    DESCRIPTION "The AFD todo example backend in C++ (stdio MCP server)"
    LANGUAGES CXX)

option(TODO_BUILD_TESTS "Build the backend's tests" ON)

set(CMAKE_CXX_EXTENSIONS OFF)

# On Windows, deep worktree paths combined with FetchContent's nested checkout directories
# exceed MAX_PATH and fail MSBuild with MSB4023 (#1636). Place FetchContent under a short
# per-build-dir path in TEMP unless the caller already configured FETCHCONTENT_BASE_DIR.
if(WIN32 AND NOT FETCHCONTENT_BASE_DIR)
    set(_afd_tmp "$ENV{TEMP}")
    if(NOT _afd_tmp)
        set(_afd_tmp "$ENV{TMP}")
    endif()
    if(_afd_tmp)
        file(TO_CMAKE_PATH "${_afd_tmp}" _afd_tmp)
        string(SHA256 _afd_bin_hash "${CMAKE_BINARY_DIR}")
        string(SUBSTRING "${_afd_bin_hash}" 0 8 _afd_bin_hash)
        set(FETCHCONTENT_BASE_DIR "${_afd_tmp}/afd-fc-${_afd_bin_hash}" CACHE PATH
            "Short FetchContent directory on Windows to avoid MAX_PATH (MSB4023, #1636)")
    endif()
endif()

# The library, from this repository. Its own tests are not built here.
set(AFD_BUILD_TESTS OFF CACHE BOOL "" FORCE)
# The MCP stdio server comes from the library's afd::mcp_stdio target.
set(AFD_BUILD_MCP_STDIO ON CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp ${CMAKE_CURRENT_BINARY_DIR}/afd)

add_library(
    todo_backend STATIC
    src/app.cpp
    src/commands.cpp
    src/commands/batch.cpp
    src/commands/clear.cpp
    src/commands/history.cpp
    src/commands/shared.cpp
    src/commands/single.cpp
    src/store.cpp)
target_include_directories(todo_backend PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(todo_backend PUBLIC afd::afd afd::mcp_stdio)
target_compile_definitions(todo_backend PUBLIC TODO_BACKEND_VERSION="${PROJECT_VERSION}")
afd_configure_target(todo_backend)

add_executable(todo-server-cpp src/main.cpp)
target_link_libraries(todo-server-cpp PRIVATE todo_backend)
afd_configure_target(todo-server-cpp)

if(TODO_BUILD_TESTS)
    enable_testing()
    afd_fetch_doctest()
    add_executable(
        todo_backend_tests
        tests/approvals_test.cpp
        tests/commands_test.cpp
        tests/history_test.cpp
        tests/main.cpp
        tests/mcp_stdio_test.cpp
        tests/spec_test.cpp
        tests/store_test.cpp)
    target_link_libraries(todo_backend_tests PRIVATE todo_backend afd_doctest)
    target_compile_definitions(todo_backend_tests PRIVATE DOCTEST_CONFIG_NO_EXCEPTIONS_BUT_WITH_ALL_ASSERTS
                                                          TODO_SPEC_PATH="${CMAKE_CURRENT_SOURCE_DIR}/../../spec/commands.schema.json")
    afd_configure_target(todo_backend_tests)
    add_test(NAME todo_backend_tests COMMAND todo_backend_tests)
endif()
