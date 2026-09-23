; GEMI — Inno Setup installer script (Windows x64)
;
; Kept (rather than Tauri's NSIS bundle) because v0.0.5 shipped with it:
; the same AppId makes this an in-place upgrade of that install (D1). The
; app no longer bundles a Python backend — it runs the GEMINIbase stack in
; Docker — so the installer is small.
;
; The uninstaller removes only the program folder. The user's data
; (%APPDATA%\GEMI, ~\GEMI-Data, the stack's data folder) is never touched.
;
; Inno Setup 6 is pre-installed on GitHub Actions Windows runners at:
;   C:\Program Files (x86)\Inno Setup 6\ISCC.exe
;
; All source paths are relative to this .iss file (frontend\src-tauri\).
; Run from CI with:
;   iscc frontend\src-tauri\inno-setup.iss

#define AppName      "GEMI"
; CI passes the release version: ISCC /DAppVersion=1.2.3
#ifndef AppVersion
  #define AppVersion "0.0.5"
#endif
#define AppPublisher "GEMI"
#define AppExeName   "app.exe"
#define AppId        "com.gemi.app"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/GEMINI-Breeding/GEMINI-App
AppSupportURL=https://github.com/GEMINI-Breeding/GEMINI-App/issues
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=target\release\bundle\inno
OutputBaseFilename=GEMI_{#AppVersion}_x64-setup
; lzma2/ultra64: no data-block size limit, good compression ratio for large bundles
Compression=lzma2/ultra64
SolidCompression=yes
; x64 Windows 10 1803+ required (WebView2 built-in since build 17134)
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
MinVersion=10.0.17134
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Main Tauri executable
Source: "target\release\{#AppExeName}"; \
  DestDir: "{app}"; \
  Flags: ignoreversion

; The GEMINIbase compose file the app runs (resource_dir()\stack\…).
Source: "..\..\backend\gemini\pipeline\docker-compose.prod.yaml"; \
  DestDir: "{app}\stack"; DestName: "docker-compose.yaml"; \
  Flags: ignoreversion

[InstallDelete]
; v0.0.5's bundled Python backend (~4 GB of program files, not user data).
Type: filesandordirs; Name: "{app}\gemi-backend"

[Icons]
Name: "{group}\{#AppName}";    Filename: "{app}\{#AppExeName}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; \
  Description: "{cm:LaunchProgram,{#AppName}}"; \
  Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
