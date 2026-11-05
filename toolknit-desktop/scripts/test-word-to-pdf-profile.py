"""Test the disposable Writer extension cache without opening user documents."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("word_driver", Path(__file__).resolve().parents[1] / "src-tauri/resources/office/word-to-pdf.py")
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tk-word-cache-test-")
        self.root = Path(self.temp.name)
        self.profile = self.root / "profile"
        self.cache = self.root / "cache" / "runtime-id"
        for group in ("extensions", "uno_packages"):
            folder = self.profile / "user" / group
            folder.mkdir(parents=True)
            (folder / "registration.txt").write_text("generated registration")
        (self.profile / "user" / "registrymodifications.xcu").write_text("private-registry")
        (self.profile / "user" / "document.txt").write_text("private-document")
        self.patcher = patch.object(driver, "extension_cache_path", return_value=str(self.cache))
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def test_cache_contains_only_generated_registrations(self):
        driver.remember_extensions("unused", str(self.profile))
        names = sorted(str(p.relative_to(self.cache)).replace("\\", "/") for p in self.cache.rglob("*") if p.is_file())
        self.assertEqual(names, ["extensions/registration.txt", "uno_packages/registration.txt"])
        target = self.root / "fresh"
        driver.prepare_profile(str(target))
        security = (target / "user/registrymodifications.xcu").read_bytes()
        driver.restore_extensions("unused", str(target))
        self.assertEqual((target / "user/registrymodifications.xcu").read_bytes(), security)
        self.assertEqual((target / "user/extensions/registration.txt").read_text(), "generated registration")

    def test_missing_and_oversized_caches_are_optional(self):
        target = self.root / "fresh"
        driver.restore_extensions("unused", str(target))
        self.assertFalse(target.exists())
        (self.profile / "user/extensions/large.bin").write_bytes(b"0" * (8 * 1024 * 1024))
        driver.remember_extensions("unused", str(self.profile))
        self.assertFalse(self.cache.exists())
        self.assertEqual(list(self.cache.parent.iterdir()), [])

    def test_runtime_identity_invalidates_cache(self):
        self.patcher.stop()
        try:
            exe = self.root / "soffice.bin"
            exe.write_bytes(b"first")
            first = driver.extension_cache_path(str(exe))
            exe.write_bytes(b"new-runtime-version")
            self.assertNotEqual(driver.extension_cache_path(str(exe)), first)
            self.assertEqual(driver.extension_cache_path(str(self.root / "soffice.exe")), driver.extension_cache_path(str(self.root / "soffice.com")))
        finally:
            self.patcher.start()


if __name__ == "__main__":
    unittest.main()
