import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src-tauri/windows/installer.nsi', import.meta.url), 'utf8');
const upgrade = await readFile(new URL('../src-tauri/windows/upgrade.nsh', import.meta.url), 'utf8');
const autostart = await readFile(new URL('../src-tauri/src/native_runtime/core/autostart.rs', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('Section WebView2'), source.indexOf('Section Install'));
assert.ok(!section.includes('$UpdateMode'), 'runtime repair must also execute during updates');
assert.equal((section.match(/Call DetectWebView2/g) || []).length, 2, 'detect before installation and after successful execution');
assert.match(section, /ClearErrors\s+StrCpy \$1 -1\s+ExecWait/);
assert.match(section, /\$1 = 3010\s+SetRebootFlag true/);
assert.match(section, /runtime-not-detected/);
assert.match(section, /MB_RETRYCANCEL[\s\S]*\/SD IDCANCEL/);
assert.ok(!section.includes('IDIGNORE'), 'missing dependencies must not be ignored');
assert.match(source, /Function RunMainBinary\s+\$\{If\} \$\{RebootFlag\}\s+Return/);
assert.match(source, /Function \.onInstSuccess\s+\$\{If\} \$\{RebootFlag\}\s+SetErrorLevel 3010/);
assert.match(source, /Function RestorePreviousInstallLocation\s+\$\{If\} \$RequestedInstallDir != ""/);
const startupName = autostart.match(/const VALUE_NAME: &str = "([^"]+)"/)[1];
assert.ok(source.includes(`!define TOOLKNIT_AUTOSTART_VALUE_NAME "${startupName}"`));
assert.match(source, /\$0 == '\$\\"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe\$\\" --autostart'\s+DeleteRegValue/);
for (const label of ['webview2Recovery', 'webview2Manual', 'webview2Reboot', 'upgradeUninstallFailed', 'upgradeUninstallReboot', 'appFileReleaseFailed']) {
  for (const language of ['ENGLISH', 'SIMPCHINESE']) {
    assert.ok(source.includes(`LangString ${label} \${LANG_${language}}`));
  }
}
const reinstall = source.slice(source.indexOf('Function PageLeaveReinstall'), source.indexOf('FunctionEnd', source.indexOf('Function PageLeaveReinstall')));
assert.ok(!reinstall.includes('${FileExists} "$INSTDIR'), 'uninstall result must not inspect the new destination');
assert.match(upgrade, /\$\{FileExists\} "\$PreviousInstallDir\\\$PreviousMainBinary"/);
assert.match(upgrade, /ClearErrors\s+ExecWait '\$PreviousUninstallCommand' \$PreviousUninstallExitCode\s+\$\{If\} \$\{Errors\}/, 'capture launch failure before UI calls');
assert.match(upgrade, /\/\$MultiUser\.InstallMode/);
assert.match(upgrade, /\$PreviousVersionComparison != 0[\s\S]*\/UPDATE/);
assert.match(upgrade, /_\?=\$PreviousInstallDir/);
assert.match(reinstall, /\$PassiveMode = 1\s+StrCpy \$R1 1/, 'passive setup must not read a nonexistent radio control');
assert.match(reinstall, /"reboot-required"[\s\S]*SetErrorLevel 3010\s+Quit/, 'do not overwrite files pending deletion on reboot');
assert.ok(source.indexOf('!include "${TOOLKNIT_WINDOWS_DIR}\\upgrade.nsh"') < source.indexOf('Function PageReinstall'));
const uninstall = source.slice(source.indexOf('Section Uninstall'), source.indexOf('Function RestorePreviousInstallLocation'));
assert.ok(uninstall.indexOf('Call un.ToolKnitWaitForFileRelease') < uninstall.indexOf('NSIS_HOOK_PREUNINSTALL'));
assert.ok(uninstall.indexOf('SetErrorLevel 1603') < uninstall.indexOf('DeleteRegKey SHCTX "${UNINSTKEY}"'), 'file failure must stop before registration cleanup');
assert.match(upgrade, /CreateFileW[^\n]+\?e'\s+Pop \$ToolKnitFileError/, 'capture Windows error before another API can overwrite it');
console.log('Windows installer upgrade, dependency, reboot, path and startup ownership contracts passed.');
