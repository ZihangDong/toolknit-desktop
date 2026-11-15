// ToolKnit adapter to WinShun's MIT filename/pinyin matcher. See README.md.
#include "Pinyin.h"
#include "TextUtil.h"
#include <new>

struct TkMatcher {
    std::string term;
    ws::pinyin::Matcher pinyin;
    explicit TkMatcher(std::string_view s):term(ws::text::foldAscii(s)),pinyin(term){}
};
extern "C" void* tk_search_matcher_create(const char* text, std::size_t length) noexcept {
    if (!text || length == 0 || length > 1024) return nullptr;
    try { return new TkMatcher(std::string_view(text,length)); } catch (...) { return nullptr; }
}
extern "C" void tk_search_matcher_destroy(void* opaque) noexcept { delete static_cast<TkMatcher*>(opaque); }
extern "C" bool tk_search_literal(const void* opaque,const char* text,std::size_t length) noexcept {
    if (!opaque || !text || length > 131072) return false;
    return ws::text::findFolded(std::string_view(text,length),static_cast<const TkMatcher*>(opaque)->term)!=ws::text::npos;
}
// 0 no match; 1 exact; 2 prefix; 3 substring; 4 pinyin. No padded reads.
extern "C" unsigned tk_search_match(const void* opaque,const char* text,std::size_t length) noexcept {
    if (!opaque || !text || length > 32768) return 0;
    const auto& m=*static_cast<const TkMatcher*>(opaque);
    const std::string_view name(text,length);
    if (ws::text::equalsFolded(name,m.term)) return 1;
    const auto at=ws::text::findFolded(name,m.term);
    if (at!=ws::text::npos) return at==0?2:3;
    return m.pinyin.valid() && m.pinyin.findUtf8(name).has_value()?4:0;
}
