; Local Media Transfer Inno Setup script
;
; This script installs the staged application folder produced by build.ps1.
; Do not point [Files] directly at bin/obj build output: WinUI publish output
; has a different layout than dotnet build output.

#define MyAppName "Local Media Transfer"
#define MyAppVersion "2.0.0"
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
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
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
Name: "firewall"; Description: "Add private-network firewall exceptions for local-device transfers"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Staged layout:
;   {app}\LocalMediaTransfer.GUI.exe
;   {app}\Assets\...
;   {app}\server\LocalMediaTransferServer.exe
;   {app}\server\static\...
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
Filename: "taskkill"; Parameters: "/IM ""LocalMediaTransfer.GUI.exe"" /T /F"; Flags: runhidden; RunOnceId: "StopGui"
Filename: "taskkill"; Parameters: "/IM ""LocalMediaTransferServer.exe"" /T /F"; Flags: runhidden; RunOnceId: "StopServer"
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""{#FirewallRuleName}"" program=""{app}\server\{#MyServerExeName}"""; Flags: runhidden; RunOnceId: "RemoveFirewall"
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""{#DiscoveryFirewallRuleName}"" program=""{app}\server\{#MyServerExeName}"""; Flags: runhidden; RunOnceId: "RemoveDiscoveryFirewall"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
var
  DeleteUserDataOnUninstall: Boolean;

function ConfirmUninstallOptions(): Boolean;
var
  Form: TSetupForm;
  MessageLabel: TNewStaticText;
  CleanupCheckBox: TNewCheckBox;
  ContinueButton: TNewButton;
  CancelButton: TNewButton;
begin
  Result := False;
  DeleteUserDataOnUninstall := False;

  Form := CreateCustomForm(ScaleX(460), ScaleY(190), False, False);
  try
    Form.Caption := 'Uninstall Local Media Transfer';
    Form.Position := poScreenCenter;

    MessageLabel := TNewStaticText.Create(Form);
    MessageLabel.Parent := Form;
    MessageLabel.Left := ScaleX(16);
    MessageLabel.Top := ScaleY(16);
    MessageLabel.Width := ScaleX(428);
    MessageLabel.Height := ScaleY(72);
    MessageLabel.WordWrap := True;
    MessageLabel.Caption :=
      'Local Media Transfer can keep running in the background from the system tray.' + #13#10#13#10 +
      'The uninstaller will close the app and its local server before removing program files.';

    CleanupCheckBox := TNewCheckBox.Create(Form);
    CleanupCheckBox.Parent := Form;
    CleanupCheckBox.Left := ScaleX(16);
    CleanupCheckBox.Top := ScaleY(98);
    CleanupCheckBox.Width := ScaleX(428);
    CleanupCheckBox.Height := ScaleY(36);
    CleanupCheckBox.Checked := True;
    CleanupCheckBox.Caption := 'Delete local settings, logs, history, and benchmark data';

    ContinueButton := TNewButton.Create(Form);
    ContinueButton.Parent := Form;
    ContinueButton.Left := ScaleX(268);
    ContinueButton.Top := ScaleY(150);
    ContinueButton.Width := ScaleX(86);
    ContinueButton.Height := ScaleY(28);
    ContinueButton.Caption := 'Continue';
    ContinueButton.ModalResult := mrOk;

    CancelButton := TNewButton.Create(Form);
    CancelButton.Parent := Form;
    CancelButton.Left := ScaleX(364);
    CancelButton.Top := ScaleY(150);
    CancelButton.Width := ScaleX(80);
    CancelButton.Height := ScaleY(28);
    CancelButton.Caption := 'Cancel';
    CancelButton.ModalResult := mrCancel;

    if Form.ShowModal = mrOk then
    begin
      DeleteUserDataOnUninstall := CleanupCheckBox.Checked;
      Result := True;
    end;
  finally
    Form.Free;
  end;
end;

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  Result := False;

  if (not UninstallSilent) and (not ConfirmUninstallOptions()) then
    Exit;

  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM "LocalMediaTransfer.GUI.exe" /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM "LocalMediaTransferServer.exe" /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1000);

  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if not DirExists(ExpandConstant('{localappdata}\LocalMediaTransfer')) then
      CreateDir(ExpandConstant('{localappdata}\LocalMediaTransfer'));
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    if DeleteUserDataOnUninstall then
      DelTree(ExpandConstant('{localappdata}\LocalMediaTransfer'), True, True, True);
  end;
end;
