add_executable(afd_benchmarks benchmarks.cpp)
target_link_libraries(afd_benchmarks PRIVATE afd::afd)
afd_configure_target(afd_benchmarks)
if(EMSCRIPTEN)
    # Runs under Node, which loads .js as an ES module under the repository's "type": "module";
    # Emscripten's Node output is CommonJS, so name it .cjs. EXIT_RUNTIME keeps the exit code.
    target_link_options(afd_benchmarks PRIVATE -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=1)
    set_target_properties(afd_benchmarks PROPERTIES SUFFIX ".cjs")
endif()
