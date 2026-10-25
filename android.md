# Set up the Android Companion App for Wizard OS

You are the owner's agent. Follow these steps in order. Keep messages short and put each link on its own line. This is the free, early-access **Wizard Shell** companion, not the separate full Android app. Android 9 or later is required. There is no additional purchase.

## 1. Find this owner's Wizard

Use the existing Wizard OS installation's status and its private HTTPS link. If Wizard OS is not installed, follow https://aiwizards.com/os.md first. Use only the owner's own installation; never copy another person's address, guess a hostname or port, or use a developer's test server.

For the alongside installer, the read-only status command is:

```
curl -fsSL https://aiwizards.com/os.sh | bash -s status
```

Use the exact HTTPS address it reports, including any non-default port. The app accepts the origin or its `/wizard-os-home/` link. If status does not provide an address, stop and ask the owner for the private Wizard link they already use; do not inspect unrelated credentials or change server configuration.

Tell the owner to turn on Tailscale on their Android phone, signed into the same network as their Wizard, and open that private link in Chrome first. Resolve ordinary reachability before installing. Never publish the Wizard, disable HTTPS/certificate validation, or weaken owner authentication. Other members of a shared Tailscale network may reach it too unless access is restricted. Install this app only for a Wizard the owner trusts: that selected server supplies the web interface and can use device capabilities after the owner grants permissions.

## 2. Verify the public release

Install only this pinned early-access release, not a moving branch, Actions artifact, debug APK or another app's update feed:

https://github.com/humanitylabs-org/wizard-ux/releases/tag/android-shell-v1.0.0-early-access

Release manifest:

https://github.com/humanitylabs-org/wizard-ux/releases/download/android-shell-v1.0.0-early-access/android-companion.json

APK:

https://github.com/humanitylabs-org/wizard-ux/releases/download/android-shell-v1.0.0-early-access/wizard-android-companion-1.0.0.apk

Verify the manifest and downloaded APK on the agent's machine before handing over the link. Expected application ID: `ai.wizards.shell`; versionName: `1.0.0`; versionCode: `1`; minimum Android API: `28`. Source: `humanitylabs-org/wizard-ux` commit `745d20cc0c76d667a9a61ec977d0d3307afe397b`, module `android/shell` only.

Expected APK SHA-256:

```
19d9f10cbf499332f56d06bf3ecab2e9c2112ff0c953ce1b66e185aac4828a24
```

Expected signing certificate SHA-256 (use Android SDK `apksigner verify --print-certs` when available):

```
ba972d734ec674f0c98ea031caac0fcd0d52d6bf391f69e5ea55cb9e9258c2f7
```

If verification fails, stop. Do not substitute another download or tell the owner to ignore Android's warnings.

## 3. Human phone install

Send the APK link to the owner and say:

> On your Android phone, open this link in Chrome and download the APK. Open the download and tap Install. If Android asks, allow “Install unknown apps” for the browser or file app you used, then return to the installer. Turn that allowance off again afterward if you do not need it. Keep Play Protect enabled. This is a direct early-access download, not a Play Store listing. If Android or your work-device policy blocks installation, stop and share the message; don't bypass it.

The owner must approve Android's installer on the phone. Never install silently, require USB debugging/root, or request remote control. Open the app labelled **Wizard**, paste the owner's exact private HTTPS Wizard address into Connect, and tap Connect. Long-pressing its launcher icon offers **Change Wizard** later.

## 4. Explain what is available

The APK is a thin device client. Chats, apps and their screens come from the owner's Wizard web shell. Native code supplies connection/reachability, WebView media/file access, hardware Back, optional durable background microphone capture, optional floating orb, home-screen shortcuts and the adaptive launcher icon. It contains no native Food or Photos feature logic and is not the full Android app's assistant/accessibility/voice-typing replacement.

**Compatibility matters:** the normal Wizard OS stable installer currently provides baseline web chat and in-app/browser-style voice. It does **not** include this early-access shell's `device-port.js`, `device-recording.js` and `device-orb.js` integration. On that baseline, background recording and Wizard Everywhere are unavailable; a disabled Everywhere row is expected, not a reason to grant more permissions. Keep the app in front while recording and do not promise screen-locked recording. Home-screen app pinning is offered only when the deployed web shell and Android launcher support it.

The matching web integrations at the pinned source above have passed fixture/emulator tests and owner testing, but are not a normal stable server release. Do not install a feature branch, overwrite the owner's web files, change their release channel, or point them to a developer's server to unlock them. Optional capabilities become available only with an official compatible Wizard web release installed through its supported update process. Inspect actual capability/UI availability rather than inferring it from the APK version. The companion should still open ordinary web features without those integrations.

Ask for microphone permission only when the owner first records, camera permission only when they choose camera capture, and notification permission when an available background feature needs its persistent notification. “Display over other apps” is optional and only for an available Wizard Everywhere feature the owner explicitly enables. Denying optional permissions must not prevent basic chat. Do not request accessibility, contacts, broad storage or battery-optimization exemptions as part of setup.

## 5. Verify with the owner

Ask the owner to confirm: the app opens their own Wizard; an ordinary chat works; a short non-sensitive voice note works while the app stays open; Android Back works; and reopening remembers the right Wizard. Do not send a real message or recording on their behalf. Only test background recording/Everywhere if the deployed web shell actually exposes the matching capabilities. If offered, pin an app through its home-screen action and confirm Android's own pin dialog; launcher support varies.

Report what the owner actually confirms. If not confirmed, say “installed; phone checks still pending,” not “everything works.” For reachability, check Tailscale and the same link in Chrome first. Never replace the owner's installation with a test server or bypass TLS.

## Updates, test-app migration and removal

Future APK updates must retain application ID `ai.wizards.shell` and the signing certificate above, with an increasing versionCode. Verify each explicitly published release and let the owner tap Android's update confirmation. Web updates deliver web features; native capability, lifecycle and security fixes still require APK updates. This shell does not silently update from the full app's feed.

The debug test app uses **`ai.wizards.shell.test`**, a different package and signing key. This public APK installs beside it, not over it: settings, pending recordings and pinned shortcuts are not automatically migrated. Leave the test app installed until every pending recording is sent or otherwise safely retained and the owner confirms it is safe to remove. Never clear app storage or uninstall it to “fix” installation. Reconnect in the release app and recreate shortcuts there if needed. The separate full app (`ai.wizards.os`) is also not upgraded or replaced.

To remove this companion, first resolve pending local recordings, then let the owner uninstall it in Android Settings. Uninstalling deletes that package's local data; it does not uninstall the server's Wizard OS or Hermes. Do not delete server data or unrelated apps.
