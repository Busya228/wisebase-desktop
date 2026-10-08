@echo off
rem Выпустить обновление WiseBase CRM: просто запустите этот файл двойным кликом.
chcp 65001 >nul
cd /d "%~dp0"
rem Убираем из репозитория папку Git (сама программа Git на компьютере остаётся)
git rm -r -q --cached Git >nul 2>&1
git add -A
git commit -m "Update %date% %time%"
git push
echo.
echo Готово. Через 10-15 минут обновление само придёт всем пользователям.
pause
