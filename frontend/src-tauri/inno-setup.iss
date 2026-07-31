; GEMI — Inno Setup installer script (Windows x64)
;
; Used instead of NSIS because NSIS has a hard ~2 GB data-block mmap limit
; that CUDA torch DLLs alone exceed ("Internal compiler error #12345").
; Inno Setup has no such limit and handles 4+ GB bundles cleanly.
;
; Inno Setup 6 is pre-installed on GitHub Actions Windows runners at:
;   C:\Program Files (x86)\Inno Setup 6\ISCC.exe
;
; All source paths are relative to this .iss file (frontend\src-tauri\).
; Run from CI with:
;   iscc frontend\src-tauri\inno-setup.iss

#define AppName      "GEMI"
#define AppVersion   "0.0.5"
#define AppPublisher "GEMI"
#define AppExeName   "app.exe"
#define AppId        "com.gemi.app"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/your-org/gemi-app
AppSupportURL=https://github.com/your-org/gemi-app/issues
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

; Backend sidecar — entire PyInstaller onedir, including CUDA DLLs if present.
; Placed at {app}\gemi-backend\ which is where resource_dir().join("gemi-backend")
; resolves at runtime (see src\sidecar_manager.rs).
Source: "binaries\gemi-backend\*"; \
  DestDir: "{app}\gemi-backend"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; Visual C++ 2015-2022 Redistributable — required by PyTorch CUDA DLLs.
; Downloaded during CI build and placed next to this .iss file.
Source: "vc_redist.x64.exe"; \
  DestDir: "{tmp}"; \
  Flags: deleteafterinstall

[Icons]
Name: "{group}\{#AppName}";    Filename: "{app}\{#AppExeName}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; Install VC++ runtime silently before launching — no-op if already up to date.
; shellexec lets vc_redist handle its own UAC elevation request.
Filename: "{tmp}\vc_redist.x64.exe"; \
  Parameters: "/install /quiet /norestart"; \
  StatusMsg: "Installing Visual C++ Runtime..."; \
  Check: VCRedistNeedsInstall; \
  Flags: waituntilterminated shellexec

Filename: "{app}\{#AppExeName}"; \
  Description: "{cm:LaunchProgram,{#AppName}}"; \
  Flags: nowait postinstall skipifsilent

[Code]
function VCRedistNeedsInstall: Boolean;
var
  Installed: Cardinal;
begin
  // VS 2015-2022 all share the same 14.x runtime registry key
  if RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Installed', Installed) then
    Result := Installed <> 1
  else
    Result := True;
end;

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
