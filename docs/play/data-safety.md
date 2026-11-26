# rlx: Data safety form answers

Play Console, Policy and programs, App content, Data safety. Answers for the app as built (PLAN §2, §6f): it collects nothing, stores nothing, has no network permission, no SDKs, no ads, no accounts.

## Data collection and security

- Does your app collect or share any of the required user data types? **No.**
  (Play then skips the data-type questions.)
- Is all of the user data collected by your app encrypted in transit? Not asked once the answer above is No. If shown: not applicable, no data is collected or sent.
- Do you provide a way for users to request that their data is deleted? Not asked once the answer above is No. If shown: not applicable, no data is collected.

## Other declarations in App content (same place)

- Ads: **No, my app does not contain ads.**
- Advertising ID (asked of apps that target API 33 or higher): **No, my app does not use an advertising ID.** The app has no ads or analytics SDK and does not declare the com.google.android.gms.permission.AD_ID permission.
- App access: **All functionality is available without special access** (no login).
- Government app: No. Financial features: None. Health: No health features.
- In-app purchases: none (the app is free with nothing to buy).
- Target audience and content: choose the age groups Pedro wants. If any group under 13 is chosen, the Families policy applies; the app has no ads, no data collection and no external links, which that policy asks for. 18 and over or 13 and over is the simplest choice.
- News app: No.

## Why these answers are true

- Permissions in the merged manifest: VIBRATE only (tests/check.py and the CI build check it). No INTERNET permission, so the app cannot send anything.
- No third-party SDK: the app is Capacitor's WebView shell and its own plugin; no analytics, crash reporting, ads or login library.
- No game data or personal data stored: the games write nothing to storage (PLAN §2; tests/check.py checks storage is empty after play). Capacitor and the system WebView keep their own technical files (the last installed binary version, the WebView cache); they hold no user data and nothing leaves the device, so the answer stays No. Android's backup is off (allowBackup false).
