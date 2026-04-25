# Mochi — Android (TV) shell

A thin WebView wrapper that points at a running Mochi server. Targets
phones, tablets, and Android TV (it shows up on the TV home rail thanks
to a `LEANBACK_LAUNCHER` intent).

## Prereqs

- Android Studio (the user already has this installed)
- A running Mochi server reachable from the device — `bun src/index.ts`
  in the parent repo, exposed on your LAN. The default Bun port is 3000.
- The TV / device on the same Wi-Fi as the host machine.

## Build

1. Open this `android/` folder in Android Studio. Studio will sync
   Gradle (it'll fetch the wrapper itself the first time).
2. Plug in your Android device, or pair an Android TV over ADB
   (Settings → Developer options → Network debugging → pair).
3. Hit **Run**. The first run installs and opens the app, which prompts
   you for the Mochi server URL — type something like
   `http://192.168.1.42:3000` and tap Save.

## Build a release APK from the command line

```sh
cd android
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release-unsigned.apk
```

For Android TV sideload:

```sh
adb connect <tv-ip>:5555
adb install -r app/build/outputs/apk/release/app-release-unsigned.apk
```

## What's inside

- `app/src/main/AndroidManifest.xml` — declares `RECORD_AUDIO`,
  `INTERNET`, `LEANBACK_LAUNCHER` intent, cleartext-traffic enabled.
- `app/src/main/kotlin/com/mochi/family/MainActivity.kt` — single
  Activity with a WebView. JS + DOM storage on; `WebChromeClient`
  forwards in-page mic permission requests to the system; press
  **MENU** on the TV remote (or long-press **BACK**) to open the
  settings dialog and change the server URL.
- `app/src/main/res/xml/network_security_config.xml` — allows plain
  HTTP because the family server runs on the LAN. Swap to HTTPS when
  you deploy publicly.
- `app/src/main/res/drawable/ic_launcher_foreground.xml` and
  `tv_banner.xml` — the Mochi mascot drawn as Android vector paths so
  the icon and TV-rail banner render crisply at every DPI without
  shipping any bitmaps.

## Hidden grown-up controls

- **Open settings**: press the MENU key on the remote, or long-press the
  BACK button. Use this to change the server URL or recover from a
  network error.
- **Back**: navigates the WebView's history when there is one,
  otherwise exits the app.

## Known limits (today)

- Cleartext is permitted globally so the LAN server works. For an
  internet-reachable deploy, switch to HTTPS and tighten
  `network_security_config.xml`.
- D-pad navigation inside generated child apps depends on each app's
  own focus styling. Mochi's own kid-mode shell handles D-pad fine; an
  individual generated app might not. We can update the system prompt
  in `src/server/Claude.ts` later to require focus-visible rings.
- The settings dialog's text field accepts any string; no validation.
- No app icon foreground/background drawables for legacy Android
  versions (pre-O) — those will fall back to the default icon. Most
  Android TV devices ship with API 25+, so this is fine in practice.
