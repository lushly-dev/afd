# A consumer project, built in CI two ways:
#   -DAFD_CONSUME=find_package  (default) against an installed afd (CMAKE_PREFIX_PATH)
#   -DAFD_CONSUME=fetchcontent  from the source tree, as FetchContent users would
cmake_minimum_required(VERSION 3.25)
project(afd_consumer LANGUAGES CXX)

set(AFD_CONSUME "find_package" CACHE STRING "How to get afd: find_package or fetchcontent")

if(AFD_CONSUME STREQUAL "fetchcontent")
    include(FetchContent)
    set(AFD_BUILD_MCP_STDIO ON CACHE BOOL "" FORCE)
    FetchContent_Declare(afd SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../..)
    FetchContent_MakeAvailable(afd)
else()
    find_package(afd 0.2 CONFIG REQUIRED)
endif()

add_executable(consumer ../../examples/quickstart.cpp)
target_link_libraries(consumer PRIVATE afd::afd)

enable_testing()
add_test(NAME consumer COMMAND consumer)

# The MCP stdio server, from an afd built with AFD_BUILD_MCP_STDIO.
if(TARGET afd::mcp_stdio)
    add_executable(consumer_mcp_stdio ../../examples/mcp_stdio_server.cpp)
    target_link_libraries(consumer_mcp_stdio PRIVATE afd::mcp_stdio)
    add_test(NAME consumer_mcp_stdio COMMAND consumer_mcp_stdio --self-test)
endif()
