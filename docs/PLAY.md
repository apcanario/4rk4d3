# rlx on Google Play: how to build, sign, install and release

Row P3, PLAN §6f. The app is /android-app/: the web files of this repo bundled in a Capacitor shell. GitHub Actions builds it (.github/workflows/android.yml). Nothing here needs Android Studio.

Never paste a password, a key or a keystore into a chat, an issue, a commit or a file in this repo. They go only into the repo's Actions secrets and your own safe storage.

## 1. Install the debug APK on your phone (testing)

1. Open the repo on GitHub, Actions, workflow "android", the latest green run on main.
2. Under Artifacts download **rlx-debug-apk** (a zip). Unzip it: inside is `app-debug.apk`.
3. Put it on the phone (download the zip on the phone itself, or copy the APK over USB or Drive).
4. On the phone open the APK from Files. Android asks to allow installs from that app (Files or Chrome): allow it once. Install.
5. Open **rlx** from the launcher. The debug build is signed with a throwaway debug key, so a later release build from Play cannot update it: uninstall the debug app before installing from Play.

What to check (P3's device check, with X34, PLAN §8): opens full screen with no bars (a swipe from the top or bottom edge shows them for a moment); the hub's sky reaches into the camera cutout; a card opens its game; one back gesture returns to the hub, one more leaves the app; every game vibrates from its first event (no tap needed first); flight mode on: everything still works; portrait only.

## 2. Make the upload key (once)

Google Play signs the app for users with its own key (Play App Signing). You sign each upload with your **upload key**. If the upload key is ever lost, Play support can reset it; the app is not lost.

On your computer, with a JDK installed (keytool comes with it), run in a private folder outside the repo:

    keytool -genkeypair -v -keystore rlx-upload.jks -storetype JKS -alias rlx-upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=rlx upload key"

keytool asks for a keystore password and then a key password (pressing Enter for the key password makes it the same as the keystore password, which is fine). Store `rlx-upload.jks` and both passwords in your password manager. Do not put the file in the repo (.gitignore refuses *.jks anyway).

Then make the base64 text of the keystore for the secret:

    base64 -w0 rlx-upload.jks > rlx-upload.jks.b64      # Linux
    base64 -i rlx-upload.jks -o rlx-upload.jks.b64      # macOS

## 3. Add the four secrets (once)

Repo on GitHub, Settings, Secrets and variables, Actions, New repository secret. Add:

| Name | Value |
|---|---|
| RLX_KEYSTORE_B64 | the whole content of rlx-upload.jks.b64 (one line) |
| RLX_KEYSTORE_PASSWORD | the keystore password |
| RLX_KEY_ALIAS | rlx-upload |
| RLX_KEY_PASSWORD | the key password (the keystore password if you pressed Enter) |

Delete rlx-upload.jks.b64 afterwards. From the next run on, the workflow also builds a signed **rlx-release-aab** artifact (`app-release.aab`). Without all four secrets it builds only the debug APK, and says so in the run summary. To make a run now: Actions, android, Run workflow, branch main.

The secrets are only read by the workflow on this repo's main branch and manual runs; the keystore is written to the runner's temp folder and deleted at the end of the job.

## 4. Play Console (only you can do this)

1. Create a Google Play developer account (play.google.com/console; one-off registration fee and identity verification; a personal account needs a closed test before production, see step 5).
2. Create app: name **rlx**, default language English (US), Game, Free. Accept the declarations.
3. App content: privacy policy URL https://apcanario.github.io/4rk4d3/privacy-policy.html (replace CONTACT_EMAIL in privacy-policy.html and docs/play/privacy-policy.html first, commit, push); Ads: no; App access: all functionality available; Content rating: docs/play/content-rating.md; Target audience: your choice (docs/play/data-safety.md has a note); Data safety: docs/play/data-safety.md.
4. Main store listing: docs/play/listing.md, the icon, the feature graphic and the screenshots in docs/play/.
5. Testing, Closed testing: create a track, add testers (an email list), upload `app-release.aab` from the latest run, roll out. A new personal account must run a closed test with a minimum number of testers for a minimum number of days before it may apply for production; the Console shows the current numbers.
6. Then Production: create a release with the same or a newer .aab, roll out, and wait for review.

Every later update: push to main, take the new `app-release.aab` (its versionCode is the run number, so it always goes up), upload it to a track.

## 5. Build locally (optional)

Needs Node 22, JDK 21 and the Android SDK (platform 36, build tools).

    node tools/build-www.mjs
    cd android-app && npm ci && npx cap sync android
    cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk

A signed bundle locally: set RLX_KEYSTORE_PATH, RLX_KEYSTORE_PASSWORD, RLX_KEY_ALIAS and RLX_KEY_PASSWORD in the shell, then `./gradlew bundleRelease`.
