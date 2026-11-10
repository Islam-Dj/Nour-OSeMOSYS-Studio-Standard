"""Nour OSeMOSYS Studio - start the local server and open the Studio in the web browser.

python run_studio.py [--port 8775] [--runs FOLDER] [--cases FOLDER] [--no-browser]
"""

import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server.app import main

if __name__ == '__main__':
    main()
