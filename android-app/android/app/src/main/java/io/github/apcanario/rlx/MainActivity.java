package io.github.apcanario.rlx;

import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

/**
 * RLX (PLAN §6f): the hub and games from the bundled files, immersive full
 * screen, and the back gesture: inside a game it goes back in the WebView
 * (the hub's history entry, which removes the game frame as on the web); at
 * the hub there is no entry left, so back falls through to Android and the
 * app goes away. Row D1 (PLAN §6g): the theme follows the phone's night mode
 * (styles.xml, values-night); the WebView reports it to the pages through
 * prefers-color-scheme and never darkens a page by itself.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this); // flat sky colour, no icon, no text (styles.xml)
        registerPlugin(RlxHapticsPlugin.class);
        super.onCreate(savedInstanceState);
        immersive();
        nightColours();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge == null ? null : bridge.getWebView();
                if (debuggable() && web != null) {
                    WebBackForwardList list = web.copyBackForwardList();
                    Log.d("RLX", "back: canGoBack=" + web.canGoBack() + " index=" + list.getCurrentIndex() + " size=" + list.getSize() + " url=" + web.getUrl());
                }
                if (web != null && web.canGoBack()) {
                    web.goBack(); // a game is open: back to the hub
                    return;
                }
                // At the hub: let Android do what back does at an app's root (leave the app).
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        immersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    /**
     * Row D1: the phone switched between light and dark while RLX is open. The activity is not recreated
     * (uiMode is in configChanges, so a game keeps its state): the theme is rebased on the new night mode,
     * so the WebView's prefers-color-scheme can follow it, and the window colour behind the insets follows.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) getTheme().rebase();
        nightColours();
    }

    /** The sky colour of the current mode behind everything; no algorithmic darkening of the pages. */
    private void nightColours() {
        int sky = ContextCompat.getColor(this, R.color.rlx_sky);
        getWindow().getDecorView().setBackgroundColor(sky);
        WebView web = bridge == null ? null : bridge.getWebView();
        if (web == null) return;
        web.setBackgroundColor(sky);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.getSettings(), false);
        }
    }

    /** Debug builds only: the back decisions go to logcat (tag RLX) for the CI smoke test. */
    private boolean debuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** Edge to edge, status and navigation bars hidden; a swipe from an edge shows them for a moment. */
    private void immersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}
