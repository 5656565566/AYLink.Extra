# Termux terminal-emulator 0.118.0

来源：[termux/termux-app v0.118.0](https://github.com/termux/termux-app/tree/v0.118.0/terminal-emulator)。
固定提交：`6e2689f55295fa444be8ac8592c527c2c5ef3253`。

`src/main/java`、`src/main/jni` 和 `src/test/java` 原样保留上游内容。许可证及例外说明保留在 `LICENSE.md` 和源文件中。

本地构建配置替换了上游 Gradle 配置：使用项目 AGP、NDK `28.2.13676358`，并显式设置 16KB 的最大页大小和公共页大小。Manifest 的原 package 声明改由 Gradle namespace 提供。

应用继续使用固定的 `terminal-view:0.118.0`，排除它传递引入的旧 emulator AAR，改为依赖此模块，避免打包两份 `libtermux.so`。

升级时需核对 Java API、JNI 导出符号及选择菜单 ID，并验证 emulator 测试、应用测试、release APK/AAB 对齐和 Android 运行行为。
