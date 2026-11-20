"""Download the configured upstream dependencies concurrently, with SHA-256."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlparse

import kernel


def download_plan(text):
    items = []
    for line in text.splitlines():
        url = re.search(r"curl(?:\.exe)? -f -L -O (https://[^ ]+)", line)
        checksum = re.search(r"expected checksum for ([^ ]+) is ([0-9a-f]{64})", line)
        if not url:
            continue
        if not checksum:
            raise ValueError("Upstream dependency has no SHA-256")
        name, digest = checksum.groups()
        if Path(name).name != name or any(c in name for c in ("/", "\\", ":")):
            raise ValueError("Invalid dependency filename")
        parsed = urlparse(url[1])
        if parsed.hostname != "dev-www.libreoffice.org" or not parsed.path.startswith(("/src/", "/extern/")):
            raise ValueError("Unexpected upstream dependency host")
        items.append((name, url[1], digest))
    return items


def fetch(item, destination):
    name, url, digest = item
    target = destination / name
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError("Existing dependency SHA-256 mismatch: " + name)
        return name + " (cached)"
    with tempfile.TemporaryDirectory(prefix="prefetch-", dir=destination) as stage:
        partial = Path(stage) / name
        result = subprocess.run(["curl.exe" if os.name == "nt" else "curl", "--fail", "--location",
                                 "--silent", "--show-error", "--retry", "2", "--connect-timeout", "15",
                                 "--max-time", "900", "--output", str(partial), url],
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("Download failed: " + name + " " + result.stderr[-500:])
        if hashlib.sha256(partial.read_bytes()).hexdigest() != digest:
            raise ValueError("Downloaded dependency SHA-256 mismatch: " + name)
        partial.replace(target)
    return name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=6, choices=range(1, 9))
    args = parser.parse_args()
    if not args.work_root.is_absolute():
        parser.error("--work-root must be absolute")
    work = args.work_root.resolve()
    kernel.check_source(work / "src", kernel.load_lock())
    make = str(work / "tools/make.exe") if os.name == "nt" else "make"
    plan = kernel.run([make, "-n", "fetch"], work / "build")
    items = download_plan(plan)
    destination = work / "external"
    destination.mkdir(exist_ok=True)
    print(f"Fetching {len(items)} configured archives with {args.jobs} workers", flush=True)
    failures = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        pending = {pool.submit(fetch, item, destination): item[0] for item in items}
        for index, future in enumerate(as_completed(pending), 1):
            try:
                print(f"[{index}/{len(items)}] " + future.result(), flush=True)
            except Exception as error:
                failures.append(str(error))
                print(str(error), flush=True)
    if failures:
        raise RuntimeError(f"{len(failures)} dependencies failed; verified downloads were retained")


if __name__ == "__main__":
    main()
