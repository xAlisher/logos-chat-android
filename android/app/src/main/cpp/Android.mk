# Out-of-band ndk-build for the JNI bridge (scripts/build-bridge.sh).
# RN New Arch owns the gradle CMake pipeline — wiring this into gradle
# externalNativeBuild collides with it ([CXX1400]), so the bridge builds
# out-of-band and lands in jniLibs/ as a plain packaged .so.
LOCAL_PATH := $(call my-dir)

# Prebuilt liblogoschat — DUAL-BINARY (#51). We ship two variants under distinct
# file names but a SHARED soname `liblogoschat.so`; the bridge links against the
# STANDARD one here purely to satisfy link-time symbol resolution + record
# DT_NEEDED=liblogoschat.so (the soname). At runtime NodeBridge.load() System.load's
# whichever variant by absolute path; its soname satisfies the bridge's NEEDED.
# The bridge references NO mix-only symbol (chat_get_mix_status is dlsym'd), so it
# links cleanly against the standard variant which lacks it.
include $(CLEAR_VARS)
LOCAL_MODULE := logoschat
LOCAL_SRC_FILES := ../jniLibs/$(TARGET_ARCH_ABI)/liblogoschat_std.so
include $(PREBUILT_SHARED_LIBRARY)

# The bridge
include $(CLEAR_VARS)
LOCAL_MODULE := logoschat_bridge
LOCAL_SRC_FILES := logoschat_jni.c
LOCAL_C_INCLUDES := $(LOCAL_PATH)/include
LOCAL_LDLIBS := -llog -ldl
LOCAL_SHARED_LIBRARIES := logoschat
include $(BUILD_SHARED_LIBRARY)
