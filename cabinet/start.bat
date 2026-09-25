@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python не найден. Установите его с сайта python.org
  echo и при установке отметьте галочку "Add python.exe to PATH".
  pause
  exit /b 1
)

echo Устанавливаю зависимости, это займёт минуту...
python -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo Не удалось установить зависимости.
  pause
  exit /b 1
)

if not defined ADMIN_EMAIL set ADMIN_EMAIL=admin@site.ru
if not defined ADMIN_PASSWORD set ADMIN_PASSWORD=admin12345
set SEED_DEMO=1

echo.
echo ==============================================
echo  Кабинет: http://localhost:8000
echo  Вход:    %ADMIN_EMAIL%  /  %ADMIN_PASSWORD%
echo  Чтобы остановить — закройте это окно.
echo ==============================================
echo.

start "" cmd /c "timeout /t 3 >nul & start http://localhost:8000"
python wsgi.py
pause
