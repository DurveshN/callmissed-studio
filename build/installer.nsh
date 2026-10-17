; Adds CallMissed Studio to Explorer's "Open with" list for images and PDFs (per user), without
; changing which app opens them by default. Removed again on uninstall.

!macro studioOpenWith EXT
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "CallMissedStudio.File" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
!macroend

!macro studioRemoveOpenWith EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "CallMissedStudio.File"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\CallMissedStudio.File" "" "Image or PDF"
  WriteRegStr HKCU "Software\Classes\CallMissedStudio.File\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\CallMissedStudio.File\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "CallMissed Studio"
  !insertmacro studioOpenWith "png"
  !insertmacro studioOpenWith "jpg"
  !insertmacro studioOpenWith "jpeg"
  !insertmacro studioOpenWith "webp"
  !insertmacro studioOpenWith "gif"
  !insertmacro studioOpenWith "bmp"
  !insertmacro studioOpenWith "pdf"
  ; Tell Explorer the associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro studioRemoveOpenWith "png"
  !insertmacro studioRemoveOpenWith "jpg"
  !insertmacro studioRemoveOpenWith "jpeg"
  !insertmacro studioRemoveOpenWith "webp"
  !insertmacro studioRemoveOpenWith "gif"
  !insertmacro studioRemoveOpenWith "bmp"
  !insertmacro studioRemoveOpenWith "pdf"
  DeleteRegKey HKCU "Software\Classes\CallMissedStudio.File"
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
