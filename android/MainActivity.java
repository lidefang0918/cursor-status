package com.my.cursorstatus;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.Handler;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

// 全屏常亮 WebView，加载电脑上的状态页；音量+ 重置地址
public class MainActivity extends Activity {
    private SharedPreferences sp;
    private WebView web;
    private final Handler handler = new Handler();
    private final Runnable hideBars = new Runnable() {
        public void run() { applyFullscreen(); }
    };
    private final Runnable pushBattery = new Runnable() {
        public void run() {
            injectBattery();
            handler.postDelayed(this, 30000); // 每 30 秒推一次电量
        }
    };
    private final BroadcastReceiver batteryRx = new BroadcastReceiver() {
        public void onReceive(Context c, Intent i) { injectBattery(); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // 系统栏被划出后，立刻再藏回去（电纸屏上 IMMERSIVE_STICKY 不一定可靠）
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(new View.OnSystemUiVisibilityChangeListener() {
            public void onSystemUiVisibilityChange(int v) {
                if ((v & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                    handler.removeCallbacks(hideBars);
                    handler.postDelayed(hideBars, 800);
                }
            }
        });
        registerReceiver(batteryRx, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        sp = getSharedPreferences("cfg", MODE_PRIVATE);
        String url = sp.getString("url", null);
        if (url == null) showInput(); else showWeb(url);
    }

    private void applyFullscreen() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void injectBattery() {
        if (web == null) return;
        Intent i = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int level = i != null ? i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) : -1;
        int scale = i != null ? i.getIntExtra(BatteryManager.EXTRA_SCALE, 100) : 100;
        if (level < 0 || scale <= 0) return;
        final int pct = Math.round(level * 100f / scale);
        web.post(new Runnable() {
            public void run() {
                web.evaluateJavascript("window.__setBattery && window.__setBattery(" + pct + ")", null);
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreen();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyFullscreen();
        injectBattery();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(hideBars);
        handler.removeCallbacks(pushBattery);
        try { unregisterReceiver(batteryRx); } catch (Exception ignored) {}
        super.onDestroy();
    }

    private void showInput() {
        web = null;
        handler.removeCallbacks(pushBattery);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(40, 80, 40, 40);
        final EditText et = new EditText(this);
        et.setHint("http://电脑局域网IP:8787");
        et.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        Button ok = new Button(this);
        ok.setText("连接");
        ok.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                String u = et.getText().toString().trim();
                if (u.length() == 0) return;
                sp.edit().putString("url", u).apply();
                showWeb(u);
            }
        });
        box.addView(et);
        box.addView(ok);
        setContentView(box);
        applyFullscreen();
    }

    private void showWeb(final String url) {
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.setBackgroundColor(0xFFFFFFFF);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView v, String u) { injectBattery(); }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) handler.postDelayed(new Runnable() {
                    public void run() { web.loadUrl(url); }
                }, 5000); // 电脑未开机时每 5 秒重试
            }
        });
        setContentView(web);
        applyFullscreen();
        web.loadUrl(url);
        handler.removeCallbacks(pushBattery);
        handler.postDelayed(pushBattery, 30000);
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_VOLUME_UP) {
            sp.edit().remove("url").apply();
            showInput();
            return true;
        }
        return super.onKeyDown(code, e);
    }
}
