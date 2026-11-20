"""Resolve CJK DOCX layout settings in Writer's in-memory export model."""
import math
import os
import re
import tempfile
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from xml.dom import minidom

from word_font_metrics import windows_font_line_twips

ASIAN_TEXT = re.compile(r"[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\U00020000-\U000323af]")
TWIP_TO_MM100 = 2540 / 1440
LINE_SPACING_AUTO = 0
LINE_SPACING_FIXED = 3
GRID_LINES = 1
UNIT_CHARACTER = 20  # Writer FieldUnit::CHAR, not UNO MeasureUnit.
INVISIBLE_MARKS = frozenset(("Bookmark", "ReferenceMark", "DocumentIndexMark", "SoftPageBreak"))
WORD_XML = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def distinct_style_names(raw):
    """Keep distinct OOXML style IDs from merging in Writer's name lookup.

    OOXML references styles by ID. Writer maps names such as both 'toc 2'
    and 'TOC 2' to its built-in Contents 2, even if their IDs and properties
    differ. Rename the conflicting styles only in the disposable import copy;
    all IDs, basedOn/link references and cached field results stay intact.
    minidom retains namespace prefixes used by mc:Ignorable and extensions.
    """
    if len(raw) > 4 * 1024 * 1024 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        return None
    tree = minidom.parseString(raw)
    try:
        namespace = WORD_XML[1:-1]
        groups, used = {}, set()
        for style in tree.getElementsByTagNameNS(namespace, "style"):
            names = [child for child in style.childNodes if child.nodeType == child.ELEMENT_NODE
                     and child.namespaceURI == namespace and child.localName == "name"]
            if len(names) != 1:
                continue
            name = names[0]
            value = name.getAttributeNS(namespace, "val")
            used.add(value.casefold())
            key = (style.getAttributeNS(namespace, "type"), value.casefold())
            groups.setdefault(key, []).append((style, name))
        changes = 0
        for members in groups.values():
            if len(members) < 2:
                continue
            # Preserve the built-in name so TOC field level mappings still work.
            members.sort(key=lambda pair: pair[0].getAttributeNS(namespace, "customStyle") in ("1", "true", "on"))
            for style, name in members[1:]:
                ident = style.getAttributeNS(namespace, "styleId")
                stem = "ToolKnit import " + ident
                candidate, number = stem, 1
                while candidate.casefold() in used:
                    number += 1
                    candidate = stem + " " + str(number)
                attribute = name.getAttributeNodeNS(namespace, "val")
                if attribute is None:
                    continue
                attribute.value = candidate
                used.add(candidate.casefold())
                changes += 1
        return tree.toxml(encoding="utf-8") if changes else None
    finally:
        tree.unlink()


