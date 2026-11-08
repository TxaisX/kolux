; T-574, T-578: the installer no longer installs the coding agents. People pick the ones they want when Kolux
; opens (first-run wizard and Settings > Agents), and Kolux installs just those, several at once.
; T-594 (CLI-007): a new terminal finds kolux. The installer puts the install's bin folder (kolux.exe and
; kolux.cmd, DT-R27) on the user's PATH when it is missing, and the uninstaller takes exactly that entry off
; again. The rules are cli_register.rs's (CLI-008): the variable keeps its name and is written as
; REG_EXPAND_SZ (a PATH stored as REG_SZ comes back as REG_EXPAND_SZ, which Windows reads the same way),
; the change is read back before it is reported, and no other entry is ever touched.
; T-594, a PATH over the NSIS limit: NSIS strings hold 1024 characters, so the installer cannot read or write
; a longer PATH (real ones are often longer; Txais's is 1,815). It leaves that PATH exactly as it is and drops
; a hand-off file, ${KOLUX_PATH_PENDING}, in the install folder instead; Kolux adds the bin folder when it next
; starts and deletes the file first, so this happens once per install (cli_register.rs path_at_start). On
; uninstall the app itself runs first (<app>.exe --uninstall-path, cli_register.rs path_at_uninstall), which
; takes off exactly our entry at any length; the NSIS removal below then finds nothing of ours, and only does
; the work when the app could not run.
; ponytail: the long-PATH work is done by the app's own Rust code, not NSIS; upgrade, if the app could ever
; be missing at uninstall: the same steps through the System plugin into a buffer of the value's own size.
!include LogicLib.nsh
!include WinMessages.nsh

; The longest string NSIS holds, its terminating zero left out.
!define /math KOLUX_STRLEN_MAX ${NSIS_MAX_STRLEN} - 1
; T-594: the hand-off file's name (cli_register.rs PATH_PENDING).
!define KOLUX_PATH_PENDING "kolux-path-pending.txt"

; $R9: the name the PATH variable goes by in HKCU\Environment (Path, PATH, ...), or "" when there is none.
; The walk ends only on the error flag, which EnumRegValue sets past the last value: a value with an empty
; name (the key's unnamed default) is skipped, never taken for the end, so it cannot hide Path and make the
; installer write a new Path that holds only $INSTDIR\bin. If the walk still finds nothing, Path is read by
; name; a value that answers is used. Only a full walk with no Path and a read that fails counts as none.
!macro KOLUX_PATH_NAME
  StrCpy $R9 ""
  StrCpy $R8 0
  ${Do}
    ClearErrors
    EnumRegValue $R7 HKCU "Environment" $R8
    ${If} ${Errors}
      ${ExitDo}
    ${EndIf}
    ${If} $R7 == "Path"
      StrCpy $R9 $R7
      ${ExitDo}
    ${EndIf}
    IntOp $R8 $R8 + 1
  ${Loop}
  ${If} $R9 == ""
    ClearErrors
    ReadRegStr $R7 HKCU "Environment" "Path"
    ${IfNot} ${Errors}
      StrCpy $R9 "Path"
    ${EndIf}
  ${EndIf}
  ClearErrors
!macroend

; $R2: the PATH text in $R8 without its entries that are $INSTDIR\bin (any case, with or without a trailing
; \); $R6: how many there were. Every other entry, empty ones too, stays as it was and where it was.
!macro KOLUX_PATH_CUT
  StrCpy $R2 ""
  StrCpy $R3 ""
  StrCpy $R4 0
  StrCpy $R6 0
  StrCpy $R7 0
  ${Do}
    StrCpy $R5 $R8 1 $R4
    ${If} $R5 == ";"
    ${OrIf} $R5 == ""
      ${If} $R3 == "$INSTDIR\bin"
      ${OrIf} $R3 == "$INSTDIR\bin\"
        IntOp $R6 $R6 + 1
      ${ElseIf} $R7 = 0
        StrCpy $R2 $R3
        StrCpy $R7 1
      ${Else}
        StrCpy $R2 "$R2;$R3"
      ${EndIf}
      StrCpy $R3 ""
      ${If} $R5 == ""
        ${ExitDo}
      ${EndIf}
    ${Else}
      StrCpy $R3 "$R3$R5"
    ${EndIf}
    IntOp $R4 $R4 + 1
  ${Loop}
!macroend

!macro KOLUX_SAVE
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
!macroend

!macro KOLUX_RESTORE
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; T-594: the PATH is too long for NSIS. It is left exactly as it is, and the hand-off file asks Kolux to add
; the bin folder on its next start (once; Kolux deletes the file before it changes anything). Uses $R5 only.
!macro KOLUX_PATH_HANDOFF
  ClearErrors
  FileOpen $R5 "$INSTDIR\${KOLUX_PATH_PENDING}" w
  ${If} ${Errors}
    DetailPrint "Your PATH was left as it is: it is too long for the installer to change. Settings > CLI > Register adds kolux."
  ${Else}
    FileWrite $R5 "Kolux adds $INSTDIR\bin to your PATH when it next starts, then deletes this file.$\r$\n"
    FileClose $R5
    DetailPrint "Your PATH is too long for the installer to change; Kolux adds $INSTDIR\bin to it when it opens"
  ${EndIf}
!macroend

!macro KOLUX_PATH_ADD
  !insertmacro KOLUX_SAVE
  ${If} ${FileExists} "$INSTDIR\bin\kolux.exe"
    !insertmacro KOLUX_PATH_NAME
    StrCpy $R0 ""
    ClearErrors
    ${If} $R9 == ""
      StrCpy $R9 "Path"
    ${Else}
      ReadRegStr $R0 HKCU "Environment" $R9
    ${EndIf}
    ${If} ${Errors}
      !insertmacro KOLUX_PATH_HANDOFF
    ${Else}
      ; ponytail: only the plain spelling counts as there, so an entry the user wrote with %VARIABLES% gets
      ; a second, plain one beside it (harmless); upgrade: compare through ExpandEnvironmentStrings.
      StrCpy $R8 $R0
      !insertmacro KOLUX_PATH_CUT
      ${If} $R6 > 0
        DetailPrint "$INSTDIR\bin is already on your PATH"
      ${Else}
        ; Trailing separators go first, as cli_register's path_with does.
        StrCpy $R1 $R0
        ${Do}
          StrCpy $R5 $R1 1 -1
          ${If} $R5 != ";"
            ${ExitDo}
          ${EndIf}
          StrCpy $R1 $R1 -1
        ${Loop}
        StrLen $R3 $R1
        StrLen $R4 "$INSTDIR\bin"
        IntOp $R3 $R3 + $R4
        ${If} $R3 >= ${KOLUX_STRLEN_MAX}
          !insertmacro KOLUX_PATH_HANDOFF
        ${Else}
          ${If} $R1 == ""
            StrCpy $R1 "$INSTDIR\bin"
          ${Else}
            StrCpy $R1 "$R1;$INSTDIR\bin"
          ${EndIf}
          ClearErrors
          WriteRegExpandStr HKCU "Environment" $R9 $R1
          ${If} ${Errors}
            DetailPrint "Windows refused the change to your PATH. Settings > CLI > Register adds kolux."
          ${Else}
            ClearErrors
            ReadRegStr $R8 HKCU "Environment" $R9
            ${If} ${Errors}
              DetailPrint "The change to your PATH could not be checked afterwards"
            ${Else}
              !insertmacro KOLUX_PATH_CUT
              ${If} $R6 > 0
                DetailPrint "Added $INSTDIR\bin to your PATH: new terminals find kolux"
              ${Else}
                DetailPrint "$INSTDIR\bin is still not on your PATH after the change; something else holds that setting"
              ${EndIf}
            ${EndIf}
            SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=2000
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !insertmacro KOLUX_RESTORE
!macroend

!macro KOLUX_PATH_REMOVE
  !insertmacro KOLUX_SAVE
  !insertmacro KOLUX_PATH_NAME
  ${If} $R9 != ""
    ClearErrors
    ReadRegStr $R8 HKCU "Environment" $R9
    ${If} ${Errors}
      ; Over the NSIS limit: the app's own step (KOLUX_PATH_APP_REMOVE) has already done this when it could run.
      DetailPrint "Your PATH is too long for the uninstaller to read; if $INSTDIR\bin is still on it, remove it in Windows settings."
    ${Else}
      !insertmacro KOLUX_PATH_CUT
      ${If} $R6 > 0
        ClearErrors
        WriteRegExpandStr HKCU "Environment" $R9 $R2
        ${If} ${Errors}
          DetailPrint "Windows refused the change to your PATH; $INSTDIR\bin is still on it"
        ${Else}
          ClearErrors
          ReadRegStr $R8 HKCU "Environment" $R9
          ${If} ${Errors}
            DetailPrint "The change to your PATH could not be checked afterwards"
          ${Else}
            !insertmacro KOLUX_PATH_CUT
            ${If} $R6 > 0
              DetailPrint "$INSTDIR\bin is still on your PATH after the change"
            ${Else}
              DetailPrint "Took $INSTDIR\bin off your PATH"
            ${EndIf}
          ${EndIf}
          SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=2000
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !insertmacro KOLUX_RESTORE
!macroend

; T-594: before the files go, the app takes its bin folder off the user PATH itself, at any length (the
; uninstall was already confirmed: Tauri inserts this at the start of the uninstall section). Exit 0: taken
; off; 2: nothing of ours there; anything else: not done (the NSIS step after the files go tries for a short
; PATH). The hand-off file is deleted too, so the install folder can go.
!macro KOLUX_PATH_APP_REMOVE
  ; The template's running-app check first (it runs it again after this hook): a user who cancels at its
  ; prompt aborts the uninstall here, before the PATH entry is touched. It uses $R0-$R3, as the template's
  ; own call does.
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  Push $R0
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ClearErrors
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-path' $R0
    ${If} ${Errors}
      DetailPrint "Kolux could not be run to check your PATH"
    ${ElseIf} $R0 = 0
      DetailPrint "Took $INSTDIR\bin off your PATH"
    ${ElseIf} $R0 = 2
      DetailPrint "$INSTDIR\bin was not on your PATH"
    ${Else}
      DetailPrint "Kolux could not take $INSTDIR\bin off your PATH"
    ${EndIf}
  ${EndIf}
  Delete "$INSTDIR\${KOLUX_PATH_PENDING}"
  Pop $R0
!macroend

; T-786 (P3-15, DT-C220): Windows 11 is the tested target, so an install on a Windows 10 build (below 22000)
; first shows a notice saying so. It is a plain OK box that answers itself in a silent install, and an update
; (/UPDATE on the command line) skips it, so nobody sees it twice. BUILD is the registry's CurrentBuildNumber.
; $R9 is set to 1 when the notice is due: a non-empty build number below 22000.
!macro KOLUX_WIN10_DUE BUILD
  StrCpy $R9 0
  ${If} "${BUILD}" != ""
    ${If} "${BUILD}" < 22000
      StrCpy $R9 1
    ${EndIf}
  ${EndIf}
!macroend

; $R9 is set to 1 when the command line holds /UPDATE (the updater's relaunch), else 0.
!macro KOLUX_IS_UPDATE
  StrCpy $R9 0
  StrLen $R8 $CMDLINE
  StrCpy $R7 0
  ${While} $R7 < $R8
    StrCpy $R6 $CMDLINE 7 $R7
    ${If} $R6 == "/UPDATE"
      StrCpy $R9 1
      ${Break}
    ${EndIf}
    IntOp $R7 $R7 + 1
  ${EndWhile}
!macroend

!macro KOLUX_WIN10_NOTICE
  Push $R9
  Push $R8
  Push $R7
  Push $R6
  !insertmacro KOLUX_IS_UPDATE
  ${If} $R9 = 0
    ReadRegStr $R6 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
    !insertmacro KOLUX_WIN10_DUE "$R6"
    ${If} $R9 = 1
      MessageBox MB_OK|MB_ICONINFORMATION "Kolux is tested on Windows 11. This PC runs Windows 10 (build $R6), which is not verified yet: resizing a terminal pane may cut up long lines.$\r$\n$\r$\nKolux will still install. Keep your work in Git and report what breaks." /SD IDOK
    ${EndIf}
  ${EndIf}
  Pop $R6
  Pop $R7
  Pop $R8
  Pop $R9
!macroend

; T-790 (DT-C212): the product is "Kolux", no longer "Kolux RS". An install of the old name sits in its own
; folder under its own Uninstall entry ("<product> RS"), so without this step the new one would land beside it
; and both would show in Settings > Apps. Before the files go in, the old install is retired: its own
; uninstaller runs in place (/P, or /S in a silent install; never the delete-my-data box, which stays off), then
; its leftovers and its Uninstall entry go. Nothing here touches the profile: the old profile folder
; (%APPDATA%\com.txaisxiong.kolux-rs) is never deleted, and the app copies it into the new one when it first
; starts (profile_move.rs). The old uninstaller takes its own bin folder off the PATH; $KoluxOldHadPath says
; it was there (or could not be read, a PATH over the NSIS limit), so POSTINSTALL puts the new bin folder back
; even in an update, which otherwise leaves the PATH as the user has it (T-789).
!define KOLUX_OLD_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME} RS"
Var KoluxOldDir
Var KoluxOldHadPath

; $KoluxOldDir: the folder the old install lives in, or "" when there is no old entry (or it names no folder).
!macro KOLUX_OLD_DIR
  StrCpy $KoluxOldDir ""
  ClearErrors
  ReadRegStr $R1 HKCU "${KOLUX_OLD_UNINST}" "InstallLocation"
  ${If} $R1 == ""
    ReadRegStr $R0 HKCU "${KOLUX_OLD_UNINST}" "UninstallString"
    StrCpy $R2 $R0 1
    ${If} $R2 == '"'
      StrCpy $R0 $R0 "" 1
      StrCpy $R3 0
      ${Do}
        StrCpy $R2 $R0 1 $R3
        ${If} $R2 == '"'
        ${OrIf} $R2 == ""
          ${ExitDo}
        ${EndIf}
        IntOp $R3 $R3 + 1
      ${Loop}
      StrCpy $R0 $R0 $R3
    ${EndIf}
    StrLen $R3 $R0
    IntOp $R3 $R3 - 14
    ${If} $R3 > 0
      StrCpy $R2 $R0 "" $R3
      ${If} $R2 == "\uninstall.exe"
        StrCpy $R1 $R0 $R3
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ; A value written with quotes around the folder loses them.
  StrCpy $R2 $R1 1
  ${If} $R2 == '"'
    StrCpy $R1 $R1 "" 1
  ${EndIf}
  StrCpy $R2 $R1 1 -1
  ${If} $R2 == '"'
    StrCpy $R1 $R1 -1
  ${EndIf}
  StrCpy $R2 $R1 1 -1
  ${If} $R2 == "\"
    StrCpy $R1 $R1 -1
  ${EndIf}
  StrCpy $KoluxOldDir $R1
!macroend

!macro KOLUX_RETIRE_OLD
  !insertmacro KOLUX_SAVE
  StrCpy $KoluxOldHadPath 0
  !insertmacro KOLUX_OLD_DIR
  ClearErrors
  ReadRegStr $R0 HKCU "${KOLUX_OLD_UNINST}" "DisplayName"
  ${If} ${Errors}
  ${AndIf} $KoluxOldDir == ""
    ; No old install: nothing to do.
  ${Else}
    DetailPrint "Found an earlier install under the old name (${PRODUCTNAME} RS)"
    ; Was the old bin folder on the PATH? A PATH too long to read counts as yes.
    ${If} $KoluxOldDir != ""
    ${AndIf} $KoluxOldDir != "$INSTDIR"
      StrCpy $R0 $INSTDIR
      StrCpy $INSTDIR $KoluxOldDir
      !insertmacro KOLUX_PATH_NAME
      ${If} $R9 != ""
        ClearErrors
        ReadRegStr $R8 HKCU "Environment" $R9
        ${If} ${Errors}
          StrCpy $KoluxOldHadPath 1
        ${Else}
          !insertmacro KOLUX_PATH_CUT
          ${If} $R6 > 0
            StrCpy $KoluxOldHadPath 1
          ${EndIf}
        ${EndIf}
      ${EndIf}
      StrCpy $INSTDIR $R0
      ; Retire it: its own uninstaller, run in place, then what it leaves.
      ${If} ${FileExists} "$KoluxOldDir\uninstall.exe"
        ${If} ${Silent}
          StrCpy $R2 "/S"
        ${Else}
          StrCpy $R2 "/P"
        ${EndIf}
        ClearErrors
        ExecWait '"$KoluxOldDir\uninstall.exe" $R2 _?=$KoluxOldDir' $R3
        ${If} ${Errors}
          StrCpy $R3 "not run"
        ${EndIf}
        ${If} $R3 != 0
          ; T-790 review: the old copy is still installed (its uninstaller could not run, the old app could not
          ; be stopped, or it was cancelled). Keep its uninstaller and its Settings > Apps entry, and stop here,
          ; so there are never two copies with no way to remove one. Nothing has been changed yet.
          DetailPrint "The old uninstaller did not finish (exit code $R3); the install stops and changes nothing"
          MessageBox MB_OK|MB_ICONSTOP "${PRODUCTNAME} could not remove the earlier ${PRODUCTNAME} RS install (is it still running?). Close it and run this installer again. Nothing was changed." /SD IDOK
          !insertmacro KOLUX_RESTORE
          Abort
        ${EndIf}
        DetailPrint "The old uninstaller finished"
        Delete "$KoluxOldDir\uninstall.exe"
      ${EndIf}
      ; Only an empty folder goes; anything the user kept in it stays.
      RMDir "$KoluxOldDir\bin"
      RMDir "$KoluxOldDir"
    ${EndIf}
    DeleteRegKey HKCU "${KOLUX_OLD_UNINST}"
    DetailPrint "The old ${PRODUCTNAME} RS entry is gone from Settings > Apps; your profile is kept"
  ${EndIf}
  !insertmacro KOLUX_RESTORE
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KOLUX_WIN10_NOTICE
  !insertmacro KOLUX_RETIRE_OLD
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KOLUX_PATH_APP_REMOVE
!macroend

; T-789 (P3-07): an update (/UPDATE) leaves the PATH as the user has it. Someone who pressed Remove kolux in
; Settings would otherwise find the command back after the next update; a first install still adds it.
!macro KOLUX_PATH_ADD_UNLESS_UPDATE
  Push $R5
  Push $R9
  Push $R8
  Push $R7
  Push $R6
  !insertmacro KOLUX_IS_UPDATE
  StrCpy $R5 $R9
  Pop $R6
  Pop $R7
  Pop $R8
  Pop $R9
  ${If} $R5 = 0
    !insertmacro KOLUX_PATH_ADD
  ${Else}
    DetailPrint "Update: leaving the kolux command on the PATH as it is"
  ${EndIf}
  Pop $R5
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Pick your coding agents when Kolux opens"
  ${If} $KoluxOldHadPath = 1
    ; T-790: the old install had kolux on the PATH and its uninstaller took it off: put the new one back.
    !insertmacro KOLUX_PATH_ADD
  ${Else}
    !insertmacro KOLUX_PATH_ADD_UNLESS_UPDATE
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro KOLUX_PATH_REMOVE
!macroend
