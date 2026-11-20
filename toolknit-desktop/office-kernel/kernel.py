"""Prepare a pinned LibreOffice checkout without changing desktop runtimes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import os
import tempfile

ROOT = Path(__file__).resolve().parent


def run(command, cwd=None):
    result = subprocess.run(command, cwd=cwd, check=True, text=True, encoding="utf-8", errors="replace",
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.stdout.strip()


def load_lock(root=ROOT):
    lock = json.loads((root / "kernel.lock.json").read_text(encoding="utf-8"))
    for item in lock["patches"]:
        patch = (root / item["file"]).resolve()
        if not patch.is_relative_to(root.resolve()):
            raise ValueError("Patch must be inside office-kernel")
        if hashlib.sha256(patch.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Patch SHA-256 mismatch: " + item["file"])
    return lock


def check_source(source, lock):
    actual = run(["git", "rev-parse", "HEAD"], source)
    if actual != lock["upstream"]["commit"]:
        raise ValueError("Source commit does not match the lock; existing checkout was left intact")


def patch_state(source, patch):
    for state, extra in (("applied", ["--reverse"]), ("pending", [])):
        result = subprocess.run(["git", "apply", "--check", *extra, str(patch)], cwd=source,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            return state
    return "conflict"


def patch_stack_prefix(source, lock):
    """Compare work files with each patch prefix using an isolated Git index.

    Later patches can overlap earlier ones, so reverse-checking each patch
    against the final worktree incorrectly reports conflicts. The real index
    and worktree are never changed while identifying the applied prefix.
    """
    patches = [ROOT / item["file"] for item in lock["patches"]]
    if not patches:
        return 0
    paths = set()
    for patch in patches:
        entries = run(["git", "apply", "--numstat", "-z", str(patch)], source)
        for entry in entries.split("\0"):
            if entry:
                name = entry.split("\t", 2)[2]
                target = (source / name).resolve()
                if not target.is_relative_to(source.resolve()):
                    raise ValueError("Patch path escapes source checkout")
                paths.add(name)
    if not paths:
        raise ValueError("Patch stack contains no file changes")
    paths = sorted(paths)
    actual = {}
    for name in paths:
        path = source / name
        if path.is_file():
            data = path.read_bytes()
            actual[name] = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        else:
            actual[name] = None
    with tempfile.TemporaryDirectory(prefix="toolknit-patch-index-") as folder:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(folder) / "index")}

        def indexed(*arguments):
            result = subprocess.run(["git", *arguments], cwd=source, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if result.returncode:
                raise ValueError("Invalid pinned patch stack: " + result.stderr.decode("utf-8", errors="replace"))
            return result.stdout.decode("utf-8")

        indexed("read-tree", "HEAD")
        matching_prefix = None
        for prefix in range(len(patches) + 1):
            if prefix:
                indexed("apply", "--cached", "--binary", "--whitespace=error", str(patches[prefix - 1]))
            expected = dict.fromkeys(paths)
            for entry in indexed("ls-files", "--stage", "-z", "--", *paths).split("\0"):
                if entry:
                    metadata, name = entry.split("\t", 1)
                    expected[name] = metadata.split()[1]
            if expected == actual:
                matching_prefix = prefix
        return matching_prefix


def prepare(work, lock):
    source = work / "src"
    if not (source / ".git").exists():
        if source.exists() and any(source.iterdir()):
            raise ValueError("Source directory is not empty; it was left intact")
        work.mkdir(parents=True, exist_ok=True)
        upstream = lock["upstream"]
        run(["git", "-c", "core.autocrlf=false", "clone", "--filter=blob:none", "--no-checkout",
             "--depth", "1", "--branch", upstream["tag"], upstream["repository"], str(source)])
        run(["git", "-c", "core.longpaths=true", "checkout", "--detach", upstream["commit"]], source)
    check_source(source, lock)
    prefix = patch_stack_prefix(source, lock)
    if prefix is None:
        raise ValueError("Patch stack conflicts with existing changes; no reset performed")
    for item in lock["patches"][prefix:]:
        patch = ROOT / item["file"]
        state = patch_state(source, patch)
        if state == "conflict":
            raise ValueError("Patch conflicts with existing changes; no reset performed: " + item["file"])
        if state == "pending":
            run(["git", "apply", "--binary", "--whitespace=error", str(patch)], source)
    for name in ("build", "downloads", "external", "tools"):
        (work / name).mkdir(exist_ok=True)
    return source


def status(work, lock):
    source = work / "src"
    check_source(source, lock)
    prefix = patch_stack_prefix(source, lock)
    source_hash = source_changes_hash(work)
    receipts = {}
    for stage in ("Build", "Test"):
        path = work / (stage.lower() + "-receipt.json")
        if path.is_file():
            receipt = json.loads(path.read_text(encoding="utf-8"))
            if (prefix == len(lock["patches"])
                    and receipt.get("commit") == lock["upstream"]["commit"]
                    and receipt.get("patches") == lock["patches"]
                    and receipt.get("configurationSha256") == configuration_hash(work)
                    and receipt.get("sourceChangesSha256") == source_hash
                    and (stage != "Test" or receipt.get("testSelection") == test_selection(lock))):
                receipts[stage] = receipt
    runtime_files = all((work / "build/instdir/program" / name).is_file()
                        for name in ("soffice.com", "soffice.bin", "swlo.dll", "python.exe"))
    return {"kernelId": lock["kernelId"], "source": str(source),
            "commit": lock["upstream"]["commit"],
            "patches": [{"file": item["file"], "state": "conflict" if prefix is None else
                         "applied" if index < prefix else "pending"}
                        for index, item in enumerate(lock["patches"])],
            "configured": (work / "build/config_host.mk").is_file(),
            "sourceChangesSha256": source_hash,
            "runtimeFilesPresent": runtime_files,
            "runtimeBuilt": runtime_files and "Build" in receipts,
            "nativeImportCppunitPassed": "Test" in receipts,
            "visualFidelityApproved": lock["releaseGate"]["visualFidelityApproved"]}


def configuration_hash(work):
    config = work / "build/config_host.mk"
    return hashlib.sha256(config.read_bytes()).hexdigest() if config.is_file() else None


def source_changes_hash(work):
    source = work / "src"
    if not (source / ".git").exists():
        return None
    digest = hashlib.sha256()
    def git_bytes(*arguments):
        return subprocess.run(["git", *arguments], cwd=source, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    digest.update(git_bytes("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"))
    names = git_bytes("ls-files", "--others", "--exclude-standard", "-z").split(b"\0")
    for name in sorted(name for name in names if name):
        data = (source / name.decode("utf-8")).read_bytes()
        digest.update(len(name).to_bytes(8, "big") + name)
        digest.update(hashlib.sha256(data).digest())
    return digest.hexdigest()


def test_selection(lock):
    return {"targets": lock.get("cppunitTargets", []), "names": lock.get("cppunitTestNames", [])}


def record_stage(work, lock, stage):
    """Called by the build wrapper only after make exits successfully."""
    check_source(work / "src", lock)
    if not configuration_hash(work):
        raise ValueError("No configured build is available")
    if patch_stack_prefix(work / "src", lock) != len(lock["patches"]):
        raise ValueError("Cannot record success for a checkout missing its patches")
    receipt = {"stage": stage, "completedAtUtc": datetime.now(timezone.utc).isoformat(),
               "commit": lock["upstream"]["commit"], "patches": lock["patches"],
               "configurationSha256": configuration_hash(work),
               "sourceChangesSha256": source_changes_hash(work), "visualFidelityApproved": False}
    if stage == "Test":
        receipt["testSelection"] = test_selection(lock)
    target = work / (stage.lower() + "-receipt.json")
    partial = target.with_suffix(".json.part")
    partial.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    partial.replace(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "status", "record-stage"))
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--stage", choices=("Build", "Test"))
    args = parser.parse_args()
    if not args.work_root.is_absolute():
        parser.error("--work-root must be an absolute path")
    lock = load_lock()
    work = args.work_root.resolve()
    if args.command == "prepare":
        prepare(work, lock)
    elif args.command == "record-stage":
        if not args.stage:
            parser.error("record-stage requires --stage")
        record_stage(work, lock, args.stage)
    print(json.dumps(status(work, lock), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
