"""Test DOCX compatibility rules without starting LibreOffice."""
import sys
from pathlib import Path
import unittest
import tempfile
import zipfile

OFFICE = Path(__file__).resolve().parents[1] / "src-tauri/resources/office"
sys.path.insert(0, str(OFFICE))
from types import SimpleNamespace
from unittest.mock import Mock, patch
import word_layout as layout


def fake_uno():
    return SimpleNamespace(createUnoStruct=lambda name: SimpleNamespace(),
                           Any=lambda kind, value: value,
                           invoke=lambda target, method, args: getattr(target, method)(*args))


class Properties:
    def __init__(self, **values):
        self.values = values
        self.writes = {}

    def getPropertyValue(self, name):
        return self.values[name]

    def setPropertyValue(self, name, value):
        self.values[name] = value
        self.writes[name] = value


class Enumeration:
    def __init__(self, values):
        self.values, self.index = list(values), 0

    def hasMoreElements(self):
        return self.index < len(self.values)

    def nextElement(self):
        value = self.values[self.index]
        self.index += 1
        return value


def portion(text, size=12, kind="Text"):
    value = Properties(TextPortionType=kind, CharFontNameAsian="Test CJK", CharHeightAsian=size,
                       CharWeightAsian=100, CharFontName="Test Latin", CharHeight=size, CharWeight=100)
    value.String = text
    return value


def paragraph(text, size=12, spacing=100, mode=0, mark_size=None, portions=None):
    value = portion(text, size)
    value.values.update(ParaLineSpacing=SimpleNamespace(Mode=mode, Height=spacing), SnapToGrid=True,
                        CharHeightAsian=mark_size or size)
    value.supportsService = lambda name: name == "com.sun.star.text.Paragraph"
    value.createEnumeration = lambda: Enumeration(portions if portions is not None else [portion(text, size)])
    value.Start = value.End = SimpleNamespace(paragraph=value)
    value.wrapped = False
    return value


