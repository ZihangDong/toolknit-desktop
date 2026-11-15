#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>

// Finding Chinese names by pinyin: "bg", "baogao", "baog" and "bgao" all find
// 报告. Each Chinese character matches a non-empty prefix of one of its
// readings (initials, whole syllables, or a mix); every other character must
// match itself, ASCII case folded.
namespace ws::pinyin {

namespace detail {
extern const std::size_t kSyllableCount;
extern const std::string_view kSyllables[];
extern const std::uint32_t kReadings[]; // see PinyinTable.cpp
extern const std::uint32_t kInitials[];
} // namespace detail

inline constexpr char32_t kFirstHan = 0x4E00;
inline constexpr char32_t kLastHan = 0x9FFF;

constexpr bool isHan(char32_t c) noexcept
{
    return c >= kFirstHan && c <= kLastHan;
}

// Up to three readings of a character, without tones ("lv" for 绿), most
// common first. Empty for anything but a Chinese character.
struct Readings {
    std::array<std::string_view, 3> items {};
    std::size_t count = 0;

    const std::string_view* begin() const noexcept { return items.data(); }
    const std::string_view* end() const noexcept { return items.data() + count; }
};
Readings readings(char32_t c) noexcept;

// Whether UTF-8 (WTF-8) text contains a Chinese character.
bool hasHan(std::string_view utf8) noexcept;

// Whether a folded query term is worth trying as pinyin: two or more ASCII
// letters and digits, at least one of them a letter.
bool isPinyinTerm(std::string_view folded) noexcept;

struct Span {
    std::size_t start;
    std::size_t length;
};

// Matches one folded query term against text, reading Chinese characters as
// pinyin. Immutable: one per term, shared by search threads.
class Matcher {
public:
    // `commonOnly`: each character by its most common reading only.
    explicit Matcher(std::string_view foldedTerm, bool commonOnly = false);

    bool valid() const noexcept { return m_length > 0; }

    // The leftmost match, in code points.
    std::optional<Span> find(std::span<const char32_t> text) const noexcept;
    // The same on UTF-8 (WTF-8) or UTF-16 text; spans in bytes or UTF-16 units.
    std::optional<Span> findUtf8(std::string_view text) const noexcept;
    std::optional<Span> findUtf16(std::u16string_view text) const noexcept;

private:
    bool canStart(char32_t c) const noexcept;
    std::uint64_t step(char32_t c, std::uint64_t states) const noexcept;

    std::size_t m_length = 0; // 0: not a pinyin term
    bool m_commonOnly = false;
    char m_first = 0;
    std::uint32_t m_firstInitial = 0; // m_first as a bit, if a letter
    std::array<std::uint64_t, 128> m_at {}; // per ASCII character: positions in the term that hold it
};

} // namespace ws::pinyin
