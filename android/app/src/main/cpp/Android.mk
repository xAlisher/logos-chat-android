# Out-of-band ndk-build for the JNI bridge (scripts/build-bridge.sh).
# RN New Arch owns the gradle CMake pipeline — wiring this into gradle
# externalNativeBuild collides with it ([CXX1400]), so the bridge builds
# out-of-band and lands in jniLibs/ as a plain packaged .so.
LOCAL_PATH := $(call my-dir)

# Prebuilt liblogoschat.so (vendored from logos-libchat-android, lives in jniLibs/)
include $(CLEAR_VARS)
LOCAL_MODULE := logoschat
LOCAL_SRC_FILES := ../jniLibs/$(TARGET_ARCH_ABI)/liblogoschat.so
include $(PREBUILT_SHARED_LIBRARY)

# The bridge
include $(CLEAR_VARS)
LOCAL_MODULE := logoschat_bridge
LOCAL_SRC_FILES := logoschat_jni.c
LOCAL_C_INCLUDES := $(LOCAL_PATH)/include
LOCAL_LDLIBS := -llog
LOCAL_SHARED_LIBRARIES := logoschat
include $(BUILD_SHARED_LIBRARY)
