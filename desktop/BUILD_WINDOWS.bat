@echo off
rem Builds Nour OSeMOSYS Studio for Windows: the app folder, a portable zip and (with Inno Setup) an installer.
rem Needs Python 3.10-3.13 (python.org, "Add to PATH"). Takes 5-10 minutes the first time.
cd /d "%~dp0"
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements_app.txt
python build_app.py %*
echo.
echo Done: dist\Nour_OSeMOSYS_Studio\Nour_OSeMOSYS_Studio.exe  (and installer\ if Inno Setup is installed)
pause
