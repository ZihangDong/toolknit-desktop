"""Shared desktop/CLI Writer driver. Only stable JSON status is emitted."""
import json
import hashlib
import os
import shutil
import tempfile
import subprocess
import sys
import time
import uuid
import zipfile
import xml.etree.ElementTree as ET

MAX_INPUT = 50 * 1024 * 1024
MAX_EXPANDED = 200 * 1024 * 1024
MAX_OUTPUT = 150 * 1024 * 1024


def extension_cache_path(soffice):
    # Only generated extension registrations are reusable. Never cache a Writer
    # profile, registrymodifications.xcu, documents, history, or user macros.
    program = os.path.dirname(os.path.realpath(soffice))
    parts = [program]
    executable = "soffice.bin" if os.path.isfile(os.path.join(program, "soffice.bin")) else os.path.basename(soffice)
    for name in (executable, "version.ini", "fundamental.ini"):
        try:
            stat = os.stat(os.path.join(program, name))
            parts.append((name, stat.st_size, stat.st_mtime_ns))
        except OSError:
            pass
    key = hashlib.sha256(repr(parts).encode("utf-8")).hexdigest()[:24]
    owner = str(os.getuid()) if hasattr(os, "getuid") else "user"
    return os.path.join(tempfile.gettempdir(), "toolknit-word-extensions-v1-" + owner, key)


def copy_extension_cache(source, destination):
    # A broken/oversized cache is disposable. All limits are checked before
    # copying so a cache miss leaves a fresh isolated conversion profile.
    entries, total = [], 0
    for group in ("extensions", "uno_packages"):
        base = os.path.join(source, group)
        if not os.path.isdir(base) or os.path.islink(base):
            raise OSError("cache-missing")
        for root, dirs, files in os.walk(base, followlinks=False):
            for name in dirs + files:
                entry = os.path.join(root, name)
                if os.path.islink(entry) or (hasattr(os.path, "isjunction") and os.path.isjunction(entry)):
                    raise OSError("cache-link")
            for name in files:
                entry = os.path.join(root, name)
                total += os.path.getsize(entry)
                entries.append((entry, os.path.relpath(entry, source)))
                if total > 8 * 1024 * 1024 or len(entries) > 2000:
                    raise OSError("cache-large")
    for entry, relative in entries:
        target = os.path.join(destination, relative)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(entry, target)


def restore_extensions(soffice, profile):
    try:
        cache = extension_cache_path(soffice)
        if os.path.islink(cache) or os.path.islink(os.path.dirname(cache)):
            return
        copy_extension_cache(cache, os.path.join(profile, "user"))
    except OSError:
        pass


def remember_extensions(soffice, profile):
    # Called immediately after engine startup, before opening any user file.
    stage = None
    try:
        cache = extension_cache_path(soffice)
        parent = os.path.dirname(cache)
        if os.path.exists(cache) or os.path.islink(parent):
            return
        os.makedirs(parent, mode=0o700, exist_ok=True)
        stage = tempfile.mkdtemp(prefix="seed-", dir=parent)
        copy_extension_cache(os.path.join(profile, "user"), stage)
        os.rename(stage, cache)
        stage = None
    except OSError:
        pass
    finally:
        if stage:
            shutil.rmtree(stage, ignore_errors=True)


class WordError(Exception):
    pass


def inspect_word(source):
    extension = os.path.splitext(source)[1].lower()
    if extension not in (".doc", ".docx"):
        raise WordError("invalid-extension")
    if not os.path.isfile(source) or os.path.islink(source) or os.path.getsize(source) == 0:
        raise WordError("invalid-input")
    if os.path.getsize(source) > MAX_INPUT:
        raise WordError("input-too-large")
    with open(source, "rb") as handle:
        signature = handle.read(8)
    if extension == ".doc":
        if signature != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            raise WordError("invalid-document")
        return
    if signature == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise WordError("password-or-invalid-document")
    if not signature.startswith(b"PK"):
        raise WordError("invalid-document")
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(item.file_size for item in entries) > MAX_EXPANDED:
                raise WordError("input-too-large")
            names = [item.filename for item in entries]
            if len(names) != len(set(names)) or "word/document.xml" not in names or "[Content_Types].xml" not in names:
                raise WordError("invalid-document")
            for item in entries:
                name = item.filename.lower().replace("\\", "/")
                if name.startswith("/") or ".." in name.split("/") or item.flag_bits & 1:
                    raise WordError("invalid-document")
                if "vbaproject" in name or name.startswith("word/embeddings/"):
                    raise WordError("active-content")
                if name.endswith(".rels") or name == "[content_types].xml":
                    if item.file_size > 2 * 1024 * 1024:
                        raise WordError("input-too-large")
                    raw = archive.read(item)
                    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                        raise WordError("invalid-document")
                    tree = ET.fromstring(raw)
                    for node in tree.iter():
                        if node.attrib.get("TargetMode", "").lower() == "external" and not node.attrib.get("Type", "").endswith("/hyperlink"):
                            raise WordError("external-content")
                        if "macroenabled" in node.attrib.get("ContentType", "").lower():
                            raise WordError("active-content")
    except (zipfile.BadZipFile, KeyError, ET.ParseError, RuntimeError):
        raise WordError("invalid-document")


def make_abort_handler(uno, unohelper):
    from com.sun.star.task import XInteractionHandler

    class AbortPrompts(unohelper.Base, XInteractionHandler):
        def __init__(self):
            self.prompted = False

        def handle(self, request):
            self.prompted = True
            for continuation in request.getContinuations():
                abort = continuation.queryInterface(uno.getTypeByName("com.sun.star.task.XInteractionAbort"))
                if abort:
                    abort.select()
                    return

    return AbortPrompts


