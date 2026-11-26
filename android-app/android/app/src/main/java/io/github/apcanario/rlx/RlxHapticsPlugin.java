package io.github.apcanario.rlx;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * RLX haptics (PLAN §6f): one short buzz on the device vibrator, at the
 * default amplitude. shared/haptics.js calls it as
 * window.Capacitor.Plugins.RlxHaptics.vibrate({ ms }) and keeps the shared
 * rules (always on, at most one call per 40 ms, the games' tick lengths).
 * A native call has no tap-before-vibrate gate, unlike navigator.vibrate.
 */
@CapacitorPlugin(name = "RlxHaptics")
public class RlxHapticsPlugin extends Plugin {

    /** The longest buzz accepted; the games' ticks are 6 to 24 ms. */
    static final int MAX_MS = 100;

    private Vibrator vibrator;

    @Override
    public void load() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager == null ? null : manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        Integer requested = call.getInt("ms", 0);
        int ms = Math.min(MAX_MS, requested == null ? 0 : requested);
        JSObject result = new JSObject();
        if (ms <= 0 || vibrator == null || !vibrator.hasVibrator()) {
            result.put("sent", false);
            call.resolve(result);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(ms);
        }
        result.put("sent", true);
        call.resolve(result);
    }
}