def bind_docx_punctuation_fonts(raw, styles):
    """Materialize OOXML font binding independently of script classification.

    General Punctuation (U+2000..206F) uses hAnsi with the default rFonts hint.
    Writer instead inherits the preceding character's script, and consequently
    its Asian font. A Latin script hint would also change automatic DE spacing.
    Set only the rendering font families on these visible punctuation spans in
    the disposable import copy. Both Latin and Asian contexts must select the
    hAnsi family, even when ascii differs. Keep explicit eastAsia/cs hints and
    complex runs.
    This implements the default branch of MS-OE376 2.1.90, not font substitution
    or a replacement of quote characters. Unhandled character ranges retain
    the native importer behavior.
    """
    if len(raw) > 32 * 1024 * 1024 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        return None
    namespace = WORD_XML[1:-1]

    def children(node, name):
        return [child for child in node.childNodes if child.nodeType == child.ELEMENT_NODE
                and child.namespaceURI == namespace and child.localName == name] if node else []

    def child(node, name):
        return next(iter(children(node, name)), None)

    def value(node, name="val"):
        return node.getAttributeNS(namespace, name) if node else ""

    def properties(node):
        result = {}
        fonts = child(node, "rFonts")
        if fonts:
            for name in ("ascii", "asciiTheme", "hAnsi", "hAnsiTheme", "eastAsia", "eastAsiaTheme", "hint"):
                if fonts.hasAttributeNS(namespace, name):
                    result[name] = value(fonts, name)
            # A nearer literal family replaces an inherited theme binding for
            # that slot. The theme wins only when declared in the same layer.
            for name in ("ascii", "hAnsi", "eastAsia"):
                if name in result and name + "Theme" not in result:
                    result[name + "Theme"] = None
        for name in ("cs", "rtl"):
            flag = child(node, name)
            if flag:
                result[name] = value(flag) not in ("0", "false", "off")
        return result

    tree = minidom.parseString(raw)
    style_tree = minidom.parseString(styles) if styles else None
    try:
        entries, default_paragraph, defaults = {}, "", {}
        if style_tree:
            root = style_tree.documentElement
            defaults = properties(child(child(child(root, "docDefaults"), "rPrDefault"), "rPr"))
            for style in children(root, "style"):
                ident = value(style, "styleId")
                entries[ident] = (value(child(style, "basedOn")), properties(child(style, "rPr")))
                if value(style, "type") == "paragraph" and value(style, "default") in ("1", "true", "on"):
                    default_paragraph = ident

        def inherited(ident):
            chain, seen = [], set()
            while ident and ident in entries:
                if ident in seen:
                    return {}  # Invalid style cycle must not produce a partial binding.
                seen.add(ident)
                ident, props = entries[ident]
                chain.append(props)
            result = {}
            for props in reversed(chain):
                result.update(props)
            return result

        def eligible(char):
            return "\u2000" <= char <= "\u206f" and unicodedata.category(char).startswith("P")

        changes = 0
        for run in list(tree.getElementsByTagNameNS(namespace, "r")):
            texts = children(run, "t")
            if not any(eligible(char) for text in texts for char in "".join(
                    node.data for node in text.childNodes if node.nodeType == node.TEXT_NODE)):
                continue
            paragraph = run.parentNode
            while paragraph and not (paragraph.nodeType == paragraph.ELEMENT_NODE
                                     and paragraph.namespaceURI == namespace and paragraph.localName == "p"):
                paragraph = paragraph.parentNode
            para_style = value(child(child(paragraph, "pPr"), "pStyle")) or default_paragraph
            run_props = child(run, "rPr")
            effective = {**defaults, **inherited(para_style),
                         **inherited(value(child(run_props, "rStyle"))), **properties(run_props)}
            if effective.get("hint", "default") != "default" or effective.get("cs") or effective.get("rtl"):
                continue
            theme, family = effective.get("hAnsiTheme"), effective.get("hAnsi")
            if not theme and not family:
                continue  # No declared font: do not guess an installed/default family.
            if all((theme and theme == effective.get(slot + "Theme")) or (
                    not theme and not effective.get(slot + "Theme") and family == effective.get(slot))
                   for slot in ("ascii", "eastAsia")):
                continue
            chunks = []
            for node in run.childNodes:
                if node is run_props:
                    continue
                if node in texts:
                    text = "".join(item.data for item in node.childNodes if item.nodeType == item.TEXT_NODE)
                    groups = []
                    for char in text:
                        bound = eligible(char)
                        if groups and groups[-1][0] == bound:
                            groups[-1][1] += char
                        else:
                            groups.append([bound, char])
                    for bound, segment in groups:
                        part = node.cloneNode(False)
                        part.appendChild(tree.createTextNode(segment))
                        if segment[:1].isspace() or segment[-1:].isspace():
                            part.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve")
                        if chunks and chunks[-1][0] == bound:
                            chunks[-1][1].append(part)
                        else:
                            chunks.append((bound, [part]))
                    if not groups:
                        if not chunks:
                            chunks.append((False, []))
                        chunks[-1][1].append(node.cloneNode(True))
                else:
                    if not chunks:
                        chunks.append((False, []))
                    chunks[-1][1].append(node.cloneNode(True))
            for bound, nodes in chunks:
                replacement = run.cloneNode(False)
                props = run_props.cloneNode(True) if run_props else None
                if bound:
                    prefix = run.prefix
                    if not prefix:
                        prefix = "tkWord"
                        while tree.documentElement.hasAttribute("xmlns:" + prefix) and tree.documentElement.getAttribute("xmlns:" + prefix) != namespace:
                            prefix += "_"
                        tree.documentElement.setAttribute("xmlns:" + prefix, namespace)
                    if props is None:
                        props = tree.createElementNS(namespace, prefix + ":rPr")
                    fonts = child(props, "rFonts")
                    if fonts is None:
                        fonts = tree.createElementNS(namespace, prefix + ":rFonts")
                        props.insertBefore(fonts, props.firstChild)
                    for name in ("ascii", "asciiTheme", "eastAsia", "eastAsiaTheme"):
                        if fonts.hasAttributeNS(namespace, name):
                            fonts.removeAttributeNS(namespace, name)
                    for slot in ("ascii", "eastAsia"):
                        fonts.setAttributeNS(namespace, prefix + ":" + slot + ("Theme" if theme else ""), theme or family)
                if props:
                    replacement.appendChild(props)
                for node in nodes:
                    replacement.appendChild(node)
                run.parentNode.insertBefore(replacement, run)
            run.parentNode.removeChild(run)
            changes += 1
        return tree.toxml(encoding="utf-8") if changes else None
    finally:
        tree.unlink()
        if style_tree:
            style_tree.unlink()


