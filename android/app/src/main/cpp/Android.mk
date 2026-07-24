# Out-of-band ndk-build for the JNI bridge (scripts/build-bridge.sh).
# RN New Arch owns the gradle CMake pipeline — wiring this into gradle
# externalNativeBuild collides with it ([CXX1400]), so the bridge builds
# out-of-band and lands in jniLibs/ as a plain packaged .so.
#
# M1': single new libchat (MLS/address). The bridge links against liblogoschat.so
# (soname), which NEEDs liblogosdelivery.so, which NEEDs librln.so + libc++_shared.so.
# We declare all of them as prebuilts so the linker can resolve liblogoschat's
# transitive NEEDED at link time. At runtime NodeBridge.load() loads them in
# dependency order: c++_shared -> rln -> logosdelivery -> logoschat -> bridge.
LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)
LOCAL_MODULE := logoschat_ccshared
LOCAL_SRC_FILES := ../jniLibs/$(TARGET_ARCH_ABI)/libc++_shared.so
include $(PREBUILT_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := rln
LOCAL_SRC_FILES := ../jniLibs/$(TARGET_ARCH_ABI)/librln.so
include $(PREBUILT_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := logosdelivery
LOCAL_SRC_FILES := ../jniLibs/$(TARGET_ARCH_ABI)/liblogosdelivery.so
include $(PREBUILT_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := logoschat
LOCAL_SRC_FILES := ../jniLibs/$(TARGET_ARCH_ABI)/liblogoschat.so
include $(PREBUILT_SHARED_LIBRARY)

# The bridge
include $(CLEAR_VARS)
LOCAL_MODULE := logoschat_bridge
LOCAL_SRC_FILES := logoschat_jni.c
LOCAL_C_INCLUDES := $(LOCAL_PATH)/include
LOCAL_LDLIBS := -llog -ldl
LOCAL_SHARED_LIBRARIES := logoschat logosdelivery rln logoschat_ccshared
# liblogoschat only re-exports its own logoschat_* symbols; its transitive libs
# are resolved via the prebuilts above. Tolerate any residual shlib-undefined.
LOCAL_LDFLAGS := -Wl,--allow-shlib-undefined
include $(BUILD_SHARED_LIBRARY)
