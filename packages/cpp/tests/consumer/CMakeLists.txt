# A consumer project, built in CI two ways:
#   -DAFD_CONSUME=find_package  (default) against an installed afd (CMAKE_PREFIX_PATH)
#   -DAFD_CONSUME=fetchcontent  from the source tree, as FetchContent users would
cmake_minimum_required(VERSION 3.25)
project(afd_consumer LANGUAGES CXX)

set(AFD_CONSUME "find_package" CACHE STRING "How to get afd: find_package or fetchcontent")

if(AFD_CONSUME STREQUAL "fetchcontent")
    include(FetchContent)
    FetchContent_Declare(afd SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../..)
    FetchContent_MakeAvailable(afd)
else()
    find_package(afd 0.1 CONFIG REQUIRED)
endif()

add_executable(consumer ../../examples/quickstart.cpp)
target_link_libraries(consumer PRIVATE afd::afd)

enable_testing()
add_test(NAME consumer COMMAND consumer)
