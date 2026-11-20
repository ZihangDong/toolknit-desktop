"""Stage and verify the pinned Windows runtime carried by the desktop installer."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import kernel

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
DESTINATION = PROJECT / 'src-tauri/resources/office-kernel'
PIN = ROOT / 'runtime.lock.json'
CRITICAL = ['soffice.com', 'soffice.exe', 'soffice.bin', 'python.exe', 'swlo.dll',
            'sw_writerfilterlo.dll', 'mswordlo.dll', 'vcllo.dll', 'editenglo.dll']
MSVC = ['concrt140.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
        'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'vccorlib140.dll',
        'vcruntime140.dll', 'vcruntime140_1.dll', 'vcruntime140_threads.dll']


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(destination=DESTINATION):
    pin = json.loads(PIN.read_text(encoding='utf-8'))
    manifest_file = destination / 'manifest.json'
    if sha(manifest_file) != pin['manifestSha256']:
        raise ValueError('Bundled runtime manifest does not match the pin')
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    for name, entry in manifest['files'].items():
        file = destination / name
        if not file.resolve().is_relative_to(destination.resolve()) or file.is_symlink():
            raise ValueError('Unsafe runtime file: ' + name)
        if file.stat().st_size != entry['bytes'] or sha(file) != entry['sha256']:
            raise ValueError('Bundled runtime file differs: ' + name)
    actual = {p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file()}
    if actual != set(manifest['files']) | {'manifest.json'}:
        raise ValueError('Unexpected or missing bundled runtime files')
    return {'kernelId': manifest['kernelId'], 'files': len(manifest['files']),
            'bytes': sum(v['bytes'] for v in manifest['files'].values()),
            'manifestSha256': pin['manifestSha256'], 'verified': True}


def stage(work, msvc):
    lock = kernel.load_lock()
    state = kernel.status(work, lock)
    if not state['runtimeBuilt'] or not state['nativeImportCppunitPassed']:
        raise ValueError('Complete matching build and native test receipts are required')
    if DESTINATION.exists():
        raise ValueError('Runtime already staged; verify it or move it aside before replacing')
    source = work / 'build/instdir'
    files = [p for p in source.rglob('*') if p.is_file() and not (
        set(p.relative_to(source).parts) & {'sdk', 'help', '__pycache__', 'user'})
        and p.suffix not in {'.pyc', '.pdb'} and p.name != '.lock']
    for file in files:
        if file.is_symlink():
            raise ValueError('Source runtime contains a symbolic link: ' + str(file))
    for name in MSVC:
        if not (msvc / name).is_file():
            raise ValueError('Missing app-local MSVC library: ' + name)
    fixtures = json.loads((work / 'cjk7-delivery-fixtures/report.json').read_text(encoding='utf-8'))
    if not fixtures['passed'] or fixtures['engine']['writerModuleSha256'] != sha(source / 'program/swlo.dll'):
        raise ValueError('PDF regression result does not match the runtime binary')
    DESTINATION.mkdir(parents=True)
    for file in files:
        target = DESTINATION / 'runtime' / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
    for name in MSVC:
        shutil.copy2(msvc / name, DESTINATION / 'runtime/program' / name)
    bootstrap = DESTINATION / 'runtime/program/bootstrap.ini'
    text = bootstrap.read_text(encoding='utf-8').replace(
        'UserInstallation=$ORIGIN/..',
        'UserInstallation=$SYSUSERCONFIG/ToolKnit/office-kernel-profile')
    bootstrap.write_text(text, encoding='utf-8', newline='\n')
    sources = DESTINATION / 'source'
    sources.mkdir()
    shutil.copy2(ROOT / 'kernel.lock.json', sources / 'kernel.lock.json')
    for item in lock['patches']:
        target = sources / item['file']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / item['file'], target)
    (sources / 'SOURCE.md').write_text(
        '# ToolKnit LibreOffice source\n\n'
        f"Upstream: {lock['upstream']['repository']}\n\n"
        f"Tag: {lock['upstream']['tag']}\n\nCommit: {lock['upstream']['commit']}\n\n"
        'Apply the included patches in kernel.lock.json order to that upstream source. '
        'Modified LibreOffice code retains MPL-2.0 and the notices in each patch. '
        'The complete upstream licenses and third-party notices accompany runtime/LICENSE.html, '
        'runtime/license.txt and runtime/NOTICE. The bootstrap profile path is made user-writable.\n',
        encoding='utf-8')
    manifest = {'schemaVersion': 1, 'kernelId': lock['kernelId'], 'platform': 'windows-x64',
                'commit': lock['upstream']['commit'], 'patches': lock['patches'],
                'sourceChangesSha256': state['sourceChangesSha256'],
                'visualFidelityApproved': False, 'nativeTestsPassed': True,
                'genericPdfRegressionPassed': True, 'files': {}}
    for file in sorted(DESTINATION.rglob('*')):
        if file.is_file():
            manifest['files'][file.relative_to(DESTINATION).as_posix()] = {
                'bytes': file.stat().st_size, 'sha256': sha(file)}
    manifest_file = DESTINATION / 'manifest.json'
    manifest_file.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    pin = {'schemaVersion': 1, 'kernelId': lock['kernelId'],
           'manifestSha256': sha(manifest_file), 'criticalFiles': {
               'runtime/program/' + name: manifest['files']['runtime/program/' + name]['sha256']
               for name in CRITICAL + MSVC}}
    PIN.write_text(json.dumps(pin, indent=2) + '\n', encoding='utf-8')
    return verify()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--work-root', type=Path)
    parser.add_argument('--msvc-runtime', type=Path)
    args = parser.parse_args()
    if args.verify:
        result = verify()
    else:
        if not args.work_root or not args.msvc_runtime:
            parser.error('Staging requires --work-root and --msvc-runtime')
        result = stage(args.work_root.resolve(), args.msvc_runtime.resolve())
    print(json.dumps(result, indent=2))
