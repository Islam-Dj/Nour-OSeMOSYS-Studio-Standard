; Inno Setup script of Nour OSeMOSYS Studio (run by build_app.py on Windows)
#ifndef MyVersion
  #define MyVersion "0.22.1"
#endif
[Setup]
AppId={{6E0B1F4C-6C1D-4D55-9C0E-4E4F55D0A001}
AppName=Nour OSeMOSYS Studio
AppVersion={#MyVersion}
AppPublisher=Nour Elislam DJEDAA (CREAD)
DefaultDirName={localappdata}\Programs\Nour OSeMOSYS Studio
DefaultGroupName=Nour OSeMOSYS Studio
PrivilegesRequired=lowest
OutputDir=installer
OutputBaseFilename=Nour_OSeMOSYS_Studio_Setup_{#MyVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
#if FileExists("icon.ico")
SetupIconFile=icon.ico
#endif
UninstallDisplayIcon={app}\Nour_OSeMOSYS_Studio.exe
[Files]
Source: "dist\Nour_OSeMOSYS_Studio\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
[Icons]
Name: "{group}\Nour OSeMOSYS Studio"; Filename: "{app}\Nour_OSeMOSYS_Studio.exe"
Name: "{group}\Uninstall Nour OSeMOSYS Studio"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Nour OSeMOSYS Studio"; Filename: "{app}\Nour_OSeMOSYS_Studio.exe"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
[Run]
Filename: "{app}\Nour_OSeMOSYS_Studio.exe"; Description: "Start Nour OSeMOSYS Studio"; Flags: nowait postinstall skipifsilent
; your cases (Documents\Nour OSeMOSYS Studio) are kept when the program is uninstalled
