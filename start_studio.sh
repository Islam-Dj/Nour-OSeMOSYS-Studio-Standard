#!/bin/sh
# Nour OSeMOSYS Studio (Mac / Linux) - starts the local server and opens the Studio in your browser
cd "$(dirname "$0")"
python3 -c "import swiglpk, highspy" 2>/dev/null || python3 -m pip install swiglpk highspy
python3 -c "import pandas, openpyxl, werkzeug" 2>/dev/null || python3 -m pip install "pandas>=2.2" openpyxl werkzeug
python3 -c "import numpy, scipy" 2>/dev/null || python3 -m pip install numpy scipy
exec python3 run_studio.py "$@"
