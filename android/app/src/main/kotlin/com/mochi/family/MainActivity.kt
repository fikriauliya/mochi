package com.mochi.family

import android.Manifest
import android.annotation.SuppressLint
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Single-activity WebView shell. Loads whatever URL the user configured
 * (e.g. `http://192.168.1.42:3000`) and grants any in-page mic / camera
 * permission requests so the speech recognition + TTS in kid mode work.
 *
 * Press the MENU key on the remote (or volume-down + back, see
 * [onKeyDown]) to open the settings dialog and change the URL.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: SharedPreferences

    /**
     * The most-recent WebView permission request that needs an OS-level
     * runtime permission first. Resolved (granted or denied) inside
     * `onRequestPermissionsResult`.
     */
    private var pendingPermissionRequest: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

        webView = findViewById(R.id.webview)
        configureWebView()

        // Keep the screen on while a kid is playing. The WebView's
        // window flag is the simplest path; no extra permission needed.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val saved = prefs.getString(KEY_URL, "") ?: ""
        if (saved.isBlank()) {
            showSettingsDialog(initialFocus = true)
        } else {
            webView.loadUrl(saved)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                android.view.View.SYSTEM_UI_FLAG_FULLSCREEN or
                android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            // Mochi serves a SPA; the WebView default cache + back stack is fine.
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = false
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleWebPermissionRequest(request) }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    val msg = error?.description?.toString() ?: "Couldn't reach Mochi."
                    showSettingsDialog(initialFocus = true, errorMessage = msg)
                }
            }
        }
    }

    /**
     * Bridge between the WebView's permission API and Android's runtime
     * permissions. The WebView itself will happily say "yes, mic is
     * granted" via `request.grant`, but Android still won't actually
     * deliver audio frames unless the OS-level RECORD_AUDIO is granted
     * to the app. So:
     *
     *   1. If the page asks for audio capture and the OS permission
     *      isn't held yet, stash the WebView request and ask the OS.
     *   2. When the OS user grants/denies, resolve the stashed request.
     *   3. If the page asks for something we don't need OS-mediation for
     *      (e.g. midi), just grant.
     */
    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val needsAudio = request.resources.any {
            it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
        }
        if (needsAudio && !hasMicPermission()) {
            pendingPermissionRequest = request
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQ_RECORD_AUDIO,
            )
            return
        }
        request.grant(request.resources)
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_RECORD_AUDIO) {
            val pending = pendingPermissionRequest
            pendingPermissionRequest = null
            if (pending == null) return
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (granted) {
                pending.grant(pending.resources)
            } else {
                pending.deny()
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        // MENU on TV remotes / hardware keyboards opens settings.
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            showSettingsDialog()
            return true
        }
        // Long-press the BACK button → settings (a hidden grown-up gesture).
        if (keyCode == KeyEvent.KEYCODE_BACK && event.isLongPress) {
            showSettingsDialog()
            return true
        }
        // BACK navigates the WebView history when possible, otherwise exits.
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun showSettingsDialog(
        initialFocus: Boolean = false,
        errorMessage: String? = null,
    ) {
        val current = prefs.getString(KEY_URL, "") ?: ""
        val input = EditText(this).apply {
            hint = "http://192.168.1.42:3000"
            setText(current)
            setSelection(text.length)
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad * 2, pad, pad * 2, 0)
            addView(input)
        }

        val builder = AlertDialog.Builder(this)
            .setTitle(getString(R.string.settings_title))
            .setMessage(
                if (errorMessage != null) {
                    getString(R.string.settings_error_prefix) + "\n\n" + errorMessage
                } else {
                    getString(R.string.settings_message)
                }
            )
            .setView(container)
            .setPositiveButton(R.string.settings_save) { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotBlank()) {
                    prefs.edit().putString(KEY_URL, newUrl).apply()
                    webView.loadUrl(newUrl)
                }
            }
            .setCancelable(!initialFocus)

        if (!initialFocus) {
            builder.setNegativeButton(R.string.settings_cancel, null)
        }

        builder.show()
    }

    companion object {
        private const val PREFS = "mochi"
        private const val KEY_URL = "server_url"
        private const val REQ_RECORD_AUDIO = 1001
    }
}