@contextmanager
def docx_import_source(source):
    """Retain original bytes; clean up the style/font-isolated import copy."""
    if not source.lower().endswith(".docx"):
        yield source
        return
    with zipfile.ZipFile(source) as archive:
        if "word/styles.xml" in archive.namelist() and archive.getinfo("word/styles.xml").file_size > 4 * 1024 * 1024:
            yield source
            return
        raw = archive.read("word/styles.xml") if "word/styles.xml" in archive.namelist() else None
        if raw and (b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper()):
            yield source
            return
        replacements = {}
        distinct = distinct_style_names(raw) if raw else None
        if distinct:
            replacements["word/styles.xml"] = distinct
        for info in archive.infolist():
            if re.fullmatch(r"word/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml", info.filename) and info.file_size <= 32 * 1024 * 1024:
                bound = bind_docx_punctuation_fonts(archive.read(info), raw)
                if bound:
                    replacements[info.filename] = bound
        if not replacements:
            yield source
            return
        with tempfile.TemporaryDirectory(prefix="toolknit-word-import-") as folder:
            target = os.path.join(folder, "source.docx")
            with zipfile.ZipFile(target, "w") as output:
                for info in archive.infolist():
                    output.writestr(info, replacements.get(info.filename, archive.read(info)))
            yield target


def source_character_compression(source):
    """Recover the declared document typography without flattening overrides.

    UNO offers only a document-wide switch. Leave paragraph-specific breaking,
    hanging punctuation and kinsoku overrides to the importer instead of
    replacing their mixed typography with one global compression setting.
    """
    try:
        with zipfile.ZipFile(source) as archive:
            roots = []
            for name, limit in (("word/settings.xml", 2 * 1024 * 1024), ("word/document.xml", 32 * 1024 * 1024), ("word/styles.xml", 4 * 1024 * 1024)):
                if name not in archive.namelist():
                    if name.endswith("styles.xml"):
                        continue
                    return None
                info = archive.getinfo(name)
                if info.file_size > limit:
                    return None
                raw = archive.read(info)
                if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                    return None
                roots.append(ET.fromstring(raw))
        control = roots[0].find(WORD_XML + "characterSpacingControl")
        if control is None:
            return None
        overrides = {WORD_XML + name for name in ("kinsoku", "wordWrap", "overflowPunct", "topLinePunct")}
        if any(child.tag in overrides for root in roots[1:] for props in root.iter(WORD_XML + "pPr") for child in props):
            return None
        return {"doNotCompress": 0, "compressPunctuation": 1, "compressPunctuationAndJapaneseKana": 2}.get(control.get(WORD_XML + "val"))
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError, RuntimeError):
        return None


