package fr.manustream.radio;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String PUBLIC_URL = "https://cauctomanu-dotcom.github.io/Manu-Stream-Radio/";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadsImagesAutomatically(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccess(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new RadioBridge(), "AndroidRadio");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && (host.equals("cauctomanu-dotcom.github.io") || host.endsWith("supabase.co") || host.equals("esm.sh"))) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectPlaybackBridge();
            }
        });

        webView.loadUrl(PUBLIC_URL);
    }

    private void injectPlaybackBridge() {
        if (webView == null) return;
        String js = "(function(){"
                + "if(window.__msrAndroidHook){return;}window.__msrAndroidHook=true;"
                + "function hook(){var b=document.getElementById('listenLiveBtn');"
                + "if(!b){setTimeout(hook,500);return;}"
                + "b.addEventListener('click',function(){setTimeout(function(){"
                + "try{if(b.classList.contains('active')){AndroidRadio.onPlaybackStarted();}else{AndroidRadio.onPlaybackStopped();}}catch(e){}"
                + "},150);});}hook();"
                + "})();";
        webView.evaluateJavascript(js, null);
    }

    private void startRadioKeepAlive() {
        Intent i = new Intent(this, RadioKeepAliveService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
    }

    private void stopRadioKeepAlive() {
        stopService(new Intent(this, RadioKeepAliveService.class));
    }

    public class RadioBridge {
        @JavascriptInterface
        public void onPlaybackStarted() {
            runOnUiThread(() -> startRadioKeepAlive());
        }

        @JavascriptInterface
        public void onPlaybackStopped() {
            runOnUiThread(() -> stopRadioKeepAlive());
        }
    }

    @Override
    protected void onPause() {
        // Intentionally do NOT call webView.onPause(): audio must keep running in background.
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }
}
