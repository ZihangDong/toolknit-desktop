#pragma once

#include <array>
#include <cstddef>
#include <string>
#include <string_view>

// Byte-level helpers for matching UTF-8 file names. Matching folds ASCII
// letters only: CJK has no case, and it keeps the hot loop branch-light.
namespace ws::text {

inline constexpr std::size_t npos = std::string_view::npos;

inline constexpr std::array<unsigned char, 256> kFoldTable = [] {
    std::array<unsigned char, 256> t {};
    for (int i = 0; i < 256; ++i)
        t[i] = static_cast<unsigned char>(i >= 'A' && i <= 'Z' ? i + 32 : i);
    return t;
}();

inline unsigned char fold(char c) noexcept
{
    return kFoldTable[static_cast<unsigned char>(c)];
}

std::string foldAscii(std::string_view s);

// `folded` must already be folded with foldAscii().
bool equalsFolded(std::string_view s, std::string_view folded) noexcept;
bool equalsIgnoreAsciiCase(std::string_view a, std::string_view b) noexcept;
std::size_t findFolded(std::string_view haystack, std::string_view folded, std::size_t from = 0) noexcept;

// Same result as findFolded(haystack, folded), but compares 16 positions at a
// time with SSE2. May read up to kReadPastEnd bytes beyond the haystack, so it
// is only used on FileIndex names (whose storage is padded for this).
inline constexpr std::size_t kReadPastEnd = 16;
std::size_t findFoldedPadded(std::string_view haystack, std::string_view folded) noexcept;

// True when `pos` starts a "word": after a separator, at a camelCase hump,
// or at a letter/digit transition.
bool isWordStart(std::string_view s, std::size_t pos) noexcept;

// Folded ASCII initials in order, starting at the first word. Camel-case
// subwords may be skipped: "hsm" finds "HiBit Startup Manager" (#135).
bool wordInitialsMatch(std::string_view name, std::string_view foldedInitials) noexcept;

// Glob with '*' and '?' ('?' matches one UTF-8 code point). Pattern is folded.
bool globMatch(std::string_view name, std::string_view foldedPattern) noexcept;

} // namespace ws::text
