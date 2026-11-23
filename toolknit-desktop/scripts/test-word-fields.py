"""Selective UNO contracts; no Office process or user document is opened."""
import importlib.util
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src-tauri/resources/office"))
import word_fields as fields
spec = importlib.util.spec_from_file_location("word_driver", ROOT / "src-tauri/resources/office/word-to-pdf.py")
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class Field:
    def __init__(self, kind, legacy=False):
        self.kind, self.calls, self.legacy = kind, 0, legacy

    def getSupportedServiceNames(self):
        return (("com.sun.star.text.TextField." if self.legacy else "com.sun.star.text.textfield.") + self.kind,)

    def update(self):
        self.calls += 1
        if self.kind not in fields.INTERNAL_FIELDS:
            raise AssertionError("Unsupported field must never be updated")


class Index:
    def __init__(self, allowed=True, unstable=False, text="section 1", service="ContentIndex", labels=False):
        self.allowed, self.unstable, self.text, self.calls = allowed, unstable, text, 0
        self.service, self.labels = service, labels

    def supportsService(self, name):
        return name == f"com.sun.star.text.{self.service}"

    def getPropertyValue(self, name):
        assert self.service == "IllustrationsIndex" and name == "CreateFromLabels"
        return self.labels

    def update(self):
        self.calls += 1
        if not self.allowed:
            raise AssertionError("Unsupported index must never be updated")

    def getAnchor(self):
        return SimpleNamespace(getString=lambda: str(self.calls) if self.unstable else self.text)


class Collection:
    def __init__(self, items):
        self.items, self.index = items, 0

    def createEnumeration(self):
        return Collection(self.items)

    def hasMoreElements(self):
        return self.index < len(self.items)

    def nextElement(self):
        item = self.items[self.index]
        self.index += 1
        return item

    def getCount(self):
        return len(self.items)

    def getByIndex(self, index):
        return self.items[index]

    def refresh(self):
        raise AssertionError("Global field refresh is forbidden")


class Document:
    def __init__(self, items=(), indexes=(), automark=""):
        self.fields, self.indexes, self.layouts = Collection(items), Collection(indexes), 0
        self.automark = automark

    def getPropertyValue(self, name):
        assert name == "IndexAutoMarkFileURL"
        return self.automark

    def getTextFields(self):
        return self.fields

    def getDocumentIndexes(self):
        return self.indexes

    def getRendererCount(self, selection, options):
        assert selection is self and options == ()
        self.layouts += 1
        return 3

    def refresh(self):
        raise AssertionError("Global document refresh is forbidden")


