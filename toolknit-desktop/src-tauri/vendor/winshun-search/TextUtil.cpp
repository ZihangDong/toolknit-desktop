#include "TextUtil.h"

#include <emmintrin.h> // SSE2: always available on x64

#include <algorithm>
#include <bit>

namespace ws::text {

std::string foldAscii(std::string_view s)
{
    std::string out(s);
    for (char& c : out)
        c = static_cast<char>(fold(c));
    return out;
}

bool equalsFolded(std::string_view s, std::string_view folded) noexcept
{
    if (s.size() != folded.size())
        return false;
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (fold(s[i]) != static_cast<unsigned char>(folded[i]))
            return false;
    }
    return true;
}

bool equalsIgnoreAsciiCase(std::string_view a, std::string_view b) noexcept
{
    if (a.size() != b.size())
        return false;
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (fold(a[i]) != fold(b[i]))
            return false;
    }
    return true;
}

std::size_t findFolded(std::string_view hay, std::string_view needle, std::size_t from) noexcept
{
    const std::size_t m = needle.size();
    if (m == 0)
        return from <= hay.size() ? from : npos;
    if (hay.size() < m)
        return npos;
    const auto first = static_cast<unsigned char>(needle[0]);
    const std::size_t last = hay.size() - m;
    for (std::size_t i = from; i <= last; ++i) {
        if (fold(hay[i]) != first)
            continue;
        std::size_t j = 1;
        while (j < m && fold(hay[i + j]) == static_cast<unsigned char>(needle[j]))
            ++j;
        if (j == m)
            return i;
    }
    return npos;
}

std::size_t findFoldedPadded(std::string_view hay, std::string_view needle) noexcept
{
    const std::size_t n = hay.size();
    const std::size_t m = needle.size();
    if (m == 0)
        return 0;
    if (n < m)
        return npos;

    // Candidates must match the needle's first AND last byte (either case);
    // only those get the full comparison. Most names fail right here.
    const auto first = static_cast<unsigned char>(needle[0]);
    const auto last = static_cast<unsigned char>(needle[m - 1]);
    const auto upper
        = [](unsigned char c) { return c >= 'a' && c <= 'z' ? static_cast<char>(c - 32) : static_cast<char>(c); };
    const __m128i f1 = _mm_set1_epi8(static_cast<char>(first));
    const __m128i f2 = _mm_set1_epi8(upper(first));
    const __m128i l1 = _mm_set1_epi8(static_cast<char>(last));
    const __m128i l2 = _mm_set1_epi8(upper(last));
    const char* p = hay.data();
    const std::size_t lastStart = n - m;

    for (std::size_t i = 0; i <= lastStart; i += 16) {
        const __m128i a = _mm_loadu_si128(reinterpret_cast<const __m128i*>(p + i));
        const __m128i b = _mm_loadu_si128(reinterpret_cast<const __m128i*>(p + i + m - 1));
        const __m128i hit = _mm_and_si128(_mm_or_si128(_mm_cmpeq_epi8(a, f1), _mm_cmpeq_epi8(a, f2)),
            _mm_or_si128(_mm_cmpeq_epi8(b, l1), _mm_cmpeq_epi8(b, l2)));
        auto mask = static_cast<unsigned>(_mm_movemask_epi8(hit));
        while (mask) {
            const std::size_t pos = i + static_cast<std::size_t>(std::countr_zero(mask));
            if (pos > lastStart)
                return npos; // past the end: padding bytes
            std::size_t j = 1;
            while (j + 1 < m && fold(p[pos + j]) == static_cast<unsigned char>(needle[j]))
                ++j;
            if (j + 1 >= m)
                return pos;
            mask &= mask - 1;
        }
    }
    return npos;
}

namespace {

bool isUpper(unsigned char c) noexcept
{
    return c >= 'A' && c <= 'Z';
}
bool isLower(unsigned char c) noexcept
{
    return c >= 'a' && c <= 'z';
}
bool isDigit(unsigned char c) noexcept
{
    return c >= '0' && c <= '9';
}
bool isAlnum(unsigned char c) noexcept
{
    return isUpper(c) || isLower(c) || isDigit(c);
}

bool isSeparator(unsigned char c) noexcept
{
    switch (c) {
    case ' ':
    case '_':
    case '-':
    case '.':
    case '(':
    case ')':
    case '[':
    case ']':
    case '{':
    case '}':
    case '+':
    case ',':
    case '&':
    case '@':
    case '#':
    case '~':
    case '\'':
    case '!':
    case '=':
    case ';':
        return true;
    default:
        return false;
    }
}

std::size_t codePointLength(std::string_view s, std::size_t i) noexcept
{
    const auto c = static_cast<unsigned char>(s[i]);
    std::size_t len = c < 0x80 ? 1 : c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
    return std::min(len, s.size() - i);
}

} // namespace

bool isWordStart(std::string_view s, std::size_t pos) noexcept
{
    if (pos == 0)
        return true;
    if (pos >= s.size())
        return false;
    const auto prev = static_cast<unsigned char>(s[pos - 1]);
    const auto cur = static_cast<unsigned char>(s[pos]);
    if (isSeparator(prev))
        return true;
    if (isLower(prev) && isUpper(cur))
        return true;
    if (isAlnum(prev) && isAlnum(cur) && isDigit(prev) != isDigit(cur))
        return true;
    if (prev >= 0x80 && cur < 0x80 && isAlnum(cur))
        return true;
    if (prev < 0x80 && cur >= 0xC0) // ASCII -> start of a multi-byte character
        return true;
    return false;
}

bool wordInitialsMatch(std::string_view name, std::string_view foldedInitials) noexcept
{
    if (foldedInitials.size() < 2 || foldedInitials.size() > 12
        || !std::ranges::all_of(foldedInitials, [](unsigned char c) { return c < 0x80 && isAlnum(c); }))
        return false;
    std::size_t matched = 0;
    bool first = true;
    for (std::size_t i = 0; i < name.size(); ++i) {
        const auto c = static_cast<unsigned char>(name[i]);
        if (c >= 0x80 || !isAlnum(c) || !isWordStart(name, i))
            continue;
        if (first && fold(c) != static_cast<unsigned char>(foldedInitials.front()))
            return false;
        first = false;
        if (fold(c) == static_cast<unsigned char>(foldedInitials[matched]) && ++matched == foldedInitials.size())
            return true;
    }
    return false;
}

bool globMatch(std::string_view s, std::string_view p) noexcept
{
    std::size_t si = 0;
    std::size_t pi = 0;
    std::size_t starP = npos;
    std::size_t starS = 0;
    while (si < s.size()) {
        if (pi < p.size() && p[pi] == '*') {
            starP = pi++;
            starS = si;
            continue;
        }
        if (pi < p.size() && p[pi] == '?') {
            si += codePointLength(s, si);
            ++pi;
            continue;
        }
        if (pi < p.size() && fold(s[si]) == static_cast<unsigned char>(p[pi])) {
            ++si;
            ++pi;
            continue;
        }
        if (starP != npos) {
            pi = starP + 1;
            starS += codePointLength(s, starS);
            si = starS;
            continue;
        }
        return false;
    }
    while (pi < p.size() && p[pi] == '*')
        ++pi;
    return pi == p.size();
}

} // namespace ws::text
