@echo off
rem ============================================================
rem  Выпустить обновление WiseBase CRM: просто запустите этот файл двойным кликом.
rem  Что делает:
rem    1) проверяет, что Git установлен и есть что выпускать;
rem    2) предупреждает, если index.html изменён, а версия кеша в sw.js — нет;
rem    3) прогоняет автотесты, если на компьютере есть Node.js (необязательно —
rem       на GitHub тесты всё равно прогонятся перед сборкой);
rem    4) отправляет изменения на GitHub — дальше сборка и выпуск идут сами.
rem ============================================================
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  if exist "%~dp0Git\cmd\git.exe" (
    set "PATH=%~dp0Git\cmd;%PATH%"
  ) else (
    echo [ОШИБКА] Git не найден. Установите Git: https://git-scm.com/download/win
    goto :fail
  )
)

rem Убираем из репозитория папку Git (сама программа Git на компьютере остаётся)
git rm -r -q --cached Git >nul 2>&1

git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo Нет новых изменений — выпускать нечего.
  goto :done
)

rem --- index.html изменён, а CACHE_NAME в sw.js — нет? ---
set "HTML_CHANGED="
set "SW_CHANGED="
for /f "delims=" %%F in ('git diff --cached --name-only') do (
  if /i "%%F"=="app/index.html" set "HTML_CHANGED=1"
  if /i "%%F"=="app/sw.js" set "SW_CHANGED=1"
)
if defined HTML_CHANGED if not defined SW_CHANGED (
  echo.
  echo [ВНИМАНИЕ] Изменён app\index.html, но не изменён app\sw.js.
  echo            Поднимите номер кеша в app\sw.js: CACHE_NAME = 'wisebase-shell-verNN' ^(+1^),
  echo            иначе у части пользователей офлайн может открываться старая версия.
  choice /c 12 /n /m "1 - продолжить выпуск, 2 - отменить: "
  if errorlevel 2 ( git reset -q & goto :done )
)

rem --- Автотесты (если есть Node.js и установлены зависимости тестов) ---
where node >nul 2>&1
if not errorlevel 1 if exist "test\node_modules\playwright" (
  echo Запускаю автотесты...
  node test\run-all.js
  if errorlevel 1 (
    echo.
    echo [ОШИБКА] Тесты не прошли — выпуск остановлен. Подробности: test\last-run-*.log
    git reset -q
    goto :fail
  )
)

git commit -q -m "Update %date% %time%"
if errorlevel 1 ( echo [ОШИБКА] Не удалось сохранить изменения ^(git commit^). & goto :fail )

git push
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Не удалось отправить на GitHub.
  echo   • нет интернета или нужно войти в GitHub — запустите файл ещё раз;
  echo   • на GitHub есть изменения, которых нет здесь — выполните "git pull" и запустите снова.
  goto :fail
)

echo.
echo Изменения отправлены на GitHub. Это ещё НЕ подтверждение выпуска обновления.
echo Обычно тесты и сборка занимают 10-15 минут, но могут идти дольше.
echo Обновление появится только после успешных test, обеих build и publish.
echo Если есть красный шаг или релиз остался Draft, автоматического обновления не будет.
echo Проверить ход сборки: https://github.com/Busya228/wisebase-desktop/actions
goto :done

:fail
echo.
echo Выпуск НЕ выполнен.
:done
pause
endlocal
