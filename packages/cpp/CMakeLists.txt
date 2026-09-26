cmake_minimum_required(VERSION 3.25)

project(
    afd
    VERSION 0.1.0
    DESCRIPTION "Agent-First Development (AFD) core for C++"
    HOMEPAGE_URL "https://github.com/lushly-dev/afd"
    LANGUAGES CXX)

option(AFD_BUILD_TESTS "Build the afd-cpp tests" ${PROJECT_IS_TOP_LEVEL})
option(AFD_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" OFF)
option(AFD_BUILD_FUZZERS "Build the fuzz targets (libFuzzer with Clang, corpus replay elsewhere)" OFF)
option(AFD_USE_SYSTEM_JSON "Require nlohmann_json from find_package instead of downloading it" OFF)
if(EMSCRIPTEN)
    set(afd_threads_default OFF)
else()
    set(afd_threads_default ON)
endif()
option(AFD_ENABLE_THREADS "Build ThreadTaskRunner (std::thread)" ${afd_threads_default})
option(AFD_MACRO_HYGIENE_CHECK
       "Force-include common macro collisions (windows.h min/max, AssertMacros.h check/verify/require)"
       OFF)

# Standard C++ everywhere (-std=c++20, not gnu++20), for every target in this project.
set(CMAKE_CXX_EXTENSIONS OFF)

list(APPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/cmake)
include(AfdDependencies)
include(AfdTargetOptions)

configure_file(cmake/version.hpp.in ${CMAKE_CURRENT_BINARY_DIR}/include/afd/version.hpp @ONLY)

add_library(
    afd
    src/batch.cpp
    src/batch_execution.cpp
    src/command.cpp
    src/detail/json_io.cpp
    src/direct_client.cpp
    src/errors.cpp
    src/handoff.cpp
    src/json.cpp
    src/metadata.cpp
    src/middleware.cpp
    src/pipeline.cpp
    src/pipeline_execution.cpp
    src/registry.cpp
    src/result.cpp
    src/runtime.cpp
    src/schema.cpp
    src/similarity.cpp
    src/stream_execution.cpp
    src/streaming.cpp
    src/version.cpp)
add_library(afd::afd ALIAS afd)
target_compile_features(afd PUBLIC cxx_std_20)
target_include_directories(
    afd
    PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
           $<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}/include>
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(afd PUBLIC nlohmann_json::nlohmann_json)
if(AFD_ENABLE_THREADS)
    find_package(Threads REQUIRED)
    target_link_libraries(afd PUBLIC Threads::Threads)
    target_compile_definitions(afd PUBLIC AFD_ENABLE_THREADS=1)
else()
    target_compile_definitions(afd PUBLIC AFD_ENABLE_THREADS=0)
endif()
afd_configure_target(afd)
if(AFD_MACRO_HYGIENE_CHECK)
    afd_apply_macro_hygiene(afd)
endif()

if(AFD_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

if(AFD_BUILD_FUZZERS)
    enable_testing()
    add_subdirectory(fuzz)
endif()
