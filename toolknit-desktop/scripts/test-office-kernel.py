"""Exercise pinned patch preparation and dependency validation with real Git."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / "office-kernel"
sys.path.insert(0, str(ROOT))
import kernel
import prefetch


class KernelPreparationTests(unittest.TestCase):
    def test_committed_patch_hashes_match_lock(self):
        lock = kernel.load_lock()
        self.assertEqual(len(lock["upstream"]["commit"]), 40)
        self.assertFalse(lock["releaseGate"]["visualFidelityApproved"])

    def test_prepare_is_idempotent_and_conflicts_do_not_reset_user_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            source, package = work / "src", work / "package"
            source.mkdir()
            package.mkdir()
            kernel.run(["git", "init"], source)
            file = source / "settings.txt"
            file.write_text("old\n", encoding="utf-8", newline="\n")
            kernel.run(["git", "add", "settings.txt"], source)
            kernel.run(["git", "-c", "user.name=Kernel QA", "-c", "user.email=qa@example.invalid",
                        "commit", "-m", "fixture"], source)
            commit = kernel.run(["git", "rev-parse", "HEAD"], source)
            file.write_text("new\n", encoding="utf-8", newline="\n")
            change = kernel.run(["git", "diff"], source) + "\n"
            file.write_text("old\n", encoding="utf-8", newline="\n")
            (package / "change.patch").write_text(change, encoding="utf-8", newline="\n")
            lock = {"upstream": {"commit": commit}, "patches": [{"file": "change.patch"}]}
            with patch.object(kernel, "ROOT", package):
                kernel.prepare(work, lock)
                self.assertEqual(file.read_text(), "new\n")
                kernel.prepare(work, lock)
                self.assertEqual(file.read_text(), "new\n")
                file.write_text("unrelated user edit\n", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "conflicts"):
                    kernel.prepare(work, lock)
                self.assertEqual(file.read_text(), "unrelated user edit\n")
            with self.assertRaisesRegex(ValueError, "commit does not match"):
                kernel.check_source(source, {"upstream": {"commit": "0" * 40}})
            self.assertEqual(file.read_text(), "unrelated user edit\n")

    def test_receipt_does_not_turn_configured_or_stale_build_into_a_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            (work / "build").mkdir()
            lock = {"kernelId": "test", "upstream": {"commit": "a" * 40}, "patches": [],
                    "releaseGate": {"visualFidelityApproved": False}}
            with patch.object(kernel, "check_source"):
                with self.assertRaisesRegex(ValueError, "configured"):
                    kernel.record_stage(work, lock, "Test")
                config = work / "build/config_host.mk"
                config.write_text("configuration A")
                initial = kernel.status(work, lock)
                self.assertFalse(initial["runtimeBuilt"])
                self.assertFalse(initial["nativeImportCppunitPassed"])
                kernel.record_stage(work, lock, "Test")
                self.assertTrue(kernel.status(work, lock)["nativeImportCppunitPassed"])
                self.assertFalse(kernel.status(work, lock)["visualFidelityApproved"])
                lock["cppunitTestNames"] = ["a-new-required-test"]
                self.assertFalse(kernel.status(work, lock)["nativeImportCppunitPassed"])
                lock.pop("cppunitTestNames")
                config.write_text("configuration B")
                self.assertFalse(kernel.status(work, lock)["nativeImportCppunitPassed"])

    def test_overlapping_patch_stack_preserves_user_index_and_applies_once(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            source, package = work / "src", work / "package"
            source.mkdir()
            package.mkdir()
            kernel.run(["git", "init"], source)
            file = source / "settings.txt"
            original = "first\nsecond\nthird\n"
            file.write_text(original, encoding="utf-8", newline="\n")
            kernel.run(["git", "add", "."], source)
            kernel.run(["git", "-c", "user.name=Kernel QA", "-c", "user.email=qa@example.invalid",
                        "commit", "-m", "base"], source)
            commit = kernel.run(["git", "rev-parse", "HEAD"], source)
            first = "first\ncompression\nsecond\nthird\n"
            file.write_text(first, encoding="utf-8", newline="\n")
            (package / "1.patch").write_text(kernel.run(["git", "diff", "--no-textconv"], source) + "\n", newline="\n")
            kernel.run(["git", "add", "settings.txt"], source)
            final = "first\ncompression\nkerning\nsecond\nthird\n"
            file.write_text(final, encoding="utf-8", newline="\n")
            (package / "2.patch").write_text(kernel.run(["git", "diff", "--no-textconv"], source) + "\n", newline="\n")
            kernel.run(["git", "read-tree", "HEAD"], source)
            file.write_text(original, encoding="utf-8", newline="\n")
            (source / "notes.txt").write_text("unrelated staged user work\n")
            kernel.run(["git", "add", "notes.txt"], source)
            user_index = kernel.run(["git", "diff", "--cached"], source)
            lock = {"upstream": {"commit": commit}, "patches": [
                {"file": "1.patch"}, {"file": "2.patch"}]}
            with patch.object(kernel, "ROOT", package):
                kernel.prepare(work, lock)
                self.assertEqual(file.read_text(), final)
                self.assertEqual(kernel.patch_stack_prefix(source, lock), 2)
                kernel.prepare(work, lock)
                self.assertEqual(file.read_text(), final)
                self.assertEqual(kernel.run(["git", "diff", "--cached"], source), user_index)
                file.write_text("user edit within patched file\n")
                with self.assertRaisesRegex(ValueError, "conflicts"):
                    kernel.prepare(work, lock)
                self.assertEqual(file.read_text(), "user edit within patched file\n")
                self.assertEqual(kernel.run(["git", "diff", "--cached"], source), user_index)

    def test_unlocked_source_edit_invalidates_a_success_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            source = work / "src"
            source.mkdir()
            (work / "build").mkdir()
            (work / "build/config_host.mk").write_text("configuration")
            kernel.run(["git", "init"], source)
            file = source / "layout.cxx"
            file.write_text("original\n", newline="\n")
            kernel.run(["git", "add", "."], source)
            kernel.run(["git", "-c", "user.name=Kernel QA", "-c", "user.email=qa@example.invalid",
                        "commit", "-m", "base"], source)
            lock = {"kernelId": "test", "upstream": {"commit": kernel.run(["git", "rev-parse", "HEAD"], source)},
                    "patches": [], "releaseGate": {"visualFidelityApproved": False}}
            kernel.record_stage(work, lock, "Test")
            self.assertTrue(kernel.status(work, lock)["nativeImportCppunitPassed"])
            file.write_text("experimental line layout\n", newline="\n")
            self.assertFalse(kernel.status(work, lock)["nativeImportCppunitPassed"])
            file.write_text("original\n", newline="\n")
            self.assertTrue(kernel.status(work, lock)["nativeImportCppunitPassed"])
            (source / "new-filter.cxx").write_text("unregistered source\n", newline="\n")
            self.assertFalse(kernel.status(work, lock)["nativeImportCppunitPassed"])

    def test_patch_tampering_is_rejected_before_git_is_invoked(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "change.patch").write_bytes(b"changed")
            (root / "kernel.lock.json").write_text(json.dumps({"patches": [
                {"file": "change.patch", "sha256": hashlib.sha256(b"original").hexdigest()}]}))
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                kernel.load_lock(root)

    def test_dependency_plan_requires_checksums_and_upstream_host(self):
        digest = "a" * 64
        line = f'curl.exe -f -L -O https://dev-www.libreoffice.org/src/a.tar.xz expected checksum for a.tar.xz is {digest}'
        self.assertEqual(prefetch.download_plan(line), [("a.tar.xz", "https://dev-www.libreoffice.org/src/a.tar.xz", digest)])
        with self.assertRaisesRegex(ValueError, "host"):
            prefetch.download_plan(line.replace("dev-www.libreoffice.org", "example.invalid"))
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            prefetch.download_plan(line.split(" expected")[0])
        with self.assertRaisesRegex(ValueError, "filename"):
            prefetch.download_plan(line.replace("checksum for a.tar.xz", "checksum for ../a.tar.xz"))


if __name__ == "__main__":
    unittest.main()
