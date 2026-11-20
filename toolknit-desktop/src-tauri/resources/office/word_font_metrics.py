"""Installed-font metrics used by the Writer DOCX compatibility layer."""
import functools
import os
import re
import struct


def font_family_aliases(data):
    """Read localized family names from an installed TrueType name table."""
    aliases = set()
    if len(data) < 6:
        return aliases
    _, count, strings = struct.unpack_from(">HHH", data)
    for index in range(min(count, (len(data) - 6) // 12)):
        platform, _, _, name_id, length, offset = struct.unpack_from(">HHHHHH", data, 6 + index * 12)
        start = strings + offset
        if name_id not in (1, 4, 6, 16) or start + length > len(data):
            continue
        try:
            aliases.add(data[start:start + length].decode("utf-16-be" if platform in (0, 3) else "mac_roman").casefold())
        except UnicodeError:
            pass
    return aliases


@functools.lru_cache(maxsize=128)
def windows_font_line_twips(name, points, bold, italic):
    """Read installed font cell + external leading; no Office automation.

    Writer's UNO SimpleFontMetric omits external leading on Windows. Measuring
    an em in twips through GDI keeps automatic empty-line spacing independent
    of monitor DPI and avoids importing an unused complex-script font's height.
    """
    details = windows_font_details(name, points, bold, italic)
    return details[0] if details else None


@functools.lru_cache(maxsize=128)
def windows_font_details(name, points=12, bold=False, italic=False):
    """Return verified GDI metrics and OS/2 embedding restrictions, if present."""
    if os.name != "nt" or not name or len(name) > 31 or not 0 < points < 1638:
        return None
    import ctypes as C
    from ctypes import wintypes as W

    class LogFont(C.Structure):
        _fields_ = [(n, W.LONG) for n in ("height", "width", "escapement", "orientation", "weight")] + [
            (n, W.BYTE) for n in ("italic", "underline", "strikeout", "charset", "outPrecision", "clipPrecision", "quality", "pitch")] + [("face", W.WCHAR * 32)]

    class TextMetric(C.Structure):
        _fields_ = [(n, W.LONG) for n in ("height", "ascent", "descent", "internalLeading", "externalLeading", "averageWidth", "maxWidth", "weight", "overhang", "aspectX", "aspectY")] + [
            (n, W.WCHAR) for n in ("first", "last", "default", "breakChar")] + [(n, W.BYTE) for n in ("italic", "underline", "strikeout", "pitch", "charset")]

    dc = font = previous = None
    try:
        gdi = C.WinDLL("gdi32", use_last_error=True)
        gdi.CreateCompatibleDC.argtypes, gdi.CreateCompatibleDC.restype = [W.HDC], W.HDC
        gdi.CreateFontIndirectW.argtypes, gdi.CreateFontIndirectW.restype = [C.POINTER(LogFont)], W.HFONT
        gdi.SelectObject.argtypes, gdi.SelectObject.restype = [W.HDC, W.HGDIOBJ], W.HGDIOBJ
        gdi.GetTextMetricsW.argtypes = [W.HDC, C.POINTER(TextMetric)]
        gdi.GetTextFaceW.argtypes = [W.HDC, C.c_int, W.LPWSTR]
        gdi.GetFontData.argtypes, gdi.GetFontData.restype = [W.HDC, W.DWORD, W.DWORD, C.c_void_p, W.DWORD], W.DWORD
        gdi.DeleteObject.argtypes, gdi.DeleteDC.argtypes = [W.HGDIOBJ], [W.HDC]
        descriptor = LogFont()
        descriptor.height, descriptor.face = -round(points * 20), name
        descriptor.weight, descriptor.italic, descriptor.charset = 700 if bold else 400, italic, 1
        dc = gdi.CreateCompatibleDC(None)
        if not dc:
            return None
        font = gdi.CreateFontIndirectW(C.byref(descriptor))
        if not font:
            return None
        previous = gdi.SelectObject(dc, font)
        if not previous or previous == C.c_void_p(-1).value:
            previous = None
            return None
        face = C.create_unicode_buffer(128)
        if not gdi.GetTextFaceW(dc, len(face), face):
            return None
        if face.value.casefold() != name.casefold():
            # GDI may return the localized name (e.g. for an English family
            # alias). Verify the name table rather than accept font fallback.
            tag = int.from_bytes(b"name", "little")
            size = gdi.GetFontData(dc, tag, 0, None, 0)
            if not 0 < size <= 1024 * 1024:
                return None
            names = C.create_string_buffer(size)
            if gdi.GetFontData(dc, tag, 0, names, size) != size or name.casefold() not in font_family_aliases(names.raw):
                return None
        metric = TextMetric()
        if gdi.GetTextMetricsW(dc, C.byref(metric)) and metric.height > 0:
            flags = C.create_string_buffer(2)
            size = gdi.GetFontData(dc, int.from_bytes(b"OS/2", "little"), 8, flags, 2)
            embedding = int.from_bytes(flags.raw, "big") if size == 2 else 0
            return metric.height + metric.externalLeading, bool(embedding & 0x0202)
    except (OSError, AttributeError, ValueError):
        return None
    finally:
        if previous:
            gdi.SelectObject(dc, previous)
        if font:
            gdi.DeleteObject(font)
        if dc:
            gdi.DeleteDC(dc)
    return None


ASIAN_CHARS = re.compile(r"[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\U00020000-\U0003134f]")
COMPLEX_CHARS = re.compile(r"[\u0590-\u109f\u1780-\u17ff\ufb1d-\ufeff]")


def free_font_candidates(name, suffix, family):
    """Only name known open-source families; availability is checked separately.

    This is a substitution policy, not a determination of the source's license.
    Symbol fonts have private encodings and cannot safely use a prose fallback.
    """
    lower = name.casefold()
    if any(part in lower for part in ("symbol", "wingding", "webding", "dingbat")):
        return ()
    serif = family == 3 or any(part in lower for part in ("宋", "明朝", "明體", "明体", "simsun", "mincho", "times", "cambria")) or ("serif" in lower and "sans" not in lower)
    if suffix == "Asian":
        # Keep Japanese/Korean forms when the requested family identifies them.
        region = "JP" if any(part in lower for part in ("mincho", "gothic", "meiryo", "yu ")) else "KR" if any(part in lower for part in ("batang", "gulim", "malgun")) else "SC"
        kind = "Serif" if serif else "Sans"
        han_kind = "宋体" if serif else "黑体"
        return (f"Noto {kind} CJK {region}", f"Noto {kind} {region}", f"Source Han {kind} {region}", f"思源{han_kind}",
                f"Noto {kind} CJK SC", f"Noto {kind} SC", "WenQuanYi Zen Hei")
    if suffix == "Complex":
        return ()  # Script-specific coverage cannot be inferred from a family name.
    if family == 2 or any(part in lower for part in ("courier", "consolas", "mono")):
        return ("Liberation Mono", "Noto Sans Mono", "DejaVu Sans Mono", "Cascadia Mono", "Ubuntu Mono")
    if "calibri" in lower:
        return ("Carlito", "Liberation Sans", "Noto Sans", "DejaVu Sans", "Noto Sans SC")
    if "cambria" in lower:
        return ("Caladea", "Liberation Serif", "Noto Serif", "DejaVu Serif", "Noto Serif SC")
    return ("Liberation Serif", "Noto Serif", "DejaVu Serif", "Noto Serif SC") if serif else ("Liberation Sans", "Noto Sans", "DejaVu Sans", "Noto Sans SC")


def document_font_ranges(document):
    """Visit rendered text, including nested tables, frames, notes and headers."""
    from word_layout import document_paragraphs, optional_property

    texts = [document.Text]
    for collection_name in ("TextFrames", "Footnotes", "Endnotes"):
        collection = optional_property(document, collection_name)
        if collection is None:
            collection = getattr(document, collection_name, None)
        if collection is not None:
            if hasattr(collection, "getElementNames"):
                items = (collection.getByName(name) for name in collection.getElementNames())
            else:
                items = (collection.getByIndex(i) for i in range(collection.getCount()))
            texts.extend(getattr(item, "Text", item) for item in items)
    styles = document.StyleFamilies.getByName("PageStyles")
    for name in styles.getElementNames():
        style = styles.getByName(name)
        if hasattr(style, "isInUse") and not style.isInUse():
            continue
        for group in ("Header", "Footer"):
            if optional_property(style, group + "IsOn", False):
                for variant in ("Text", "TextLeft", "TextRight", "TextFirst"):
                    text = optional_property(style, group + variant)
                    if text is not None:
                        texts.append(text)
    for text in texts:
        for paragraph in document_paragraphs(text):
            portions = paragraph.createEnumeration()
            if not portions.hasMoreElements():
                yield paragraph
            while portions.hasMoreElements():
                yield portions.nextElement()


def substitute_document_fonts(document):
    """Replace missing/restricted fonts in memory; never modify the source file."""
    from word_layout import optional_property

    notices, seen, cache = [], set(), {}

    def notice(code, font="", replacement=""):
        key = (code, font, replacement)
        if key not in seen:
            seen.add(key)
            notices.append(dict(code=code, font=font, replacement=replacement))

    try:
        device = document.CurrentController.Frame.ContainerWindow.getToolkit().createScreenCompatibleDevice(1, 1)
        available = {font.Name.casefold(): font.Name for font in device.getFontDescriptors()}
        if not available:
            raise ValueError("empty-font-catalog")
    except Exception:
        return [dict(code="font-check-unavailable", font="", replacement="")]

    def installed(name):
        # GDI validates localized aliases against the actual font name table.
        return name.casefold() in available or windows_font_details(name) is not None

    try:
        for portion in document_font_ranges(document):
            text = optional_property(portion, "String", "") or ""
            suffixes = []
            if ASIAN_CHARS.search(text):
                suffixes.append("Asian")
            if COMPLEX_CHARS.search(text):
                suffixes.append("Complex")
            if not text or COMPLEX_CHARS.sub("", ASIAN_CHARS.sub("", text)).strip():
                suffixes.append("")
            for suffix in suffixes:
                prop_name = "CharFontName" + suffix
                original = optional_property(portion, prop_name, "")
                if not original:
                    continue
                family = optional_property(portion, "CharFontFamily" + suffix, 0)
                key = (original, suffix, family)
                if key not in cache:
                    names = [name.strip() for name in original.split(";") if name.strip()]
                    present = next((name for name in names if installed(name)), None)
                    details = windows_font_details(present) if present else None
                    reason = "embedding-restricted" if details and details[1] else "missing-font" if not present else None
                    replacement = next((available[name.casefold()] for name in free_font_candidates(original, suffix, family)
                                        if name.casefold() in available and not (windows_font_details(name) or (0, False))[1]), "") if reason else ""
                    cache[key] = reason, replacement
                reason, replacement = cache[key]
                if reason:
                    if replacement and optional_property(portion, "CharFontCharSet" + suffix) != 10:
                        try:
                            portion.setPropertyValue(prop_name, replacement)
                            notice(reason, original, replacement)
                        except Exception:
                            notice("font-replacement-failed", original)
                    else:
                        notice(reason, original)
    except Exception:
        notice("font-check-incomplete")
    return notices
