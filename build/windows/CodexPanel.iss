#ifndef AppVersion
#define AppVersion "3.0.5"
#endif

#define ProjectRoot AddBackslash(SourcePath) + "..\.."
#define BinDir AddBackslash(SourcePath) + "..\bin"

[Setup]
AppId={{B7F78069-A5DA-4906-87C4-768C6A12ED60}
AppName=CodexPanel
AppVersion={#AppVersion}
AppPublisher=wintopic
AppPublisherURL=https://github.com/wintopic/CodexPanel
AppSupportURL=https://github.com/wintopic/CodexPanel/issues
AppUpdatesURL=https://github.com/wintopic/CodexPanel/releases
DefaultDirName={localappdata}\Programs\CodexPanel
DefaultGroupName=CodexPanel
DisableProgramGroupPage=yes
OutputDir={#ProjectRoot}\dist
OutputBaseFilename=CodexPanel-Setup-{#AppVersion}
SetupIconFile={#SourcePath}\icon.ico
UninstallDisplayIcon={app}\CodexPanel.exe
LicenseFile={#ProjectRoot}\LICENSE
ArchitecturesAllowed=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#BinDir}\CodexPanel.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinDir}\codexpanel-node-sidecar.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\CodexPanel"; Filename: "{app}\CodexPanel.exe"
Name: "{autodesktop}\CodexPanel"; Filename: "{app}\CodexPanel.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\CodexPanel.exe"; Description: "{cm:LaunchProgram,CodexPanel}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM CodexPanel.exe /F 2>NUL || exit /B 0"; Flags: runhidden; RunOnceId: "StopCodexPanel"
Filename: "{cmd}"; Parameters: "/C taskkill /IM codexpanel-node-sidecar.exe /F 2>NUL || exit /B 0"; Flags: runhidden; RunOnceId: "StopCodexPanelSidecar"