class InternalUpdateTests(unittest.TestCase):
    def test_internal_whitelist_and_legacy_aliases(self):
        items = [Field(kind, legacy=i % 2 == 0) for i, kind in enumerate(sorted(fields.INTERNAL_FIELDS))]
        doc = Document(items)
        summary = fields.refresh_internal_fields(doc)
        self.assertEqual(summary["fields"], len(fields.INTERNAL_FIELDS))
        self.assertEqual(summary["passes"], 2)
        self.assertTrue(summary["stabilized"])
        self.assertTrue(all(item.calls == 4 for item in items))
        self.assertEqual(doc.layouts, 4)

    def test_external_database_date_filename_and_unknown_fields_are_untouched(self):
        items = [Field(kind) for kind in ("DDE", "Database", "DateTime", "FileName", "Author", "GetExpression", "FutureField")]
        unsupported_index = Index(False, service="UserIndex")
        doc = Document(items, [unsupported_index])
        summary = fields.refresh_internal_fields(doc)
        self.assertEqual(summary["skippedFields"], 7)
        self.assertEqual(summary["skippedIndexes"], 1)
        self.assertEqual(summary["passes"], 0)
        self.assertEqual(doc.layouts, 0)
        self.assertTrue(all(item.calls == 0 for item in items))
        self.assertEqual(unsupported_index.calls, 0)

    def test_only_verified_local_indexes_are_updated(self):
        content = Index()
        captions = Index(service="IllustrationsIndex", labels=True)
        objects = Index(False, service="IllustrationsIndex", labels=False)
        alphabetic = Index(service="DocumentIndex")
        tables = Index(False, service="TableIndex")
        indexes = [content, captions, objects, alphabetic, tables]
        result = fields.refresh_internal_fields(Document([], indexes))
        self.assertEqual([item.calls for item in indexes], [2, 2, 0, 2, 0])
        self.assertEqual((result["indexes"], result["skippedIndexes"]), (3, 2))

    def test_alphabetical_external_or_unknown_sources_are_skipped(self):
        for source in ["file:///private/terms.sdi", "http://127.0.0.1/terms.sdi", None, False]:
            with self.subTest(source=source):
                alphabetic = Index(False, service="DocumentIndex")
                doc = Document([], [alphabetic], automark=source)
                result = fields.refresh_internal_fields(doc)
                self.assertEqual((result["indexes"], result["skippedIndexes"], result["passes"]), (0, 1, 0))
                self.assertEqual(alphabetic.calls, 0)
                self.assertEqual(doc.automark, source)

    def test_unreadable_concordance_property_skips_only_alphabetical_index(self):
        alphabetic, content = Index(False, service="DocumentIndex"), Index()
        doc = Document([], [alphabetic, content])
        with patch.object(doc, "getPropertyValue", side_effect=RuntimeError("unavailable")):
            result = fields.refresh_internal_fields(doc)
        self.assertEqual((result["indexes"], result["skippedIndexes"]), (1, 1))
        self.assertEqual((alphabetic.calls, content.calls), (0, 2))

    def test_field_and_index_limits(self):
        for doc in [Document([Field("DateTime")] * (fields.MAX_FIELDS + 1)), Document([], [Index()] * (fields.MAX_INDEXES + 1))]:
            with self.assertRaisesRegex(fields.FieldUpdateError, "^field-update-limit$"):
                fields.refresh_internal_fields(doc)

    def test_generated_index_text_is_bounded(self):
        with self.assertRaisesRegex(fields.FieldUpdateError, "^field-update-limit$"):
            fields.refresh_internal_fields(Document([], [Index(text="x" * (fields.MAX_INDEX_TEXT + 1))]))

    def test_unstable_toc_is_rejected_after_three_passes(self):
        index = Index(unstable=True)
        with self.assertRaisesRegex(fields.FieldUpdateError, "^field-update-unstable$"):
            fields.refresh_internal_fields(Document([], [index]))
        self.assertEqual(index.calls, 3)

    def test_uno_error_text_is_not_exposed(self):
        item = Field("PageCount")
        with patch.object(item, "update", side_effect=RuntimeError("private field contents C:/private.docx")):
            with self.assertRaisesRegex(fields.FieldUpdateError, "^field-update-failed$"):
                fields.refresh_internal_fields(Document([item]))


class DriverTests(unittest.TestCase):
    def test_default_load_keeps_external_updates_and_macros_disabled(self):
        doc, desktop = Mock(), Mock()
        desktop.loadComponentFromURL.return_value = doc
        doc.supportsService.return_value = True
        uno = SimpleNamespace(systemPathToFileUrl=lambda value: value, createUnoStruct=lambda _: SimpleNamespace(), Any=lambda *args: args)
        with patch.object(driver, "substitute_document_fonts", return_value=[]), patch.object(driver, "apply_docx_layout_compatibility"), patch.object(driver, "refresh_internal_fields") as refresh:
            self.assertEqual(driver.export_imported_document(desktop, "input.docx", "input.docx", "output.pdf", uno, Mock), [])
        refresh.assert_not_called()
        props = {item.Name: item.Value for item in desktop.loadComponentFromURL.call_args.args[3]}
        self.assertEqual(props["UpdateDocMode"], 0)
        self.assertEqual(props["MacroExecutionMode"], 0)
        self.assertTrue(props["ReadOnly"])
        doc.storeToURL.assert_called_once()
        doc.close.assert_called_once_with(True)

    def test_update_failure_closes_document_without_export(self):
        doc, desktop = Mock(), Mock()
        desktop.loadComponentFromURL.return_value = doc
        doc.supportsService.return_value = True
        uno = SimpleNamespace(systemPathToFileUrl=lambda value: value, createUnoStruct=lambda _: SimpleNamespace())
        with patch.object(driver, "substitute_document_fonts", return_value=[]), patch.object(driver, "apply_docx_layout_compatibility"), patch.object(driver, "refresh_internal_fields", side_effect=fields.FieldUpdateError("field-update-failed")):
            with self.assertRaisesRegex(driver.WordError, "^field-update-failed$"):
                driver.export_imported_document(desktop, "input.docx", "input.docx", "output.pdf", uno, Mock, True, {})
        doc.storeToURL.assert_not_called()
        doc.close.assert_called_once_with(True)

    def test_option_is_a_real_boolean(self):
        with self.assertRaisesRegex(driver.WordError, "^invalid-options$"):
            driver.convert_with_writer(None, "not-opened.docx", "output.pdf", None, None, "true")


if __name__ == "__main__":
    unittest.main()