def prop(uno, name, value):
    item = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    item.Name, item.Value = name, value
    return item


def prepare_profile(profile):
    os.makedirs(os.path.join(profile, "user"), exist_ok=True)
    with open(os.path.join(profile, "user", "registrymodifications.xcu"), "w", encoding="utf-8") as f:
        f.write('''<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/LoadSave/General"><prop oor:name="LoadPrinterSettings" oor:op="fuse"><value>false</value></prop></item>
</oor:items>''')


def start_writer(soffice, profile):
    import uno

    pipe = "toolknit_word_" + uuid.uuid4().hex
    args = [soffice, "--headless", "--invisible", "--nologo", "--nodefault", "--norestore", "--nofirststartwizard",
            "-env:UserInstallation=" + uno.systemPathToFileUrl(os.path.abspath(profile)),
            "--accept=pipe,name=" + pipe + ";urp;StarOffice.ComponentContext"]
    office = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              creationflags=0x08000000 if os.name == "nt" else 0)
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    deadline = time.monotonic() + 25
    while True:
        try:
            context = resolver.resolve("uno:pipe,name=" + pipe + ";urp;StarOffice.ComponentContext")
            return office, context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        except Exception:
            if time.monotonic() >= deadline or office.poll() is not None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(office.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
                else:
                    office.kill()
                office.wait(timeout=5)
                raise WordError("runtime-start-failed")
            time.sleep(0.1)


def convert_with_writer(desktop, source, destination, uno, AbortPrompts):
    inspect_word(source)
    handler = AbortPrompts()
    document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(source)), "_blank", 0,
        (prop(uno, "Hidden", True), prop(uno, "ReadOnly", True), prop(uno, "MacroExecutionMode", 0),
         prop(uno, "UpdateDocMode", 0), prop(uno, "InteractionHandler", handler)))
    if document is None:
        raise WordError("password-or-invalid-document" if handler.prompted else "invalid-document")
    try:
        if not document.supportsService("com.sun.star.text.TextDocument"):
            raise WordError("invalid-document")
        # Preserve cached fields and never refresh external/DDE data.
        document.storeToURL(uno.systemPathToFileUrl(os.path.abspath(destination)),
            (prop(uno, "FilterName", "writer_pdf_Export"), prop(uno, "Overwrite", False),
             prop(uno, "FilterData", uno.Any("[]com.sun.star.beans.PropertyValue", (prop(uno, "ExportBookmarks", True), prop(uno, "ExportFormFields", False))))))
    finally:
        try:
            document.close(True)
        except Exception:
            pass
    if not os.path.isfile(destination):
        raise WordError("render-failed")
    size = os.path.getsize(destination)
    if size < 128:
        raise WordError("empty-output")
    if size > MAX_OUTPUT:
        raise WordError("output-too-large")
    with open(destination, "rb") as f:
        start = f.read(5)
        f.seek(max(0, size - 8192))
        tail = f.read()
    if start != b"%PDF-" or b"%%EOF" not in tail:
        raise WordError("render-failed")


def write_batch_status(status_path, files):
    temporary = status_path + ".part"
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump({"files": files}, f, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, status_path)


def convert_batch(soffice, manifest_path, profile, status_path):
    import uno
    import unohelper
    AbortPrompts = make_abort_handler(uno, unohelper)
    with open(manifest_path, "r", encoding="utf-8") as f:
        items = json.load(f).get("items", [])
    prepare_profile(profile)
    restore_extensions(soffice, profile)
    office, desktop = start_writer(soffice, profile)
    remember_extensions(soffice, profile)
    results = []
    try:
        for item in items:
            row = {"index": int(item["index"]), "status": "failed", "code": "render-failed"}
            destination = item["destination"]
            try:
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                try:
                    os.remove(destination)
                except FileNotFoundError:
                    pass
                convert_with_writer(desktop, item["source"], destination, uno, AbortPrompts)
                row = {"index": row["index"], "status": "success", "code": None}
            except WordError as error:
                row["code"] = str(error)
                try:
                    os.remove(destination)
                except OSError:
                    pass
            except Exception:
                row["code"] = "render-failed"
                try:
                    os.remove(destination)
                except OSError:
                    pass
            results.append(row)
            write_batch_status(status_path, results)
    finally:
        try:
            desktop.terminate()
        except Exception:
            pass
        try:
            office.wait(timeout=3)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(office.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
            else:
                office.kill()
            office.wait(timeout=3)
    return {"files": results}


def convert(soffice, source, destination, profile):
    inspect_word(source)
    import uno
    import unohelper
    prepare_profile(profile)
    restore_extensions(soffice, profile)
    AbortPrompts = make_abort_handler(uno, unohelper)
    office, desktop = start_writer(soffice, profile)
    remember_extensions(soffice, profile)
    try:
        convert_with_writer(desktop, source, destination, uno, AbortPrompts)
    finally:
        try:
            desktop.terminate()
        except Exception:
            pass
        try:
            office.wait(timeout=3)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(office.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
            else:
                office.kill()
            office.wait(timeout=3)


if __name__ == "__main__":
    try:
        if len(sys.argv) == 6 and sys.argv[2] == "--manifest":
            result = convert_batch(sys.argv[1], sys.argv[3], sys.argv[4], sys.argv[5])
            print(json.dumps({"ok": True, **result}))
        elif len(sys.argv) == 5:
            convert(*sys.argv[1:])
            print(json.dumps({"ok": True}))
        else:
            raise WordError("invalid-options")
    except Exception as error:
        print(json.dumps({"ok": False, "code": str(error) if isinstance(error, WordError) else "render-failed"}))
        sys.exit(1)