def resolve_character_compression(document, source):
    compression = source_character_compression(source)
    if compression is None:
        return False
    settings = document.createInstance("com.sun.star.document.Settings")
    current = optional_property(settings, "CharacterCompressionType")
    if current is None or current == compression:
        return False
    settings.setPropertyValue("CharacterCompressionType", compression)
    return True


def optional_property(item, name, default=None):
    try:
        return item.getPropertyValue(name)
    except Exception:
        return default


def text_paragraphs(text):
    elements = text.createEnumeration()
    while elements.hasMoreElements():
        element = elements.nextElement()
        if element.supportsService("com.sun.star.text.Paragraph"):
            yield element


def has_wrapped_body_paragraph(document):
    """Keep importer typography when a global switch would reflow body prose.

    Word's contextual punctuation compression and Writer's document-wide
    compression are not equivalent. The form compatibility override is safe
    only when the document has no naturally wrapped CJK body paragraphs.
    """
    view = document.CurrentController.ViewCursor
    for paragraph in text_paragraphs(document.Text):
        if not paragraph.String or not ASIAN_TEXT.search(paragraph.String):
            continue
        try:
            view.gotoRange(paragraph.Start, False)
            view.gotoEndOfLine(False)
            if paragraph.getText().compareRegionEnds(view, paragraph.End) != 0:
                return True
        except Exception:
            return True  # Unknown layout must retain importer typography.
    return False


def document_paragraphs(text):
    """Visit text in each table cell, including merged and nested tables."""
    elements = text.createEnumeration()
    while elements.hasMoreElements():
        element = elements.nextElement()
        if element.supportsService("com.sun.star.text.Paragraph"):
            yield element
        elif element.supportsService("com.sun.star.text.TextTable"):
            for name in element.getCellNames():
                yield from document_paragraphs(element.getCellByName(name))


def plain_text_portions(paragraph):
    portions, elements = [], paragraph.createEnumeration()
    while elements.hasMoreElements():
        portion = elements.nextElement()
        kind = optional_property(portion, "TextPortionType")
        if kind in INVISIBLE_MARKS and not portion.String:
            continue
        if kind != "Text":
            return None  # Inline objects and fields own their layout metrics.
        portions.append(portion)
    return portions


def line_grid_styles(document):
    styles = document.StyleFamilies.getByName("PageStyles")
    grids = {}
    for name in styles.getElementNames():
        style = styles.getByName(name)
        if optional_property(style, "GridMode") != GRID_LINES or optional_property(style, "GridRubyHeight", 0):
            continue
        pitch = round(optional_property(style, "GridBaseHeight", 0) / TWIP_TO_MM100)
        if pitch > 0:
            grids[name] = (style, pitch)
    return grids


def set_fixed_line(paragraph, twips, uno):
    height = round(twips * TWIP_TO_MM100)
    if not 0 < height < 32767:
        return False
    value = uno.createUnoStruct("com.sun.star.style.LineSpacing")
    value.Mode, value.Height = LINE_SPACING_FIXED, height
    spacing = optional_property(paragraph, "ParaLineSpacing")
    if spacing and spacing.Mode == LINE_SPACING_AUTO:
        retained = tuple(item for item in (optional_property(paragraph, "ParaInteropGrabBag", ()) or ())
                         if item.Name != "originalAutoLineSpacing")
        original = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
        original.Name, original.Value = "originalAutoLineSpacing", True
        uno.invoke(paragraph, "setPropertyValue", (
            "ParaInteropGrabBag", uno.Any("[]com.sun.star.beans.PropertyValue", retained + (original,))))
    paragraph.setPropertyValue("ParaLineSpacing", value)
    return True


