; T-786: compiles src-tauri/installer-hooks.nsh's Windows 10 notice macros (the real file, included
; as is) and runs the two decisions on mocked inputs. Build: makensis /DHOOKS=<full path to installer-hooks.nsh> installer-notice-harness.nsi
; Run: T-786-harness.exe /S  -> writes t786-result.txt next to the exe.
Name "t786"
OutFile "t786-harness.exe"
SilentInstall silent
RequestExecutionLevel user
!include LogicLib.nsh
!include "${HOOKS}"

Var Out
!macro CASE_BUILD B EXPECT
  !insertmacro KOLUX_WIN10_DUE "${B}"
  FileWrite $Out "build ${B}: due=$R9 expect=${EXPECT}$\r$\n"
!macroend
!macro CASE_CMD C EXPECT
  StrCpy $CMDLINE '${C}'
  !insertmacro KOLUX_IS_UPDATE
  FileWrite $Out 'cmdline ${C}: update=$R9 expect=${EXPECT}$\r$\n'
!macroend

Section
  FileOpen $Out "$EXEDIR\t786-result.txt" w
  !insertmacro CASE_BUILD "19045" 1
  !insertmacro CASE_BUILD "21999" 1
  !insertmacro CASE_BUILD "22000" 0
  !insertmacro CASE_BUILD "26200" 0
  !insertmacro CASE_BUILD "" 0
  !insertmacro CASE_CMD '"k.exe" /P /UPDATE' 1
  !insertmacro CASE_CMD '"k.exe" /S' 0
  !insertmacro CASE_CMD '"k.exe" /update' 1
  ; the real notice, compiled and run: silent, so the box answers itself; nothing is written for it
  !insertmacro KOLUX_WIN10_NOTICE
  FileWrite $Out "notice macro ran to the end$\r$\n"
  FileClose $Out
SectionEnd
