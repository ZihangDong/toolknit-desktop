"""Exercise the concordance guard with an actual Writer document we generated."""
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src-tauri/resources/office"))
import word_fields
import uno
import unohelper

spec = importlib.util.spec_from_file_location("driver", ROOT / "src-tauri/resources/office/word-to-pdf.py")
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


def main(office, source, profile, external_url):
    checks = []
    with driver.writer_session(office, profile) as desktop:
        document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(str(Path(source).resolve())), "_blank", 0,
            (driver.prop(uno, "Hidden", True), driver.prop(uno, "ReadOnly", True),
             driver.prop(uno, "UpdateDocMode", 0), driver.prop(uno, "MacroExecutionMode", 0),
             driver.prop(uno, "InteractionHandler", driver.make_abort_handler(uno, unohelper)())))
        if document is None:
            raise AssertionError("synthetic document failed to load")
        try:
            indexes = document.getDocumentIndexes()
            alphabetic = [indexes.getByIndex(i) for i in range(indexes.Count)
                          if indexes.getByIndex(i).supportsService("com.sun.star.text.DocumentIndex")]
            assert len(alphabetic) == 1
            cached = alphabetic[0].getAnchor().getString()
            assert "STALE_ALPHA_INDEX" in cached
            for url in [external_url, uno.systemPathToFileUrl(str(Path(source).parent / "missing-concordance.sdi"))]:
                document.setPropertyValue("IndexAutoMarkFileURL", url)
                result = word_fields.refresh_internal_fields(document)
                assert result["indexes"] == 4 and result["skippedIndexes"] == 1, result
                assert alphabetic[0].getAnchor().getString() == cached
                assert document.getPropertyValue("IndexAutoMarkFileURL") == url
                checks.append("external concordance index skipped; source and cached index preserved")
            document.setPropertyValue("IndexAutoMarkFileURL", "")
            result = word_fields.refresh_internal_fields(document)
            assert result["indexes"] == 5 and result["skippedIndexes"] == 0, result
            assert "ALPHABETIC_LOCAL_ENTRY" in alphabetic[0].getAnchor().getString()
            assert "STALE_ALPHA_INDEX" not in alphabetic[0].getAnchor().getString()
            checks.append("empty concordance URL permits local alphabetical index update")
        finally:
            document.close(True)
    print(json.dumps({"checks": checks}))


if __name__ == "__main__":
    main(*sys.argv[1:])
