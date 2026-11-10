Nour OSeMOSYS Studio - desktop application
==============================================

START   Nour_OSeMOSYS_Studio.exe (or the Start-menu / desktop shortcut made by the installer).
        The Studio opens in its own window. Everything runs on this computer; nothing is sent elsewhere.
        Close the window to stop it. Needs Windows 10 or 11 (the window uses Microsoft Edge WebView2, part of Windows;
        if it is missing the Studio opens in your web browser instead).

YOUR WORK   Documents\Nour OSeMOSYS Studio\
        cases\<model>\<case>\  one folder per case, grouped by model file (like MUIO's DataStorage):
                           data.txt (the data file, MathProg), model.txt (the model file of the case),
                           case.json (name, descriptions settings, saved charts), runs\<run>\ (each solve: data, model,
                           log, status, solution, results\<Variable>.csv)
        runs\              runs made without a case
        settings.json      the MUIO folder for "Export to MUIO"
        Models -> "Show folder" opens a case folder. Copy a case folder to another computer to move the model.
        Uninstalling the program keeps this folder.

SOLVERS     included: HiGHS, GLPK (simplex / interior), CBC. Gurobi is used if installed (gurobi_cl on the PATH).
            Put another highs.exe / cbc.exe in the "solvers" folder of the program to use that version.

OBJECTIVE   The Studio reports the full objective of the model file. OSeMOSYS objectives contain a constant part
            (e.g. the discounted fixed cost of the residual capacity), which the LP/MPS files written by glpsol leave out,
            so MUIO and glpsol+CBC/HiGHS runs show the objective WITHOUT it. The Run panel shows both numbers; the MUIO
            export writes MUIO's number so the case matches MUIO's own runs.

MUIO        "Export to MUIO": see the Studio README (full model for standard single-region models; results only otherwise).

BUILD IT YOURSELF (from the desktop folder of the Studio source)
            BUILD_WINDOWS.bat            -> dist\Nour_OSeMOSYS_Studio\ (the program), a portable zip and, if Inno Setup
                                            (https://jrsoftware.org/isinfo.php) is installed, installer\Nour_OSeMOSYS_Studio_Setup_<version>.exe
            GitHub: push the source folder as a repository; Actions -> "Build Windows app" -> Run workflow;
                    the installer and the portable zip are in the run's artifacts.
            Command line: Nour_OSeMOSYS_Studio.exe --browser (use the web browser), --home <folder> (another work folder)

Nour OSeMOSYS Studio is open source, under the Apache License 2.0 (LICENSE, NOTICE).
MUIO code (engine\muio_api) is from OSeMOSYS/MUIO, Apache License 2.0 (LICENSE_MUIO_Apache-2.0.txt).
Solvers inside: HiGHS (MIT License), CBC (COIN-OR, Eclipse Public License 2.0), GLPK (through swiglpk, GNU GPL v3).
