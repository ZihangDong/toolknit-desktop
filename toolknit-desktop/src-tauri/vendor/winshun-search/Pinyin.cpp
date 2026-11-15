#include "Pinyin.h"

#include "TextUtil.h"

#include <algorithm>

namespace ws::pinyin {

namespace {

constexpr std::size_t kMaxTerm = 63; // positions 0..63 fit in one 64-bit state set
constexpr std::size_t kMaxText = 512; // code points; file names have at most 255

constexpr bool isAsciiLetter(char c) noexcept
{
    return c >= 'a' && c <= 'z';
}

constexpr bool isAsciiDigit(char c) noexcept
{
    return c >= '0' && c <= '9';
}

std::size_t decodeUtf16(std::u16string_view s, char32_t* out, std::uint16_t* offsets) noexcept
{
    std::size_t n = 0;
    std::size_t i = 0;
    while (i < s.size() && n < kMaxText) {
        char32_t c = s[i];
        std::size_t len = 1;
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.size() && s[i + 1] >= 0xDC00 && s[i + 1] <= 0xDFFF) {
            c = 0x10000 + ((c - 0xD800) << 10) + (s[i + 1] - 0xDC00);
            len = 2;
        }
        offsets[n] = static_cast<std::uint16_t>(i);
        out[n++] = c;
        i += len;
    }
    offsets[n] = static_cast<std::uint16_t>(i);
    return n;
}

// One code point of UTF-8 (WTF-8) at s[i]; sets its length in bytes.
char32_t decodeAt(std::string_view s, std::size_t i, std::size_t& length) noexcept
{
    const auto b = static_cast<unsigned char>(s[i]);
    if (b < 0x80) {
        length = 1;
        return b;
    }
    const std::size_t len = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1;
    length = std::min(len, s.size() - i);
    char32_t c = len == 2 ? (b & 0x1F) : len == 3 ? (b & 0x0F) : (b & 0x07);
    for (std::size_t k = 1; k < length; ++k)
        c = (c << 6) | (static_cast<unsigned char>(s[i + k]) & 0x3F);
    return c;
}

// The first letters of a Chinese character's readings, as bits (a = bit 0).
std::uint32_t initials(char32_t c) noexcept
{
    return detail::kInitials[c - kFirstHan];
}

} // namespace

Readings readings(char32_t c) noexcept
{
    Readings r;
    if (!isHan(c))
        return r;
    for (std::uint32_t packed = detail::kReadings[c - kFirstHan]; packed != 0; packed >>= 10) {
        if (const std::uint32_t syllable = packed & 0x3FF)
            r.items[r.count++] = detail::kSyllables[syllable - 1];
    }
    return r;
}

bool hasHan(std::string_view s) noexcept
{
    // U+4E00..U+9FFF are three bytes in UTF-8, led by E4..E9.
    for (std::size_t i = 0; i + 2 < s.size(); ++i) {
        const auto b = static_cast<unsigned char>(s[i]);
        if (b < 0xE4 || b > 0xE9)
            continue;
        const char32_t c = ((b & 0x0Fu) << 12) | ((static_cast<unsigned char>(s[i + 1]) & 0x3Fu) << 6)
            | (static_cast<unsigned char>(s[i + 2]) & 0x3Fu);
        if (isHan(c))
            return true;
    }
    return false;
}

bool isPinyinTerm(std::string_view folded) noexcept
{
    if (folded.size() < 2 || folded.size() > kMaxTerm)
        return false;
    bool letter = false;
    for (const char c : folded) {
        if (isAsciiLetter(c))
            letter = true;
        else if (!isAsciiDigit(c))
            return false;
    }
    return letter;
}

Matcher::Matcher(std::string_view term, bool commonOnly)
    : m_commonOnly(commonOnly)
{
    if (!isPinyinTerm(term))
        return;
    m_length = term.size();
    m_first = term[0];
    m_firstInitial = isAsciiLetter(term[0]) ? std::uint32_t {1} << (term[0] - 'a') : 0;
    for (std::size_t p = 0; p < term.size(); ++p)
        m_at[static_cast<unsigned char>(term[p])] |= std::uint64_t {1} << p;
}

// From the term positions reached so far, those reached after `c`.
std::uint64_t Matcher::step(char32_t c, std::uint64_t states) const noexcept
{
    if (c < 0x80) {
        const auto folded = text::fold(static_cast<char>(c));
        return (states & m_at[folded]) << 1;
    }
    std::uint64_t next = 0;
    Readings r = readings(c);
    if (m_commonOnly)
        r.count = std::min<std::size_t>(r.count, 1);
    for (const std::string_view syllable : r) {
        // Every non-empty prefix of the syllable: after k letters, `t` holds
        // the positions reached. 'v' (ü) also accepts 'u'.
        std::uint64_t t = states;
        for (const char letter : syllable) {
            const auto l = static_cast<unsigned char>(letter);
            t = (t & (letter == 'v' ? m_at[l] | m_at['u'] : m_at[l])) << 1;
            if (t == 0)
                break;
            next |= t;
        }
    }
    return next;
}

bool Matcher::canStart(char32_t c) const noexcept
{
    if (c < 0x80)
        return text::fold(static_cast<char>(c)) == static_cast<unsigned char>(m_first);
    return isHan(c) && (initials(c) & m_firstInitial);
}

std::optional<Span> Matcher::find(std::span<const char32_t> text) const noexcept
{
    if (m_length == 0)
        return std::nullopt;
    const std::uint64_t done = std::uint64_t {1} << m_length;
    for (std::size_t start = 0; start < text.size(); ++start) {
        if (!canStart(text[start]))
            continue;
        std::uint64_t states = 1; // nothing of the term matched yet
        for (std::size_t i = start; i < text.size(); ++i) {
            states = step(text[i], states);
            if (states & done)
                return Span {start, i + 1 - start};
            if (states == 0)
                break;
        }
    }
    return std::nullopt;
}

std::optional<Span> Matcher::findUtf8(std::string_view text) const noexcept
{
    // Straight on the bytes: this runs on every Chinese name in the index.
    if (m_length == 0)
        return std::nullopt;
    const std::uint64_t done = std::uint64_t {1} << m_length;
    std::size_t length = 0;
    for (std::size_t start = 0; start < text.size(); start += length) {
        const char32_t c = decodeAt(text, start, length);
        if (!canStart(c))
            continue;
        std::uint64_t states = step(c, 1);
        std::size_t i = start + length;
        while (states != 0 && !(states & done) && i < text.size()) {
            std::size_t l = 0;
            states = step(decodeAt(text, i, l), states);
            i += l;
        }
        if (states & done)
            return Span {start, i - start};
    }
    return std::nullopt;
}

std::optional<Span> Matcher::findUtf16(std::u16string_view text) const noexcept
{
    char32_t points[kMaxText];
    std::uint16_t offsets[kMaxText + 1];
    const std::size_t n = decodeUtf16(text, points, offsets);
    const auto span = find({points, n});
    if (!span)
        return std::nullopt;
    return Span {offsets[span->start], static_cast<std::size_t>(offsets[span->start + span->length] - offsets[span->start])};
}

} // namespace ws::pinyin
