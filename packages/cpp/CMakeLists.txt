cmake_minimum_required(VERSION 3.25)

project(
    afd
    VERSION 0.1.0
    DESCRIPTION "Agent-First Development (AFD) core for C++"
    HOMEPAGE_URL "https://github.com/lushly-dev/afd"
    LANGUAGES CXX)

option(AFD_BUILD_TESTS "Build the afd-cpp tests" ${PROJECT_IS_TOP_LEVEL})
option(AFD_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" OFF)
option(AFD_USE_SYSTEM_JSON "Require nlohmann_json from find_package instead of downloading it" OFF)
option(AFD_MACRO_HYGIENE_CHECK
       "Force-include common macro collisions (windows.h min/max, AssertMacros.h check/verify/require)"
       OFF)

# Standard C++ everywhere (-std=c++20, not gnu++20), for every target in this project.
set(CMAKE_CXX_EXTENSIONS OFF)

list(APPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/cmake)
include(AfdDependencies)
include(AfdTargetOptions)

configure_file(cmake/version.hpp.in ${CMAKE_CURRENT_BINARY_DIR}/include/afd/version.hpp @ONLY)

add_library(afd src/version.cpp)
add_library(afd::afd ALIAS afd)
target_compile_features(afd PUBLIC cxx_std_20)
target_include_directories(
    afd PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
               $<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}/include>)
target_link_libraries(afd PUBLIC nlohmann_json::nlohmann_json)
afd_configure_target(afd)
if(AFD_MACRO_HYGIENE_CHECK)
    afd_apply_macro_hygiene(afd)
endif()

if(AFD_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
