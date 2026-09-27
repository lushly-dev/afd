# Third-party dependencies for afd-cpp. Every pin lives in this file.
#
# To update a pin: change the version and URL, download the archive, and replace the hash with
# the output of `shasum -a 256 <file>` (or `cmake -E sha256sum <file>`).

include(FetchContent)

# nlohmann/json: the library's only runtime dependency (proposal D2).
# A host that already provides nlohmann_json (>= 3.11) through find_package is used first, so an
# application can supply its own copy. AFD_USE_SYSTEM_JSON makes that copy mandatory.
if(AFD_USE_SYSTEM_JSON)
    find_package(nlohmann_json 3.11 CONFIG REQUIRED)
else()
    # An installed afd package depends on nlohmann_json; when afd downloads it, install it
    # alongside so the installed package is self-contained.
    if(AFD_INSTALL)
        set(JSON_Install ON CACHE INTERNAL "")
    endif()
    FetchContent_Declare(
        nlohmann_json
        URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
        URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        SYSTEM
        FIND_PACKAGE_ARGS 3.11 CONFIG)
    FetchContent_MakeAvailable(nlohmann_json)
endif()

# doctest: tests only. Fetched as the single header.
function(afd_fetch_doctest)
    FetchContent_Declare(
        afd_doctest_header
        URL https://raw.githubusercontent.com/doctest/doctest/v2.5.3/doctest/doctest.h
        URL_HASH SHA256=cfd518a3ef90f67e1f3ba514df23fb3627437de1a2feeba78cf5062a40021421
        DOWNLOAD_NO_EXTRACT TRUE)
    FetchContent_MakeAvailable(afd_doctest_header)
    if(NOT TARGET afd_doctest)
        add_library(afd_doctest INTERFACE)
        target_include_directories(afd_doctest SYSTEM INTERFACE ${afd_doctest_header_SOURCE_DIR})
    endif()
endfunction()
