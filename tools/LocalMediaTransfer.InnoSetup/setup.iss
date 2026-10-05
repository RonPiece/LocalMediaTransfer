; Local Media Transfer Inno Setup script
;
; This script installs the staged application folder produced by build.ps1.
; Do not point [Files] directly at bin/obj build output: WinUI publish output
; has a different layout than dotnet build output.

#define MyAppName "Local Media Transfer"
#ifndef MyAppVersion
  #error MyAppVersion must be supplied from VERSION by build.ps1
#endif
#define MyAppPublisher "Ron Blanki"
#define MyAppURL "https://github.com/RonPiece/LocalMediaTransfer"
#define MyGuiExeName "LocalMediaTransfer.GUI.exe"
#define MyServerExeName "LocalMediaTransferServer.exe"
#define FirewallRuleName "Local Media Transfer Server"
#define DiscoveryFirewallRuleName "Local Media Transfer Discovery"

#ifndef StagingDir
  #define StagingDir GetEnv("LMT_INSTALLER_STAGING")
#endif

#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-1234567890AB}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
AllowNoIcons=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
OutputDir={#OutputDir}
OutputBaseFilename=LocalMediaTransfer-Setup-{#MyAppVersion}-x64
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Setup
VersionInfoProductName={#MyAppName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardSmallImageFile={#StagingDir}\Assets\Icons\AppIcon_master_1024.png
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile={#StagingDir}\Assets\Icons\AppIcon.ico
LicenseFile={#StagingDir}\LICENSE.txt
UninstallDisplayIcon={app}\{#MyGuiExeName}
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "firewall"; Description: "Allow local-device transfers on Private networks (local subnet only)"; GroupDescription: "Network access:"

[Files]
; Staged layout:
;   {app}\LocalMediaTransfer.GUI.exe
;   {app}\Assets\...
;   {app}\server\LocalMediaTransferServer.exe
;   {app}\server\static\...
;   {app}\uninstall-support\...
Source: "{#StagingDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyGuiExeName}"; IconFilename: "{app}\Assets\Icons\AppIcon.ico"; Comment: "Send and receive files on your private local network"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyGuiExeName}"; IconFilename: "{app}\Assets\Icons\AppIcon.ico"; Tasks: desktopicon; Comment: "Send and receive files on your private local network"

[Run]
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""{#FirewallRuleName}"" dir=in action=allow program=""{app}\server\{#MyServerExeName}"" protocol=TCP profile=private remoteip=localsubnet enable=yes"; StatusMsg: "Adding private-network firewall exception..."; Tasks: firewall; Flags: runhidden
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""{#DiscoveryFirewallRuleName}"" dir=in action=allow program=""{app}\server\{#MyServerExeName}"" protocol=UDP localport=45892 profile=private remoteip=localsubnet enable=yes"; StatusMsg: "Allowing private-network device discovery..."; Tasks: firewall; Flags: runhidden
Filename: "{app}\{#MyGuiExeName}"; Description: "Launch Local Media Transfer"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""{#FirewallRuleName}"" program=""{app}\server\{#MyServerExeName}"""; Flags: runhidden; RunOnceId: "RemoveFirewall"
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""{#DiscoveryFirewallRuleName}"" program=""{app}\server\{#MyServerExeName}"""; Flags: runhidden; RunOnceId: "RemoveDiscoveryFirewall"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  Result := False;

  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\uninstall-support\stop-installed-processes.ps1') +
    '" -InstallDirectory "' + ExpandConstant('{app}') + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then Exit;
  if ResultCode <> 0 then
  begin
    if not UninstallSilent then MsgBox('Close the installed application and retry uninstalling.', mbError, MB_OK);
    Exit;
  end;

  Result := True;
end;