def model(paragraphs, pitch=312, header=None):
    text = SimpleNamespace(String="\n".join(p.String for p in paragraphs),
                           createEnumeration=lambda: Enumeration(paragraphs),
                           compareRegionEnds=lambda view, end: -1 if view.paragraph.wrapped else 0)
    for p in paragraphs:
        p.getText = lambda: text
    view = SimpleNamespace(PageStyleName="Standard", gotoEndOfLine=lambda select: None)
    view.gotoRange = lambda position, select: setattr(view, "paragraph", position.paragraph)
    style = Properties(GridMode=1, GridRubyHeight=0, GridBaseHeight=round(pitch * layout.TWIP_TO_MM100),
                       HeaderIsOn=header is not None, HeaderIsDynamicHeight=True, HeaderText=header,
                       HeaderBodyDistance=600, TopMargin=2200, BottomMargin=2000)
    family = SimpleNamespace(getElementNames=lambda: ["Standard"], getByName=lambda name: style)
    document = SimpleNamespace(Text=text, StyleFamilies=SimpleNamespace(getByName=lambda name: family),
                               CurrentController=SimpleNamespace(ViewCursor=view, Frame=Mock()),
                               DrawPage=Mock(getCount=Mock(return_value=0)), reformat=Mock())
    return document, style


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.fonts = patch.object(layout, "windows_font_line_twips", side_effect=lambda name, size, bold, italic: round(size * 20 * 1.14))
        self.fonts.start()
        self.uno = fake_uno()

    def tearDown(self):
        self.fonts.stop()

    def test_grid_heading_uses_its_font_and_grid_not_a_fixed_sample_height(self):
        for size, pitch, points in [(16, 312, 31.2), (17, 320, 32)]:
            heading = paragraph("中文标题", size, 150, portions=[portion("", size, "Bookmark"), portion("中文标题", size), portion("", size, "Bookmark")])
            doc, _ = model([heading], pitch)
            changes = layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
            self.assertEqual(changes["gridLines"], 1)
            self.assertEqual(heading.values["ParaLineSpacing"].Mode, 3)
            self.assertEqual(heading.values["ParaLineSpacing"].Height, round(points * 2540 / 72))
            self.assertNotIn("CharHeightAsian", heading.writes)

    def test_fixed_body_line_spacing_and_page_margins_are_preserved(self):
        body = paragraph("中文正文", 12, 706, 3, mark_size=10.5)
        body.values["ParaFirstLineIndentUnit"] = SimpleNamespace(First=2, Second=20)
        doc, style = model([body])
        layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        self.assertEqual(body.values["ParaFirstLineIndent"], round(24 * 2540 / 72))
        self.assertEqual(body.values["ParaLineSpacing"].Height, 706)
        self.assertEqual(set(body.writes), {"ParaFirstLineIndent"})
        self.assertEqual(style.writes, {})

    def test_grid_normalization_retains_auto_spacing_and_existing_interop(self):
        heading = paragraph("中文标题", 16, 150)
        heading.values["ParaInteropGrabBag"] = (SimpleNamespace(Name="existing", Value="kept"),)
        doc, _ = model([heading], 312)
        layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        retained = {item.Name: item.Value for item in heading.values["ParaInteropGrabBag"]}
        self.assertEqual(retained, {"existing": "kept", "originalAutoLineSpacing": True})
        layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        self.assertEqual(len(heading.values["ParaInteropGrabBag"]), 2)

    def test_proportional_body_grid_uses_declared_multiple_on_capable_kernel(self):
        for multiple in (110, 135, 150):
            label = paragraph("中文示例", 10.5, multiple)
            doc, _ = model([label], 312)
            doc.createInstance = lambda name: Properties(SupportsWordAutoGridBaseline=True)
            layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
            self.assertEqual(label.values["ParaLineSpacing"].Mode, 3)
            self.assertEqual(label.values["ParaLineSpacing"].Height,
                             round(312 * multiple / 100 * layout.TWIP_TO_MM100))

    def test_proportional_grid_preserves_legacy_engine_and_table_behavior(self):
        for capable, table in ((False, False), (True, True)):
            label = paragraph("中文示例", 10.5, 135)
            doc, _ = model([label], 312)
            doc.createInstance = lambda name: Properties(SupportsWordAutoGridBaseline=capable)
            if table:
                label.getText = lambda: SimpleNamespace(compareRegionEnds=doc.Text.compareRegionEnds)
            layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
            self.assertEqual(label.values["ParaLineSpacing"].Mode, 0)
            self.assertEqual(label.writes, {})

    def test_wrapped_headings_and_fields_keep_automatic_spacing(self):
        wrapped = paragraph("跨行中文标题", 16, 150)
        wrapped.wrapped = True
        field = paragraph("含域的中文标题", 16, 150, portions=[portion("", 16, "TextField")])
        doc, _ = model([wrapped, field])
        self.assertEqual(layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)["gridLines"], 0)
        self.assertEqual(wrapped.writes, {})
        self.assertEqual(field.writes, {})

    def test_empty_header_keeps_paragraphs_content_and_distance(self):
        empty = [paragraph("", 9), paragraph("", 10.5)]
        header = SimpleNamespace(String="\r\n", createEnumeration=lambda: Enumeration(empty))
        doc, style = model([paragraph("中文正文", 12, 706, 3)], header=header)
        changes = layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        self.assertEqual(changes["blankStoryLines"], 2)
        self.assertEqual(header.String, "\r\n")
        self.assertEqual(style.values["HeaderBodyDistance"], 600)
        self.assertTrue(style.values["HeaderIsOn"])
        self.assertEqual(style.writes, {})
        self.assertTrue(all(p.values["ParaLineSpacing"].Mode == 3 for p in empty))

    def test_header_fields_rules_and_floating_drawings_are_not_resized(self):
        for kind in ("field", "rule", "drawing"):
            empty = paragraph("", portions=[portion("", kind="TextField" if kind == "field" else "Text")])
            if kind == "rule":
                empty.values["BottomBorder"] = SimpleNamespace(OuterLineWidth=10)
            header = SimpleNamespace(String="", createEnumeration=lambda: Enumeration([empty]))
            doc, _ = model([paragraph("中文正文", 12, 706, 3)], header=header)
            if kind == "drawing":
                doc.DrawPage.getCount.return_value = 1
                shape = Properties(Anchor=SimpleNamespace(getText=lambda: header))
                doc.DrawPage.getByIndex.return_value = shape
            changes = layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
            self.assertEqual(changes["blankStoryLines"], 0)
            self.assertEqual(empty.writes, {})

    def test_non_grid_and_legacy_documents_are_untouched(self):
        heading = paragraph("中文标题", 16, 150)
        doc, style = model([heading])
        layout.apply_docx_layout_compatibility(doc, "legacy.doc", self.uno)
        self.assertEqual(heading.writes, {})
        style.values["GridMode"] = 0
        layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        self.assertEqual(heading.writes, {})

    def test_single_spaced_grid_label_and_empty_line_do_not_add_rows(self):
        label = paragraph("附件4", 12, 100, mark_size=10.5)
        empty = paragraph("", 12, 100)
        heading = paragraph("中文开题报告2027", 16, 173)
        doc, _ = model([label, empty, heading])
        changes = layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        self.assertEqual(changes["gridLines"], 3)
        self.assertEqual(label.values["ParaLineSpacing"].Height, round(15.6 * 2540 / 72))
        self.assertEqual(empty.values["ParaLineSpacing"].Height, label.values["ParaLineSpacing"].Height)
        self.assertEqual(heading.values["ParaLineSpacing"].Height, round(46.8 * 2540 / 72))

    def test_tall_font_cells_and_existing_proportional_spacing_are_preserved(self):
        proportional = paragraph("附件3", 10.5, 135)
        tall = paragraph("高字体", 12, 100)
        doc, _ = model([proportional, tall])
        with patch.object(layout, "windows_font_line_twips", return_value=500):
            layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        self.assertEqual(proportional.writes, {})
        self.assertEqual(tall.writes, {})

    def test_nested_table_cells_use_their_own_text_range(self):
        inner = paragraph("表格内标题", 16, 173)
        cell_doc, _ = model([inner])
        # The body contains only a table; body.String does not expose CJK text.
        doc, _ = model([])
        table = SimpleNamespace(supportsService=lambda service: service == "com.sun.star.text.TextTable",
                                getCellNames=lambda: ["A1"], getCellByName=lambda name: cell_doc.Text)
        nested_cell = SimpleNamespace(createEnumeration=lambda: Enumeration([table]))
        outer = SimpleNamespace(supportsService=lambda service: service == "com.sun.star.text.TextTable",
                                getCellNames=lambda: ["A1"], getCellByName=lambda name: nested_cell)
        doc.Text.createEnumeration = lambda: Enumeration([outer])
        doc.Text.compareRegionEnds = Mock(side_effect=AssertionError("Wrong text container"))
        # Share only the view cursor; range comparisons belong to the cell.
        cell_doc.Text.compareRegionEnds = lambda view, end: 0
        changes = layout.apply_docx_layout_compatibility(doc, "sample.docx", self.uno)
        self.assertEqual(changes["gridLines"], 1)
        self.assertEqual(inner.values["ParaLineSpacing"].Height, round(46.8 * 2540 / 72))
        doc.Text.compareRegionEnds.assert_not_called()


