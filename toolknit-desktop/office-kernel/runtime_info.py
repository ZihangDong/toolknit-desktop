"""Identify the layout and import binaries actually used by a diagnostic."""
import hashlib
import os
from pathlib import Path
import subprocess


def runtime_info(command):
    engine = Path(command).resolve()
    version = subprocess.run([str(engine), "--version"], capture_output=True, check=True,
                             timeout=15, creationflags=0x08000000 if os.name == "nt" else 0)
    modules = {}
    for name in ("swlo.dll", "sw_writerfilterlo.dll", "mswordlo.dll", "vcllo.dll", "editenglo.dll", "mergedlo.dll"):
        file = engine.parent / name
        if file.is_file():
            modules[name] = hashlib.sha256(file.read_bytes()).hexdigest()
    return {"command": str(engine), "version": version.stdout.decode("utf-8", errors="replace").strip(),
            "writerModuleSha256": modules.get("swlo.dll"), "moduleSha256s": modules}
