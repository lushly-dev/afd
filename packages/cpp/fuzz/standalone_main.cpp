// Runs a fuzz target on every file under the given directories (or files), for compilers without
// libFuzzer. Replays the seed corpus; it does not generate new inputs.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size);

namespace {

void run_file(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    const std::string bytes{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    LLVMFuzzerTestOneInput(reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size());
}

} // namespace

int main(int argc, char** argv) {
    int files = 0;
    for (int i = 1; i < argc; ++i) {
        std::error_code error;
        const std::filesystem::path path(argv[i]);
        if (std::filesystem::is_directory(path, error)) {
            for (std::filesystem::directory_iterator it(path, error), end; !error && it != end;
                 it.increment(error)) {
                if (it->is_regular_file(error)) {
                    run_file(it->path());
                    ++files;
                }
            }
        } else {
            run_file(path);
            ++files;
        }
    }
    std::printf("Replayed %d input(s)\n", files);
    return files > 0 ? 0 : 1;
}