class TypographyTests(unittest.TestCase):
    def document(self, folder, setting, overrides="", styles=""):
        path = Path(folder) / "sample.docx"
        namespace = layout.WORD_XML[1:-1]
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("word/settings.xml", f'<w:settings xmlns:w="{namespace}"><w:characterSpacingControl w:val="{setting}"/></w:settings>')
            archive.writestr("word/document.xml", f'<w:document xmlns:w="{namespace}"><w:body><w:p><w:pPr>{overrides}</w:pPr></w:p></w:body></w:document>')
            if styles:
                archive.writestr("word/styles.xml", f'<w:styles xmlns:w="{namespace}"><w:style><w:pPr>{styles}</w:pPr></w:style></w:styles>')
        return str(path)

    def test_document_compression_is_recovered_and_applied_once(self):
        with tempfile.TemporaryDirectory() as folder:
            source = self.document(folder, "compressPunctuation")
            settings = Properties(CharacterCompressionType=0)
            document = SimpleNamespace(createInstance=lambda service: settings)
            self.assertTrue(layout.resolve_character_compression(document, source))
            self.assertEqual(settings.values["CharacterCompressionType"], 1)
            self.assertFalse(layout.resolve_character_compression(document, source))
            for value, expected in [("doNotCompress", 0), ("compressPunctuationAndJapaneseKana", 2), ("unknown", None)]:
                self.assertEqual(layout.source_character_compression(self.document(folder, value)), expected)

    def test_paragraph_or_style_typography_is_not_replaced_by_global_switch(self):
        with tempfile.TemporaryDirectory() as folder:
            for override in ("kinsoku", "wordWrap", "overflowPunct", "topLinePunct"):
                for local, style in [(f"<w:{override}/>", ""), ("", f"<w:{override}/>")]:
                    source = self.document(folder, "compressPunctuation", local, style)
                    self.assertIsNone(layout.source_character_compression(source))

    def test_invalid_xml_and_missing_settings_leave_typography_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sample.docx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("word/document.xml", "<document/>")
            self.assertIsNone(layout.source_character_compression(str(path)))

            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("word/settings.xml", '<!DOCTYPE settings [<!ENTITY x "unused">]><settings/>')
                archive.writestr("word/document.xml", "<document/>")
            self.assertIsNone(layout.source_character_compression(str(path)))

    def test_flowed_body_keeps_importer_compression_and_original_font_sizes(self):
        body = paragraph("包含中文标点、并且自然换行的正文。", size=12, spacing=706, mode=3)
        body.wrapped = True
        doc, _ = model([body])
        settings = Properties(CharacterCompressionType=0)
        doc.createInstance = lambda service: settings
        with tempfile.TemporaryDirectory() as folder:
            source = self.document(folder, "compressPunctuation")
            original = Path(source).read_bytes()
            changes = layout.apply_docx_layout_compatibility(doc, source, fake_uno())
            self.assertEqual(changes["characterCompression"], 0)
            self.assertEqual(settings.writes, {})
            self.assertEqual(body.writes, {})
            self.assertEqual(Path(source).read_bytes(), original)


