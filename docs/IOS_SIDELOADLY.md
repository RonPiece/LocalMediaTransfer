# Install the iOS App from Windows with Sideloadly

This route does not require a paid Apple Developer membership. GitHub Actions
uses a macOS runner to compile an unsigned IPA. Sideloadly signs that IPA with
the user's Apple ID and installs it on the iPhone.

## 1. Build the unsigned IPA

1. Commit and push the iOS app and `.github/workflows/ios-unsigned-ipa.yml`.
2. Open the GitHub repository in a browser.
3. Select **Actions** > **Build unsigned iOS IPA** > **Run workflow**.
4. Select the branch containing the commit you intend to install. A workflow
   can build only committed, pushed GitHub content; local changes are invisible.
5. Select the `production` environment (or `test` for the separate TEST app),
   then wait for the build job to finish successfully.
6. Open the completed workflow run and download the
   **LocalMediaTransfer-production-unsigned-ipa** artifact for production.
7. Extract the downloaded ZIP. It contains
   `LocalMediaTransfer-production-unsigned.ipa` and native build evidence.

The workflow also runs on pull requests and is called by Windows release
verification. It verifies the generated application scheme, embedded JavaScript
bundle, ExpoFont pod, and `LocalMediaTransferNative` Swift module before
publishing the artifact.

## 2. Prepare Windows and the iPhone

1. Install the non-Microsoft-Store versions of iTunes and iCloud required by
   Sideloadly.
2. Restart Windows after installing the Apple device drivers.
3. Connect the unlocked iPhone by USB and press **Trust** on both devices.
4. Open Sideloadly and confirm the iPhone appears in the **iDevice** list.

## 3. Sign and install

1. Drag the selected environment's unsigned IPA onto Sideloadly's IPA area.
2. Enter the Apple ID used for free signing.
3. Leave **Anisette Authentication** set to **Local**.
4. Leave **Signing Mode** set to **Apple ID Sideload**.
5. Select the connected iPhone and press **Start**.
6. Complete Apple two-factor authentication if prompted.

## 4. Trust and run the app

On the iPhone:

1. Open **Settings** > **General** > **VPN & Device Management**.
2. Select the Apple ID developer profile and choose **Trust**.
3. On iOS 16 or later, enable **Settings** > **Privacy & Security** >
   **Developer Mode** if iOS requests it, then restart the phone.
4. Open Local Media Transfer and allow Photos, Camera, and Local Network
   permissions.

Free Apple ID signing is temporary. Sideloadly must refresh or reinstall the
application when the signing period expires. Rebuilding the IPA is needed only
when application code or native dependencies change; re-signing alone is enough
when only the free certificate expires.

Keep the bundle identifier stable (`com.ronthedev.localmediatransfer`). Changing
it creates another App ID in the free provisioning account; rebuilding the same
bundle does not require a new identifier.

## Development versus installed behavior

### Native TEST development client

For Fast Refresh while retaining the custom Swift module:

1. Commit and push the intended branch.
2. Run **Actions** > **Build unsigned iOS IPA** > **Run workflow**, select the
   `development` build profile, and select the TEST application environment.
3. Download and extract the
   `LocalMediaTransfer-test-development-unsigned-ipa` artifact.
4. Sign and install `LocalMediaTransfer-test-development-unsigned.ipa` with
   Sideloadly using the same free-signing steps above.
5. On Windows, from `src\LocalMediaTransfer.iOS`, start Metro with:

   ```powershell
   npm run start:dev-client
   ```

   This command selects the TEST environment and the development client's
   dedicated `exp+ronthedev-local-media-transfer-iphone-2026-test` URL scheme.

6. Keep the iPhone and Windows PC on the same local network. Scan Metro's QR
   code with the iPhone Camera, or open the TEST development client and select
   the detected development server.

The TEST bundle identifier is separate from production, so both applications
can remain installed. Most JavaScript, TypeScript, and style edits use Fast
Refresh without rebuilding the IPA. Rebuild and sideload the development IPA
after changing Swift/native code, installing or updating a native dependency,
changing native app configuration, or upgrading Expo SDK. The development
client is for trusted local development only and depends on the Windows Metro
server; keep the production IPA for normal use.

If the phone cannot reach Metro, verify that Windows Firewall permits Node on
the private network, that both devices are on the same non-isolated Wi-Fi/LAN,
and that a VPN is not replacing the advertised local address.

### Expo Go compatibility mode

Run the Expo development server from `src\LocalMediaTransfer.iOS` with:

```powershell
npm run start:go
```

Expo Go supports UI work, QR/manual connection, and the compatibility uploader.
Automatic desktop discovery and the raw Swift uploader require the generated
native application, so test those behaviors with a newly built IPA.
