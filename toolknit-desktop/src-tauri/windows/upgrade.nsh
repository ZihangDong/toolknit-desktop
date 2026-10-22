; Upgrade state must survive page callbacks and plugin register usage.
Var PreviousVersionComparison
Var PreviousInstallDir
Var PreviousMainBinary
Var PreviousUninstaller
Var PreviousUninstallCommand
Var PreviousUninstallStatus
Var PreviousUninstallExitCode
Var ToolKnitFileToCheck
Var ToolKnitFileError

Function PreparePreviousUninstaller
  StrCpy $PreviousUninstallStatus ""
  StrCpy $PreviousUninstallExitCode 0
  StrCpy $PreviousUninstaller ""
  StrCpy $PreviousInstallDir ""
  ReadRegStr $PreviousMainBinary SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${GetFileName} "$PreviousMainBinary" $0
  ${If} $PreviousMainBinary == ""
  ${OrIf} $0 != $PreviousMainBinary
    StrCpy $PreviousMainBinary "${MAINBINARYNAME}.exe"
  ${EndIf}
  ReadRegStr $PreviousUninstallCommand SHCTX "${UNINSTKEY}" "UninstallString"
  StrCpy $0 $PreviousUninstallCommand 1
  ${If} $0 == '$\"'
    StrCpy $1 1
    parse_quoted_uninstaller:
      StrCpy $0 $PreviousUninstallCommand 1 $1
      ${If} $0 == ""
        Goto previous_invalid_path
      ${EndIf}
      ${If} $0 == '$\"'
        IntOp $1 $1 - 1
        StrCpy $PreviousUninstaller $PreviousUninstallCommand $1 1
      ${Else}
        IntOp $1 $1 + 1
        Goto parse_quoted_uninstaller
      ${EndIf}
  ${ElseIf} $PreviousUninstallCommand != ""
    ; Older registry entries can omit quotes around a path containing spaces.
    ${StrCase} $0 $PreviousUninstallCommand "L"
    ${StrLoc} $1 $0 "\uninstall.exe" ">"
    ${If} $1 == ""
      Goto previous_invalid_path
    ${EndIf}
    IntOp $1 $1 + 14
    StrCpy $0 $PreviousUninstallCommand 1 $1
    ${If} $0 != ""
    ${AndIf} $0 != " "
      Goto previous_invalid_path
    ${EndIf}
    StrCpy $PreviousUninstaller $PreviousUninstallCommand $1
  ${Else}
    ReadRegStr $0 SHCTX "${UNINSTKEY}" "InstallLocation"
    ${If} $0 == ""
      ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
    ${EndIf}
    ${If} $0 == ""
      StrCpy $PreviousUninstallStatus "metadata-missing"
      Return
    ${EndIf}
    StrCpy $1 $0 1
    StrCpy $2 $0 1 -1
    ${If} $1 == '$\"'
    ${AndIf} $2 == '$\"'
      StrLen $1 $0
      IntOp $1 $1 - 2
      StrCpy $0 $0 $1 1
    ${EndIf}
    StrCpy $PreviousUninstaller "$0\uninstall.exe"
  ${EndIf}

  ${GetFileName} "$PreviousUninstaller" $0
  ${GetRoot} "$PreviousUninstaller" $1
  ${GetParent} "$PreviousUninstaller" $PreviousInstallDir
  ${If} $0 != "uninstall.exe"
  ${OrIf} $1 == ""
  ${OrIf} $PreviousInstallDir == ""
  ${OrIf} $PreviousInstallDir == $1
    Goto previous_invalid_path
  ${EndIf}
  StrCpy $0 $PreviousUninstaller 2
  StrCpy $1 $PreviousUninstaller 2 1
  ${If} $0 != "\\"
  ${AndIf} $1 != ":\"
    Goto previous_invalid_path
  ${EndIf}
  ${IfNot} ${FileExists} "$PreviousUninstaller"
    StrCpy $PreviousUninstallStatus "uninstaller-missing"
    Return
  ${EndIf}

  StrCpy $PreviousUninstallCommand '$\"$PreviousUninstaller$\"'
  !if "${INSTALLMODE}" == "both"
    StrCpy $PreviousUninstallCommand "$PreviousUninstallCommand /$MultiUser.InstallMode"
  !endif
  ${If} $PreviousVersionComparison != 0
    ; An upgrade must not offer to erase user data or remove startup preferences.
    StrCpy $PreviousUninstallCommand "$PreviousUninstallCommand /UPDATE"
  ${EndIf}
  ${If} $PassiveMode = 1
    StrCpy $PreviousUninstallCommand "$PreviousUninstallCommand /P"
  ${EndIf}
  ${If} ${Silent}
    StrCpy $PreviousUninstallCommand "$PreviousUninstallCommand /S"
  ${EndIf}
  ; NSIS requires this unquoted directory argument last, including spaces.
  StrCpy $PreviousUninstallCommand "$PreviousUninstallCommand _?=$PreviousInstallDir"
  ClearErrors
  Return
  previous_invalid_path:
    StrCpy $PreviousUninstallStatus "invalid-uninstall-path"
