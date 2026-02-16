!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\TerminatorFluent" "" "Open in Terminator Fluent"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\TerminatorFluent" "Icon" "$INSTDIR\Terminator Fluent.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\TerminatorFluent\command" "" '$\"$INSTDIR\Terminator Fluent.exe$\" $\"%V$\"'

  WriteRegStr HKCU "Software\Classes\Directory\shell\TerminatorFluent" "" "Open in Terminator Fluent"
  WriteRegStr HKCU "Software\Classes\Directory\shell\TerminatorFluent" "Icon" "$INSTDIR\Terminator Fluent.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\TerminatorFluent\command" "" '$\"$INSTDIR\Terminator Fluent.exe$\" $\"%V$\"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\TerminatorFluent"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\TerminatorFluent"
!macroend
