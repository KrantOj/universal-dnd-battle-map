; Деинсталлятор спрашивает, удалять ли настройки и профили кампаний (только %APPDATA%\Universal DnD Battle map).
; По умолчанию "Нет". Папки с картами/музыкой/токенами кампаний (выбранные пользователем) никогда не затрагиваются.
; При обновлении (старый деинсталлятор запускается с --updated) вопрос не задаётся и данные остаются; в тихом режиме - тоже не удаляем.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Удалить также настройки и список кампаний?$\r$\n(Ваши папки с картами, музыкой и токенами останутся нетронутыми.)$\r$\n$\r$\nAlso delete settings and the campaign list? (Your map/music/token folders are never touched.)" /SD IDNO IDNO udbmKeepData
      RMDir /r "$APPDATA\Universal DnD Battle map"
    udbmKeepData:
  ${endIf}
!macroend