class FontBindingTests(unittest.TestCase):
    def document(self, run, paragraph="", prefix="w"):
        return (f'<{prefix}:document xmlns:{prefix}="{layout.WORD_XML[1:-1]}" '
                'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
                'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14">'
                f'<{prefix}:body><{prefix}:p>{paragraph}{run}</{prefix}:p></{prefix}:body></{prefix}:document>').encode()

    def test_binding_preserves_characters_order_formatting_and_inline_nodes(self):
        import xml.etree.ElementTree as ET
        ns = layout.WORD_XML
        raw = self.document('<w:r w:rsidR="12345678"><w:rPr><w:rFonts w:ascii="Test ASCII" w:hAnsi="Test Western" '
                            'w:eastAsia="Test Asian"/><w:b/><w:sz w:val="24"/></w:rPr>'
                            '<w:fldChar w:fldCharType="begin"/><w:instrText> “field code” </w:instrText>'
                            '<w:t>甲 “乙”—丙。 </w:t><w:tab/><w:t>尾</w:t><w:br/><w:drawing/>'
                            '</w:r>')
        rewritten = layout.bind_docx_punctuation_fonts(raw, None)
        before, after = ET.fromstring(raw), ET.fromstring(rewritten)
        self.assertEqual("".join(before.itertext()), "".join(after.itertext()))
        for tag in ("fldChar", "instrText", "tab", "br", "drawing"):
            self.assertEqual([ET.tostring(node) for node in before.iter(ns + tag)],
                             [ET.tostring(node) for node in after.iter(ns + tag)])
        for run in after.iter(ns + "r"):
            self.assertEqual(run.get(ns + "rsidR"), "12345678")
            self.assertIsNotNone(run.find(ns + "rPr/" + ns + "b"))
            self.assertEqual(run.find(ns + "rPr/" + ns + "sz").get(ns + "val"), "24")
            text = "".join(node.text or "" for node in run.findall(ns + "t"))
            font = run.find(ns + "rPr/" + ns + "rFonts").get(ns + "eastAsia")
            self.assertEqual(font, "Test Western" if text in ("“", "”", "—", "”—") else "Test Asian")
            self.assertEqual(run.find(ns + "rPr/" + ns + "rFonts").get(ns + "ascii"),
                             "Test Western" if text in ("“", "”", "—", "”—") else "Test ASCII")
            for node in run.findall(ns + "t"):
                if (node.text or "")[:1].isspace() or (node.text or "")[-1:].isspace():
                    self.assertEqual(node.get("{http://www.w3.org/XML/1998/namespace}space"), "preserve")
        self.assertIn(b'xmlns:w14=', rewritten)
        self.assertIn(b'mc:Ignorable="w14"', rewritten)
        self.assertIsNone(layout.bind_docx_punctuation_fonts(rewritten, None))

    def test_font_and_hint_inheritance_and_direct_overrides(self):
        import xml.etree.ElementTree as ET
        ns = layout.WORD_XML
        styles = f'''<w:styles xmlns:w="{ns[1:-1]}">
          <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/></w:rPr></w:rPrDefault></w:docDefaults>
          <w:style w:type="paragraph" w:default="1" w:styleId="base"><w:rPr><w:rFonts w:hAnsi="Paragraph Western"/></w:rPr></w:style>
          <w:style w:type="paragraph" w:styleId="child"><w:basedOn w:val="base"/><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr></w:style>
          <w:style w:type="character" w:styleId="char"><w:rPr><w:rFonts w:hAnsi="Character Western" w:hint="default"/></w:rPr></w:style>
        </w:styles>'''.encode()
        for run_props, paragraph, family in (
                ("", "", "Paragraph Western"),
                ('<w:rStyle w:val="char"/>', '<w:pPr><w:pStyle w:val="child"/></w:pPr>', "Character Western"),
                ('<w:rFonts w:hint="default" w:hAnsi="Direct Western"/>', '<w:pPr><w:pStyle w:val="child"/></w:pPr>', "Direct Western")):
            raw = self.document(f'<w:r><w:rPr>{run_props}</w:rPr><w:t>甲“乙”</w:t></w:r>', paragraph)
            result = ET.fromstring(layout.bind_docx_punctuation_fonts(raw, styles))
            quote = next(run for run in result.iter(ns + "r") if run.find(ns + "t").text == "“")
            self.assertEqual(quote.find(ns + "rPr/" + ns + "rFonts").get(ns + "eastAsia"), family)
        raw = self.document('<w:r><w:t>甲“乙”</w:t></w:r>', '<w:pPr><w:pStyle w:val="child"/></w:pPr>')
        self.assertIsNone(layout.bind_docx_punctuation_fonts(raw, styles))

    def test_explicit_hints_complex_runs_unknown_fonts_and_cjk_punctuation_keep_native_binding(self):
        for props, text in (('<w:rFonts w:hint="eastAsia" w:hAnsi="Western"/>', '甲“乙”'),
                            ('<w:rFonts w:hint="cs" w:hAnsi="Western"/>', '甲“乙”'),
                            ('<w:rFonts w:hAnsi="Western"/><w:rtl/>', '甲“乙”'),
                            ('<w:rFonts w:hAnsi="Western"/><w:cs/>', '甲“乙”'),
                            ('<w:rFonts w:eastAsia="Asian"/>', '甲“乙”'),
                            ('<w:rFonts w:hAnsi="Western"/>', '甲（乙），丙。')):
            self.assertIsNone(layout.bind_docx_punctuation_fonts(
                self.document(f'<w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r>'), None))

    def test_theme_binding_and_nonstandard_namespace_prefix_remain_valid(self):
        import xml.etree.ElementTree as ET
        ns = layout.WORD_XML
        raw = self.document('<x:r><x:rPr><x:rFonts x:hAnsiTheme="minorHAnsi" x:eastAsiaTheme="majorEastAsia"/>'
                            '</x:rPr><x:t>甲“乙”</x:t></x:r>', prefix="x")
        result = ET.fromstring(layout.bind_docx_punctuation_fonts(raw, None))
        quote = next(run for run in result.iter(ns + "r") if run.find(ns + "t").text == "“")
        self.assertEqual(quote.find(ns + "rPr/" + ns + "rFonts").get(ns + "eastAsiaTheme"), "minorHAnsi")

    def test_font_only_import_copy_preserves_source_and_other_parts_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.docx"
            body = self.document('<w:r><w:rPr><w:rFonts w:hAnsi="Western" w:eastAsia="Asian"/></w:rPr><w:t>甲“乙”</w:t></w:r>')
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("word/document.xml", body)
                archive.writestr("word/header1.xml", body)
                archive.writestr("word/media/image.png", b"binary image")
            original = source.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "export failed"):
                with layout.docx_import_source(str(source)) as target:
                    temporary = Path(target)
                    self.assertNotEqual(temporary, source)
                    with zipfile.ZipFile(target) as imported:
                        self.assertNotEqual(imported.read("word/document.xml"), body)
                        self.assertNotEqual(imported.read("word/header1.xml"), body)
                        self.assertEqual(imported.read("word/media/image.png"), b"binary image")
                    raise RuntimeError("export failed")
            self.assertFalse(temporary.exists())
            self.assertEqual(source.read_bytes(), original)


