# Set up the Wizard Android companion app

You are the owner's agent. Follow these steps in order. Keep every message to the owner short. Put each command and each link on its own line.

The companion is a free early-access app, labelled **Wizard** on the phone, for Android 9 or later. It opens the owner's own Wizard in a native shell. There is no purchase.

## 1. Find the owner's Wizard

Wizard OS must already be installed. If it is not, follow https://aiwizards.com/os.md first, then come back.

Run this read-only status check. It changes nothing:

```
curl -fsSL https://aiwizards.com/os.sh | bash -s status
```

Use the exact private HTTPS link it reports, including any port. If it reports no link, ask the owner for the private Wizard link they already use. Never guess a hostname or port, never use anyone else's server, and never change server settings.

Tell the owner:

> Turn on Tailscale on your Android phone and connect it to the same Tailscale network as your Wizard. Then open your private Wizard link in Chrome and check it loads.

If it does not load, fix that first: Tailscale on, same network, same link. Never make the Wizard public, turn off HTTPS or weaken owner authentication. Other members of a shared Tailscale network may also reach it unless access is restricted; Tailscale access is not owner authentication. Only connect to a Wizard the owner trusts: that server supplies the interface and can use phone capabilities after the owner grants permission.

## 2. Verify the download

Use only this release. Never use another branch, build artifact or debug APK.

Release:

https://github.com/humanitylabs-org/wizard-ux/releases/tag/android-shell-v1.0.1-early-access

Manifest:

https://github.com/humanitylabs-org/wizard-ux/releases/download/android-shell-v1.0.1-early-access/android-companion.json

APK:

https://github.com/humanitylabs-org/wizard-ux/releases/download/android-shell-v1.0.1-early-access/wizard-android-companion-1.0.1.apk

Download the manifest and the APK on your own machine and check them before sending the owner anything:

- application ID `ai.wizards.shell`, versionName `1.0.1`, versionCode `2`, minimum Android API `28`
- APK SHA-256:

```
c778c82f240279f7caa039aef929aef6c339cf36d83e3fdd6b7ab3c264b24ee6
```

- signing certificate SHA-256 (check with `apksigner verify --print-certs` if the Android SDK is available):

```
ba972d734ec674f0c98ea031caac0fcd0d52d6bf391f69e5ea55cb9e9258c2f7
```

If anything does not match, stop and tell the owner. Never substitute another download.

## 3. Owner installs it

Send the owner the APK link, then this message, word for word:

> 1. On your Android phone, open the link above in Chrome and download the file.
> 2. Open the download and tap Install. If Android asks, allow "Install unknown apps" for Chrome, then go back and tap Install. You can turn that setting off again afterwards.
> 3. Keep Play Protect on. This app comes straight from us, not the Play Store, so Android may warn you once.
> 4. Open the app called Wizard, paste your private Wizard link, and tap Connect.
> 5. To switch to a different Wizard later, press and hold the app icon and tap Change Wizard.
>
> If your phone or work policy blocks the install, stop and tell me what it says.

The owner taps every install prompt themselves. Never install silently, and never ask for USB debugging, root or remote control.

## 4. Permissions

The app asks for permissions only when a feature needs them: microphone the first time the owner records, camera when they take a photo, notifications only for a background feature. Saying no never breaks ordinary chat.

Never ask the owner to grant accessibility, contacts, full storage access or battery-optimization exemptions. "Display over other apps" is only for the floating orb, and only if the owner turns it on.

## 5. What to expect

Chats, apps and their screens come from the owner's Wizard. The app adds the phone parts: connecting, Android Back, camera and file access, home-screen shortcuts and the launcher icon. Home-screen shortcuts require support from both the deployed Wizard web release and the Android launcher.

Background recording and the floating orb (Wizard Everywhere) need a Wizard web release that supports them. Check what the app actually offers rather than promising them. If those options are missing or greyed out, that is expected: chat and voice still work while the app is open. Never install a test build, change the owner's update channel or point the app at another server to unlock them.

## 6. Confirm with the owner

Ask the owner to check, in their own words:

1. The app opens their Wizard.
2. A normal chat works.
3. A short voice note works with the app open.
4. Android Back moves back inside Wizard.
5. Closing and reopening the app returns to the same Wizard.

Never send a message or recording for them. Report only what they confirm. If they have not confirmed yet, say "Installed; phone checks pending."

## Updates and removal

Newer releases keep application ID `ai.wizards.shell` and the signing certificate above, with a higher versionCode. Verify each one the same way, then let the owner tap Android's update prompt. Updating keeps the app's data. If Android refuses an update, stop and report the error; never uninstall or clear storage to force it.

This app updates the public `ai.wizards.shell` package in place. It installs alongside the debug test app (`ai.wizards.shell.test`) and the separate full app (`ai.wizards.os`), not over them. Test-app recordings, settings and shortcuts do not transfer automatically. Keep the test app installed until pending recordings are sent or safely retained and the owner confirms it is safe to remove. Never clear its storage to fix installation. Reconnect in the release app and recreate shortcuts there if needed.

To remove it, the owner sends or saves any recordings still waiting in the app, then uninstalls it from Android Settings. That deletes only the app's data on the phone. Their Wizard server is untouched.

## Never

- Never use a different download, server or Wizard than the owner's own.
- Never bypass HTTPS or certificate checks, or make the Wizard public.
- Never edit the owner's server, Wizard OS or Hermes as part of this setup.
- Never improvise fixes. If a step fails, tell the owner what happened and stop.
