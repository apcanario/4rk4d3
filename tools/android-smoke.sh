#!/bin/bash
# rlx app smoke test on an emulator (PLAN §6f; run by .github/workflows/android.yml):
# install the debug APK, open the hub, tap the Stack card, tap to drop a block
# (a native vibration), back to the hub, back out of the app. Screenshots,
# logcat and the vibrator log go to the output folder; tools/android-smoke-check.py
# judges them. Not part of the app.
set -u
APK=${1:?apk}
OUT=${2:?out}
PKG=io.github.apcanario.rlx
mkdir -p "$OUT"
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
resumed() { adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -1 | tr -d '\r'; }

# The emulator's own dialogs would sit over the app and take the taps: Android's one-time
# "Viewing full screen" note for immersive apps, and "isn't responding" dialogs of a launcher
# still settling after boot. Neither is part of the app.
adb shell settings put secure immersive_mode_confirmations confirmed
adb shell settings put global hide_error_dialogs 1
adb shell input keyevent KEYCODE_HOME
sleep 20
adb shell wm size > "$OUT/wm-size.txt"
adb shell wm density >> "$OUT/wm-size.txt"
adb install -r "$APK" || exit 1
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity > "$OUT/start.txt"
sleep 15
shot 1-hub
echo "after start: $(resumed)" > "$OUT/activity.txt"

# Card centres for a 1080 x 2400 screen at 420 dpi (411 x 914 CSS px, scale 7, offset 67):
# Stack (logical 100, 285), Bricks (34, 201). Scaled if the screen differs.
read W H < <(adb shell wm size | tail -1 | sed 's/.*: //; s/x/ /' | tr -d '\r')
sx() { echo $(( $1 * W / 1080 )); }
sy() { echo $(( $1 * H / 2400 )); }
adb shell input tap $(sx 767) $(sy 1995)
sleep 4
shot 2-stack
adb shell input tap $(sx 540) $(sy 1200)
sleep 1
adb shell input tap $(sx 540) $(sy 1200)
sleep 2
shot 3-stack-dropped
adb shell dumpsys vibrator_manager > "$OUT/vibrator.txt" 2>&1
echo "in game: $(resumed)" >> "$OUT/activity.txt"

adb shell input keyevent KEYCODE_BACK
sleep 3
shot 4-hub-after-back
echo "after one back: $(resumed)" >> "$OUT/activity.txt"

adb shell input tap $(sx 305) $(sy 1407)
sleep 4
shot 5-bricks
adb shell input keyevent KEYCODE_BACK
sleep 3
shot 6-hub-after-back
echo "after bricks and back: $(resumed)" >> "$OUT/activity.txt"

adb shell input keyevent KEYCODE_BACK
sleep 3
shot 7-after-second-back
echo "after back at the hub: $(resumed)" >> "$OUT/activity.txt"

adb logcat -d > "$OUT/logcat.txt"
cat "$OUT/activity.txt"
python3 tools/android-smoke-check.py "$OUT"