class FontMeasurements:
    """Cache measured font cells for one export, falling back to UNO metrics."""

    def __init__(self, document, uno):
        self.uno = uno
        self.device = document.CurrentController.Frame.ContainerWindow.getToolkit().createScreenCompatibleDevice(1, 1)
        self.cache = {}
        try:
            settings = document.createInstance("com.sun.star.document.Settings")
            self.native_auto_grid_baseline = optional_property(settings, "SupportsWordAutoGridBaseline", False) is True
        except Exception:
            self.native_auto_grid_baseline = False

    def line_height(self, portion, asian):
        suffix = "Asian" if asian else ""
        name = optional_property(portion, "CharFontName" + suffix)
        size = optional_property(portion, "CharHeight" + suffix)
        weight = optional_property(portion, "CharWeight" + suffix, 100)
        posture = optional_property(portion, "CharPosture" + suffix)
        italic = getattr(posture, "value", "NONE") in ("ITALIC", "OBLIQUE")
        if not name or not size or not 0 < size * 20 < 32767:
            return None
        key = (name, size, weight >= 150, italic)
        if key not in self.cache:
            height = windows_font_line_twips(*key)
            if height is None:
                descriptor = self.uno.createUnoStruct("com.sun.star.awt.FontDescriptor")
                descriptor.Name, descriptor.Height, descriptor.Weight = name, round(size * 20), weight
                if posture is not None:
                    descriptor.Slant = posture
                metric = self.device.getFont(descriptor).getFontMetric()
                height = metric.Ascent + metric.Descent + metric.Leading
            self.cache[key] = height if height > 0 else None
        return self.cache[key]


def resolve_character_indent(paragraph, first_portion):
    unit = optional_property(paragraph, "ParaFirstLineIndentUnit")
    if unit is None or unit.Second != UNIT_CHARACTER or not ASIAN_TEXT.search(paragraph.String):
        return False
    em = optional_property(first_portion, "CharHeightAsian")
    mark_em = optional_property(paragraph, "CharHeightAsian")
    if not em or not mark_em or abs(em - mark_em) <= 0.01:
        return False
    paragraph.setPropertyValue("ParaFirstLineIndent", round(unit.First * em * 20 * TWIP_TO_MM100))
    return True


def resolve_grid_line(paragraph, portions, document, grids, metrics, uno):
    spacing = optional_property(paragraph, "ParaLineSpacing")
    if not spacing or spacing.Mode != LINE_SPACING_AUTO or spacing.Height < 100 or not optional_property(paragraph, "SnapToGrid", False):
        return False
    view = document.CurrentController.ViewCursor
    view.gotoRange(paragraph.Start, False)
    style_name = view.PageStyleName
    if style_name not in grids:
        return False
    view.gotoEndOfLine(False)
    if paragraph.getText().compareRegionEnds(view, paragraph.End) != 0:
        return False  # Wrapped paragraphs retain automatic line spacing.
    pitch = grids[style_name][1]
    heights = []
    for portion in portions:
        if ASIAN_TEXT.search(portion.String):
            heights.append(metrics.line_height(portion, True))
        if ASIAN_TEXT.sub("", portion.String).strip():
            heights.append(metrics.line_height(portion, False))
    if not paragraph.String:
        heights.append(metrics.line_height(paragraph, True))
    if not heights or any(h is None for h in heights):
        return False
    # A single-space line that fits the grid must occupy one row. Writer's CJK
    # ascent adjustment can otherwise inflate a label or empty paragraph into
    # two rows before the title. Never reduce below the measured glyph cell.
    multiple = spacing.Height / 100
    if multiple == 1:
        return max(heights) <= pitch and set_fixed_line(paragraph, pitch, uno)
    if max(heights) <= pitch:
        if metrics.native_auto_grid_baseline and paragraph.getText() == document.Text:
            return set_fixed_line(paragraph, pitch * multiple, uno)
        return False
    # For oversized fonts resolve the multiple before snapping to the grid.
    expected = math.ceil(max(heights) * multiple / pitch) * pitch
    imported = math.ceil(max(heights) / pitch) * pitch * multiple
    return expected < imported and set_fixed_line(paragraph, expected, uno)


