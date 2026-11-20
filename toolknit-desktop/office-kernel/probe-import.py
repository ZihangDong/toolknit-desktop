"""Run with the runtime's UNO Python; never call the compatibility shim."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from runtime_info import runtime_info

ROOT = Path(__file__).resolve().parent
OFFICE = ROOT.parent / "src-tauri/resources/office"
sys.path.insert(0, str(OFFICE))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--soffice", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--suite", choices=("compression", "kerning", "overflow", "spacing", "all"), default="all")
    args = parser.parse_args()
    import uno
    import unohelper
    spec = importlib.util.spec_from_file_location("word_driver", OFFICE / "word-to-pdf.py")
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)
    engine_info = runtime_info(args.soffice)
    cases = []
    if args.suite in ("compression", "all"):
        cases.extend(("character-spacing-" + name + ".docx", "CharacterCompressionType", expected)
                     for name, expected in (("punctuation", 1), ("none", 0), ("kana", 2), ("absent", 0), ("invalid", 0)))
    if args.suite in ("kerning", "all"):
        cases.extend((filename, "IsKernAsianPunctuation", expected) for filename, expected in (
            ("punctuation-kerning-enabled.docx", True),
            ("punctuation-kerning-disabled.docx", False),
            ("punctuation-kerning-empty.docx", False),
            ("punctuation-kerning-default.rtf", False),
            ("character-spacing-absent.docx", True)))
    if args.suite in ("overflow", "all"):
        cases.extend((filename, "ParaIsHangingPunctuation", expected) for filename, expected in (
            ("paragraph-overflow-punctuation.docx", [False, True, True, True, False, True, False, True, False]),
            ("character-spacing-absent.docx", [True])))
    if args.suite in ("spacing", "all"):
        cases.extend(("word-auto-spacing-inheritance.docx", property_name, values)
                     for property_name, values in (
                         ("ParaAutoSpaceDE", [False, True, False, True, False, False, True, True]),
                         ("ParaAutoSpaceDN", [False, False, True, True, True, False, True, False])))
    rows = []
    os.environ.setdefault("SAL_USE_VCLPLUGIN", "svp")
    os.environ.setdefault("SAL_DISABLE_PRINTERLIST", "1")
    abort = driver.make_abort_handler(uno, unohelper)
    with tempfile.TemporaryDirectory(prefix="toolknit-kernel-import-") as profile:
        with driver.writer_session(str(args.soffice), profile) as desktop:
            for name, property_name, expected in cases:
                source = args.source_root / "sw/qa/extras/ooxmlimport/data" / name
                if not source.is_file():
                    raise FileNotFoundError("Apply all pinned patches before running this suite: " + str(source))
                document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(str(source.resolve())), "_blank", 0,
                    tuple(driver.prop(uno, key, value) for key, value in (
                        ("Hidden", True), ("ReadOnly", True), ("MacroExecutionMode", 0),
                        ("UpdateDocMode", 0), ("InteractionHandler", abort()))))
                if document is None:
                    raise RuntimeError("Fixture import failed: " + name)
                try:
                    if isinstance(expected, list):
                        enumeration = document.Text.createEnumeration()
                        paragraphs = []
                        while enumeration.hasMoreElements():
                            paragraphs.append(enumeration.nextElement())
                        if len(paragraphs) != len(expected):
                            raise RuntimeError("Paragraph count changed: " + name)
                        for index, (paragraph, value) in enumerate(zip(paragraphs, expected), 1):
                            actual = paragraph.getPropertyValue(property_name)
                            rows.append({"case": name, "paragraph": index, "property": property_name,
                                         "expected": value, "actual": actual, "passed": actual == value})
                    else:
                        settings = document.createInstance("com.sun.star.document.Settings")
                        actual = settings.getPropertyValue(property_name)
                        rows.append({"case": name, "property": property_name, "expected": expected,
                                     "actual": actual, "passed": actual == expected})
                finally:
                    document.close(True)
    result = {"passed": all(row["passed"] for row in rows), "cases": rows, "engine": engine_info,
              "pythonCompatibilityShimApplied": False, "visualFidelityApproved": False}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
