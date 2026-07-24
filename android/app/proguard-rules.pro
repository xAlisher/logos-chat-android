# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- logos-chat native bridge (#28) ---------------------------------------
# JNI binds by fully-qualified name: Java_com_logoschat_NodeBridge_* resolves
# against these classes at runtime, and the callback + result types are only
# ever referenced from C. R8 must not rename or strip any of them.
-keep class com.logoschat.NodeBridge { *; }
-keep class com.logoschat.EventCallbackManager { *; }
# The service is started by name from the manifest and re-created by the system
# after process death (START_STICKY).
-keep class com.logoschat.ChatService { *; }
-keepclassmembers class com.logoschat.MainActivity {
    public static long consumeLaunchConvoPk();
}