def blank_story_paragraphs(story):
    if story is None or story.String.strip("\r\n"):
        return []
    elements, paragraphs = story.createEnumeration(), []
    while elements.hasMoreElements():
        element = elements.nextElement()
        if not element.supportsService("com.sun.star.text.Paragraph"):
            return []  # A story containing a table is not an empty story.
        if element.String or plain_text_portions(element) is None:
            return []
        paragraphs.append(element)
    return paragraphs


def story_has_drawing(document, story):
    for index in range(document.DrawPage.getCount()):
        anchor = optional_property(document.DrawPage.getByIndex(index), "Anchor")
        if anchor is not None:
            try:
                if anchor.getText() == story:
                    return True
            except Exception:
                return True  # An unknown anchor must not be resized.
    return False


def paragraph_has_border(paragraph):
    borders = (optional_property(paragraph, edge + "Border") for edge in ("Top", "Bottom", "Left", "Right"))
    return any(getattr(border, "OuterLineWidth", 0) or getattr(border, "InnerLineWidth", 0) for border in borders)


def resolve_blank_stories(document, grids, metrics, uno):
    changes = 0
    for style, _ in grids.values():
        for group in ("Header", "Footer"):
            if not optional_property(style, group + "IsOn", False) or not optional_property(style, group + "IsDynamicHeight", False):
                continue
            for variant in ("Text", "TextFirst", "TextLeft", "TextRight"):
                story = optional_property(style, group + variant)
                paragraphs = blank_story_paragraphs(story)
                if not paragraphs or story_has_drawing(document, story):
                    continue
                for paragraph in paragraphs:
                    if paragraph_has_border(paragraph):
                        continue
                    spacing = optional_property(paragraph, "ParaLineSpacing")
                    if spacing and spacing.Mode == LINE_SPACING_AUTO:
                        height = metrics.line_height(paragraph, True)
                        if height and set_fixed_line(paragraph, height * spacing.Height / 100, uno):
                            changes += 1
    return changes


def apply_docx_layout_compatibility(document, source, uno):
    """Resolve source settings without saving changes or refreshing fields.

    Fixed/minimum body spacing, page margins, font sizes and story content are
    retained. Only CJK DOCX files with a line grid enter the compatibility pass.
    """
    changes = {"gridLines": 0, "blankStoryLines": 0, "characterIndents": 0, "characterCompression": 0}
    if not source.lower().endswith(".docx"):
        return changes
    paragraphs = list(document_paragraphs(document.Text))
    if not any(ASIAN_TEXT.search(paragraph.String) for paragraph in paragraphs):
        return changes
    grids = line_grid_styles(document)
    if not grids:
        return changes
    if not has_wrapped_body_paragraph(document):
        changes["characterCompression"] = int(resolve_character_compression(document, source))
    metrics = FontMeasurements(document, uno)
    for paragraph in paragraphs:
        portions = plain_text_portions(paragraph)
        if portions is None:
            continue
        visible = [portion for portion in portions if portion.String]
        if visible:
            changes["characterIndents"] += int(resolve_character_indent(paragraph, visible[0]))
        changes["gridLines"] += int(resolve_grid_line(paragraph, visible, document, grids, metrics, uno))
    changes["blankStoryLines"] = resolve_blank_stories(document, grids, metrics, uno)
    if any(changes.values()):
        document.reformat()
    return changes
