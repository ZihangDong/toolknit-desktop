!define TOOLKNIT_WINDOWS_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_POSTINSTALL
  Call RefreshUpgradeAutostart
  ; Write the selected NSIS language ID to install_lang.txt in the install directory
  FileOpen $0 "$INSTDIR\install_lang.txt" w
  FileWrite $0 "$LANGUAGE"
  FileClose $0
!macroend

!macro TOOLKNIT_SEARCH_PREUNINSTALL
  ; Upgrades keep the demand service. A full uninstall removes only the
  ; generated services owned by this installation before deleting its helper.
  ${If} $UpdateMode != 1
    ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      file_search_cleanup_retry:
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --file-search-cleanup' $0
      ${If} $0 != 0
        MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "$(fileSearchCleanupFailed)" /SD IDCANCEL IDRETRY file_search_cleanup_retry
        SetErrorLevel 1603
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Clean up the language file on uninstall
  Delete "$INSTDIR\install_lang.txt"
!macroend
