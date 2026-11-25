#!/bin/sh
# 命令行打包 APK（无 gradle）。输出 build/cursor-status.apk
set -e
cd "$(dirname "$0")"
SDK=$HOME/Library/Android/sdk
BT=$SDK/build-tools/36.1.0
JAR=$SDK/platforms/android-35/android.jar
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
rm -rf build && mkdir -p build/classes
$BT/aapt2 link -o build/base.apk -I "$JAR" --manifest android/AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 28 --version-code 1 --version-name 1.0
"$JAVA_HOME/bin/javac" -source 8 -target 8 -cp "$JAR" -d build/classes android/MainActivity.java
$BT/d8 --lib "$JAR" --min-api 24 --output build build/classes/com/my/cursorstatus/*.class
(cd build && zip -q -j base.apk classes.dex)
$BT/zipalign -f 4 build/base.apk build/aligned.apk
$BT/apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android --out build/cursor-status.apk build/aligned.apk
echo build/cursor-status.apk
