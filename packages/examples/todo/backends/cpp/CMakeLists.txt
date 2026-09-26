cmake_minimum_required(VERSION 3.25)

project(
    afd_todo_cpp
    VERSION 1.0.0
    DESCRIPTION "The AFD todo example backend in C++ (stdio MCP server)"
    LANGUAGES CXX)

option(TODO_BUILD_TESTS "Build the backend's tests" ON)

set(CMAKE_CXX_EXTENSIONS OFF)

# The library, from this repository. Its own tests are not built here.
set(AFD_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp ${CMAKE_CURRENT_BINARY_DIR}/afd)

# The shared contract, embedded as bytes: the backend validates inputs against
# spec/commands.schema.json itself rather than a hand-written copy.
set(TODO_SPEC ${CMAKE_CURRENT_SOURCE_DIR}/../../spec/commands.schema.json)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${TODO_SPEC})
file(READ ${TODO_SPEC} todo_spec_hex HEX)
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," todo_spec_bytes "${todo_spec_hex}")
configure_file(cmake/spec_schema.cpp.in ${CMAKE_CURRENT_BINARY_DIR}/spec_schema.cpp @ONLY)

add_library(
    todo_backend STATIC
    src/commands.cpp
    src/mcp_stdio.cpp
    src/spec.cpp
    src/store.cpp
    ${CMAKE_CURRENT_BINARY_DIR}/spec_schema.cpp)
target_include_directories(todo_backend PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(todo_backend PUBLIC afd::afd)
target_compile_definitions(todo_backend PUBLIC TODO_BACKEND_VERSION="${PROJECT_VERSION}")
afd_configure_target(todo_backend)

add_executable(todo-server-cpp src/main.cpp)
target_link_libraries(todo-server-cpp PRIVATE todo_backend)
afd_configure_target(todo-server-cpp)

if(TODO_BUILD_TESTS)
    enable_testing()
    afd_fetch_doctest()
    add_executable(todo_backend_tests tests/main.cpp tests/commands_test.cpp tests/mcp_stdio_test.cpp
                                      tests/store_test.cpp)
    target_link_libraries(todo_backend_tests PRIVATE todo_backend afd_doctest)
    target_compile_definitions(todo_backend_tests PRIVATE DOCTEST_CONFIG_NO_EXCEPTIONS_BUT_WITH_ALL_ASSERTS
                                                          TODO_SPEC_PATH="${TODO_SPEC}")
    afd_configure_target(todo_backend_tests)
    add_test(NAME todo_backend_tests COMMAND todo_backend_tests)
endif()
