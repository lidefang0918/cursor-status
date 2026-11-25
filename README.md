# cursor-status

把 Cursor 的会话状态、今日 token 和账号额度显示在同一局域网的手机上。页面按电纸屏设计：黑白、无动画、左右翻页。

支持 macOS 和 Windows。电脑上要已经登录 Cursor。登录 token 解密后只留在内存里，不写文件，也不发给手机。服务没有鉴权，只应在可信局域网使用。

## 卡片

1. **今日会话**：每个会话一行，含状态、步数、工作时长、今日 token。完成后点屏幕任意位置确认。
2. **今日与趋势**：今日 token，以及近 7 天柱状图。
3. **额度消耗**：Cursor 模型、其他模型的月额度，以及 Grok Bot 周额度。
4. **连接与设备**：电脑在线、手机电量。

## 安装扩展

从 [Releases](https://github.com/lidefang0918/cursor-status/releases) 下载 `.vsix`。在 Cursor 里打开命令面板，运行 **Extensions: Install from VSIX...**，选这个文件。

Cursor 启动后会自动拉起服务，状态栏出现「Cursor 状态」，点一下用浏览器打开。扩展只在 8787 没人占用时启动；你另外跑的 `node server.js` 会继续用，Cursor 退出时也不会被关掉。

扩展会把 hook 写进 `~/.cursor/hooks.json`，只替换自己的条目。Windows 第一次监听端口时，如果系统询问防火墙，允许专用网络。

## 单独启动

需要 Node.js 22 或更新版本。扩展不依赖系统里的 Node，这条路径才需要。

```bash
node server.js
```

浏览器打开 `http://127.0.0.1:8787`。手机用电脑的局域网地址，例如 `http://192.168.1.10:8787`。

把下面几项追加到 `~/.cursor/hooks.json` 的 `hooks` 里（路径改成你的检出目录），不要覆盖已有 hook。图形界面启动的 Cursor 不一定找得到 `node`，所以更省事的办法是装上面的扩展。

```json
"beforeSubmitPrompt": [{ "command": "node /path/to/cursor-status/hook.js prompt" }],
"preToolUse": [{ "command": "node /path/to/cursor-status/hook.js" }],
"stop": [{ "command": "node /path/to/cursor-status/hook.js" }]
```

会话数据在 `~/.cursor-status/sessions.json`，可用环境变量 `CURSOR_STATUS_HOME` 改目录。

## 手机

Release 里的 `cursor-status.apk` 是常亮全屏页面。用调试签名，手机需允许未知来源。首次打开填电脑地址；音量加键可重新输入。

也可以不装 APK，手机浏览器直接打开服务地址。装了扩展或把 APK 放在 `build/cursor-status.apk` 时，页面地址加上 `/app.apk` 可以下载。

在 macOS 上重新打包 APK 需要 Android SDK（`build-tools`、`platforms/android-35`）和 JDK 17，然后执行 `./build.sh`。

## 数据来源

- 会话进度来自 Cursor hooks。
- token 和额度来自 Cursor 网页与客户端正在使用的接口，不是官方公开 API，字段以后可能变化。解析集中在 `usage.js`。
- macOS 从钥匙串解开登录态。Windows 用当前用户的 DPAPI 解开 `%APPDATA%\Cursor\Local State` 里的密钥，再解密本地数据库里的 token。

## 不提交的内容

`data/` 是旧的本机会话状态，`build/` 是打包产物，`.vsix` 是扩展安装包，都已忽略。