FunctionEnd

Function RefreshUpgradeAutostart
  ${If} $PreviousInstallDir == ""
  ${OrIf} $WixMode = 1
    Return
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${TOOLKNIT_AUTOSTART_VALUE_NAME}"
  ${If} $0 == '$\"$PreviousInstallDir\$PreviousMainBinary$\" --autostart'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${TOOLKNIT_AUTOSTART_VALUE_NAME}" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --autostart'
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${If} $0 == '$\"$PreviousInstallDir\$PreviousMainBinary$\" --autostart'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --autostart'
  ${EndIf}
FunctionEnd

Function InvokePreviousUninstaller
  StrCpy $PreviousUninstallStatus ""
  StrCpy $PreviousUninstallExitCode -1
  ; Registry probes and earlier checks may leave the error flag set.
  ClearErrors
  ExecWait '$PreviousUninstallCommand' $PreviousUninstallExitCode
  ${If} ${Errors}
    StrCpy $PreviousUninstallStatus "launch-failed"
    Return
  ${EndIf}
  ${If} $WixMode = 1
    ${If} $PreviousUninstallExitCode = 1602
      StrCpy $PreviousUninstallStatus "cancelled"
      Return
    ${EndIf}
    ${If} $PreviousUninstallExitCode = 3010
    ${OrIf} $PreviousUninstallExitCode = 1641
      ; Replacing a file pending deletion on reboot could remove the NEW app.
      StrCpy $PreviousUninstallStatus "reboot-required"
      Return
    ${EndIf}
  ${ElseIf} $PreviousUninstallExitCode = 1
    StrCpy $PreviousUninstallStatus "cancelled"
    Return
  ${EndIf}
  ${If} $PreviousUninstallExitCode != 0
    StrCpy $PreviousUninstallStatus "exit-code"
    Return
  ${EndIf}
  ${If} $WixMode != 1
    StrCpy $0 20
    previous_wait_removed:
      ${If} ${FileExists} "$PreviousInstallDir\$PreviousMainBinary"
        IntOp $0 $0 - 1
        ${If} $0 > 0
          Sleep 100
          Goto previous_wait_removed
        ${EndIf}
        StrCpy $PreviousUninstallStatus "files-remain"
      ${EndIf}
  ${EndIf}
FunctionEnd

; Probe DELETE access without deleting anything. A stopped process or scanner
; may still hold the image briefly; do not remove metadata while it is locked.
!macro ToolKnitFileReleaseFunction Prefix
Function ${Prefix}ToolKnitWaitForFileRelease
  Push $0
  Push $1
  StrCpy $ToolKnitFileError 0
  StrCpy $0 40
  file_release_retry:
    IfFileExists "$ToolKnitFileToCheck" 0 file_release_missing
    System::Call 'kernel32::CreateFileW(w "$ToolKnitFileToCheck", i 0x10000, i 7, p 0, i 3, i 0x80, p 0) p .r1 ?e'
    Pop $ToolKnitFileError
    ${If} $1 P<> -1
      System::Call 'kernel32::CloseHandle(p r1)'
      StrCpy $ToolKnitFileError 0
      Goto file_release_done
    ${EndIf}
    StrCpy $1 $ToolKnitFileError
    ${If} $1 = 2
    ${OrIf} $1 = 3
      StrCpy $ToolKnitFileError 0
      Goto file_release_done
    ${EndIf}
    ${If} $1 = 32
    ${OrIf} $1 = 33
    ${OrIf} $1 = 5
      IntOp $0 $0 - 1
      ${If} $0 > 0
        Sleep 250
        Goto file_release_retry
      ${EndIf}
    ${EndIf}
    Goto file_release_done
  file_release_missing:
    StrCpy $ToolKnitFileError 0
  file_release_done:
  Pop $1
  Pop $0
FunctionEnd
!macroend
!insertmacro ToolKnitFileReleaseFunction ""
!insertmacro ToolKnitFileReleaseFunction "un."