class ImportStyleTests(unittest.TestCase):
    def styles(self):
        return f'''<w:styles xmlns:w="{layout.WORD_XML[1:-1]}"
          xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14">
          <w:style w:type="paragraph" w:styleId="builtin"><w:name w:val="toc 2"/><w:pPr><w:ind w:left="420"/></w:pPr></w:style>
          <w:style w:type="paragraph" w:customStyle="1" w:styleId="custom"><w:name w:val="TOC 2"/><w:basedOn w:val="builtin"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
          <w:style w:type="paragraph" w:styleId="other"><w:name w:val="ToolKnit import custom"/></w:style>
          <w:style w:type="character" w:styleId="character"><w:name w:val="TOC 2"/></w:style>
        </w:styles>'''.encode()

    def test_case_collisions_preserve_ids_references_properties_and_namespaces(self):
        import xml.etree.ElementTree as ET
        rewritten = layout.distinct_style_names(self.styles())
        root = ET.fromstring(rewritten)
        ns = layout.WORD_XML
        styles = {s.get(ns + "styleId"): s for s in root}
        self.assertEqual(styles["builtin"].find(ns + "name").get(ns + "val"), "toc 2")
        self.assertEqual(styles["custom"].find(ns + "name").get(ns + "val"), "ToolKnit import custom 2")
        self.assertEqual(styles["custom"].find(ns + "basedOn").get(ns + "val"), "builtin")
        self.assertEqual(styles["custom"].find(ns + "rPr/" + ns + "sz").get(ns + "val"), "24")
        self.assertEqual(styles["character"].find(ns + "name").get(ns + "val"), "TOC 2")
        self.assertIn(b'xmlns:w14=', rewritten)
        self.assertIn(b'mc:Ignorable="w14"', rewritten)
        self.assertIsNone(layout.distinct_style_names(rewritten))

    def test_import_copy_keeps_other_parts_and_is_removed_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.docx"
            body = b'<document>cached content, fields and drawings</document>'
            media = bytes(range(256))
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("word/styles.xml", self.styles())
                archive.writestr("word/document.xml", body)
                archive.writestr("word/media/image.png", media)
            original = source.read_bytes()
            temporary = None
            with self.assertRaisesRegex(RuntimeError, "export failed"):
                with layout.docx_import_source(str(source)) as target:
                    temporary = Path(target)
                    self.assertNotEqual(temporary, source)
                    with zipfile.ZipFile(target) as imported:
                        self.assertEqual(imported.read("word/document.xml"), body)
                        self.assertEqual(imported.read("word/media/image.png"), media)
                    raise RuntimeError("export failed")
            self.assertFalse(temporary.exists())
            self.assertFalse(temporary.parent.exists())
            self.assertEqual(source.read_bytes(), original)

    def test_unambiguous_and_legacy_documents_need_no_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.docx"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("word/styles.xml", f'<w:styles xmlns:w="{layout.WORD_XML[1:-1]}"/>')
            with layout.docx_import_source(str(source)) as target:
                self.assertEqual(target, str(source))
            with layout.docx_import_source("input.doc") as target:
                self.assertEqual(target, "input.doc")
        self.assertIsNone(layout.distinct_style_names(b'<!DOCTYPE styles [<!ENTITY x "test">]><styles/>'))


if __name__ == "__main__":
    unittest.main()
