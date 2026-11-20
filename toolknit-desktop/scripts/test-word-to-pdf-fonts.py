"""Check installed-font aliases and fallback rejection on Windows."""
import os
import sys
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

OFFICE = Path(__file__).resolve().parents[1] / "src-tauri/resources/office"
sys.path.insert(0, str(OFFICE))
import word_font_metrics as fonts


class WindowsFontTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows installed-font metrics")
    def test_localized_alias_is_measured_without_font_substitution(self):
        localized = fonts.windows_font_line_twips("宋体", 12, False, False)
        english = fonts.windows_font_line_twips("SimSun", 12, False, False)
        if localized is None:
            self.skipTest("SimSun is not installed")
        self.assertEqual(localized, english)
        self.assertGreaterEqual(localized, 240)
        self.assertIsNone(fonts.windows_font_line_twips("ToolKnit Missing Font 9782", 12, False, False))


class FontSubstitutionTests(unittest.TestCase):
    class Portion:
        def __init__(self, name, text="Hello", suffix="", family=0):
            self.props = {"String": text, "CharFontName" + suffix: name, "CharFontFamily" + suffix: family}

        def getPropertyValue(self, name):
            return self.props.get(name)

        def setPropertyValue(self, name, value):
            self.props[name] = value

    def convert(self, portions, installed=("Liberation Sans",), details=None):
        device = SimpleNamespace(getFontDescriptors=lambda: [SimpleNamespace(Name=name) for name in installed])
        window = SimpleNamespace(getToolkit=lambda: SimpleNamespace(createScreenCompatibleDevice=lambda *args: device))
        document = SimpleNamespace(CurrentController=SimpleNamespace(Frame=SimpleNamespace(ContainerWindow=window)))
        with patch.object(fonts, "document_font_ranges", return_value=iter(portions)), \
             patch.object(fonts, "windows_font_details", side_effect=details or (lambda *args: None)):
            return fonts.substitute_document_fonts(document)

    def test_missing_fonts_are_replaced_once_and_unused_scripts_ignored(self):
        portions = [self.Portion("Missing Paid Family") for _ in range(2)]
        for portion in portions:
            portion.props["CharFontNameComplex"] = "Unused Missing Font"
        notices = self.convert(portions)
        self.assertEqual(notices, [dict(code="missing-font", font="Missing Paid Family", replacement="Liberation Sans")])
        self.assertTrue(all(p.props["CharFontName"] == "Liberation Sans" for p in portions))

    def test_installed_commercial_fonts_and_localized_aliases_are_retained(self):
        portions = [self.Portion("Commercial Family"), self.Portion("宋体", "中文", "Asian")]
        notices = self.convert(portions, ("Commercial Family", "SimSun"), lambda name: (240, False) if name == "宋体" else None)
        self.assertEqual(notices, [])
        self.assertEqual(portions[0].props["CharFontName"], "Commercial Family")
        self.assertEqual(portions[1].props["CharFontNameAsian"], "宋体")

    def test_restricted_fonts_are_replaced_with_a_notice(self):
        portion = self.Portion("Restricted Family")
        notices = self.convert([portion], ("Restricted Family", "Liberation Sans"), lambda name: (240, name == "Restricted Family"))
        self.assertEqual(notices[0]["code"], "embedding-restricted")
        self.assertEqual(portion.props["CharFontName"], "Liberation Sans")

    def test_no_free_cjk_or_symbol_fallback_warns_without_changing_font(self):
        portions = [self.Portion("Missing CJK", "中文", "Asian"), self.Portion("Missing Wingdings")]
        notices = self.convert(portions)
        self.assertEqual(len(notices), 2)
        self.assertTrue(all(not n["replacement"] for n in notices))
        self.assertEqual(portions[0].props["CharFontNameAsian"], "Missing CJK")
        self.assertEqual(portions[1].props["CharFontName"], "Missing Wingdings")

    def test_cjk_fallback_uses_available_open_source_cjk_family(self):
        portion = self.Portion("Missing 宋体", "中文", "Asian")
        notices = self.convert([portion], ("Liberation Sans", "Noto Serif CJK SC"))
        self.assertEqual(notices[0]["replacement"], "Noto Serif CJK SC")
        self.assertEqual(portion.props["CharFontNameAsian"], "Noto Serif CJK SC")

    def test_catalog_or_traversal_failure_is_visible(self):
        self.assertEqual(self.convert([], ())[0]["code"], "font-check-unavailable")
        def broken():
            yield self.Portion("Missing")
            raise RuntimeError("unavailable")
        notices = self.convert(broken())
        self.assertEqual(notices[-1]["code"], "font-check-incomplete")


if __name__ == "__main__":
    unittest.main()
