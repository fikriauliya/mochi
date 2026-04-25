# Add project specific ProGuard rules here.
# Default rules are inherited from proguard-android-optimize.txt.

# WebView's JS bridge needs the annotation kept.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
