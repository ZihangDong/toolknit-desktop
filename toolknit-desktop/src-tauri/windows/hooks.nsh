!define TOOLKNIT_WINDOWS_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_POSTINSTALL
  Call RefreshUpgradeAutostart
  ; Write the selected NSIS language ID to install_lang.txt in the install directory
  FileOpen $0 "$INSTDIR\install_lang.txt" w
  FileWrite $0 "$LANGUAGE"
  FileClose $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Clean up the language file on uninstall
  Delete "$INSTDIR\install_lang.txt"
!macroend
