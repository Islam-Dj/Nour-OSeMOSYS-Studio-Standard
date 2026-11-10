@echo off
rem Nour OSeMOSYS Studio - starts the local server (solvers, cases, Monte Carlo, export to MUIO) and opens the Studio in your browser
cd /d "%~dp0"
where python >nul 2>nul || (echo Python is not installed or not on the PATH: install Python 3.10-3.14 from python.org, tick "Add python.exe to PATH". & pause & exit /b 1)
for /f "delims=" %%v in ('python -c "import sys; print(sys.executable, sys.version.split()[0])"') do echo Using Python: %%v
rem solvers: GLPK model builder (swiglpk) and HiGHS (highspy)
python -c "import swiglpk, highspy" 2>nul || python -m pip install swiglpk highspy
python -c "import swiglpk, highspy" 2>nul || python -m pip install --user swiglpk highspy
python -c "import swiglpk, highspy" 2>nul || (echo. & echo Could not install swiglpk / highspy for this Python. Open a command window and run: & echo    python -m pip install swiglpk highspy & echo and read the error it prints. The desktop app needs no Python. & pause)
rem for "Export to MUIO" (MUIO's own code needs pandas 2 or 3 and openpyxl); an existing pandas is not changed
python -c "import pandas, openpyxl, werkzeug" 2>nul || python -m pip install "pandas>=2.2" openpyxl werkzeug || python -m pip install --user "pandas>=2.2" openpyxl werkzeug
rem for Monte Carlo (numpy, scipy)
python -c "import numpy, scipy" 2>nul || python -m pip install numpy scipy || python -m pip install --user numpy scipy
python run_studio.py
pause
