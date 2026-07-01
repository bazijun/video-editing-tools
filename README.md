# ShotCompare Demo

ShotCompare 是一个本地优先的视频相似分镜对比工具 Demo。它帮助剪辑师把视觉相似的镜头放到同一个对比视图里，减少反复拖时间线、来回记镜头的成本。

当前版本已经可以：

- 在浏览器或 Electron 桌面壳里运行。
- 本地选择多个视频或一个素材文件夹。
- 不上传视频，不修改原始视频。
- 使用 `<video>` 和 `<canvas>` 在本机采样画面。
- 使用 `blockhash` 做第一版感知哈希匹配。
- 自动拆粗略分镜，并生成固定滑动窗口片段。
- 把相似片段聚类成分组。
- 在对比区同步播放多个候选镜头。
- 在对比区和相似区之间移动片段。
- 复制片段时间码。
- Electron 版本支持把对比区片段拖拽到外部素材系统，例如剪映/CapCut。

## 为什么做这个 Demo

现在要验证的核心痛点不是“AI 自动剪辑”，而是剪辑师经常需要从大量相似素材里找更合适的一条：同一个动作、同一个构图、同一个产品展示、同一个表情，但每条的状态略有差异。

ShotCompare 的目标是把这些候选镜头并排放出来，让剪辑师靠对比做选择，而不是靠记忆来回翻时间线。

## 本地开发

先安装依赖：

```bash
pnpm install
```

启动浏览器 Demo：

```bash
pnpm dev:vite
```

然后打开终端输出的地址，通常是：

```text
http://127.0.0.1:5173
```

如果只需要无打包依赖的备用静态服务，也可以运行：

```bash
pnpm dev
```

备用服务可以打开页面，但 npm 版感知哈希引擎主要通过 Vite 打包使用。

## Electron 开发

启动桌面开发模式：

```bash
pnpm electron:dev
```

这个命令会先启动 Vite，再打开 Electron 窗口。

Electron 版本会通过 preload bridge 登记导入视频的真实本地路径。对比区里的片段拖拽到外部软件时，主进程会尝试用 FFmpeg 生成临时 MP4 片段，然后把这个临时文件交给系统拖拽会话。原始视频始终只读。

## 后续怎么打包

打包前先确认依赖已经安装：

```bash
pnpm install
```

建议先跑一次检查：

```bash
pnpm test
pnpm check
pnpm build
```

### 打 Windows 安装包

生成 Windows x64 安装包：

```bash
pnpm build
pnpm exec electron-builder --win --x64
```

构建完成后，产物会在 `release/` 目录下：

```text
release/ShotCompare-0.1.0-win-x64.exe
release/ShotCompare-0.1.0-win-x64.zip
release/win-unpacked/
```

其中：

- `ShotCompare-0.1.0-win-x64.exe` 是可以直接发给别人下载、双击安装的 Windows 安装包。
- `ShotCompare-0.1.0-win-x64.zip` 是免安装压缩包。
- `win-unpacked/` 是解包后的应用目录，主要用于本地检查，不建议直接发给用户。

### 打当前系统的完整分发包

如果只想按 `package.json` 里的平台配置打包：

```bash
pnpm dist:electron
```

当前配置会输出到：

```text
release/
```

### 只生成可运行目录

如果只是想快速生成一个本机可运行的打包目录，不需要安装器：

```bash
pnpm package:electron
```

这个命令会执行：

```bash
pnpm build && electron-builder --dir
```

## 打包命名在哪里改

打包命名集中放在 `package.json` 顶部和 `build.artifactName`：

```json
{
  "name": "shotcompare",
  "productName": "ShotCompare",
  "version": "0.1.0",
  "description": "Local-first desktop tool for finding and comparing visually similar video shots.",
  "author": "ShotCompare",
  "build": {
    "appId": "com.shotcompare.app",
    "artifactName": "${productName}-${version}-${os}-${arch}.${ext}"
  }
}
```

常改的字段：

- `productName`：安装包和应用显示名，例如 `ShotCompare`。
- `version`：版本号，例如 `0.1.1`。
- `description`：应用描述。
- `author`：作者或团队名。
- `build.appId`：应用 ID，正式发布前应保持稳定。
- `build.artifactName`：产物文件名规则。

例如版本号改成 `0.1.1` 后，Windows x64 安装包会变成：

```text
release/ShotCompare-0.1.1-win-x64.exe
```

## Windows 安装包注意事项

当前 Windows 包还没有正式代码签名证书。用户第一次安装时，Windows SmartScreen 可能会提示“无法确认发布者”或类似警告。

后续如果要正式发给更多用户，建议补：

- Windows 代码签名证书。
- 正式应用图标。
- 更新 `author`、`description`、`appId` 等发布信息。

## FFmpeg 注意事项

项目使用 `ffmpeg-static` 来生成拖拽用的临时视频片段。

主进程查找 FFmpeg 的顺序是：

1. 环境变量 `SHOTCOMPARE_FFMPEG_PATH`
2. `ffmpeg-static`
3. 系统 PATH 里的 `ffmpeg`

如果某台机器上 FFmpeg 不可用，对比区拖拽会回退为拖出原始视频文件，并在状态栏提示。原始视频仍然不会被修改。

## 常用检查命令

```bash
pnpm test
pnpm check
pnpm build
```

含义：

- `pnpm test`：运行 Node 测试。
- `pnpm check`：检查脚本语法。
- `pnpm build`：构建浏览器端资源。

## 当前限制

- 浏览器版拿不到视频的绝对本地路径，只能使用文件名和相对路径。
- 浏览器版的视频解码能力取决于当前浏览器支持的格式。
- Electron 版可以生成拖拽用临时片段，但还不直接修改剪映/CapCut 草稿。
- 不使用 AI。
- 不上传素材。
- `blockhash` 只是第一版相似度基线，不是最终视觉算法。

后续桌面版可以继续评估：

- FFmpeg 场景检测。
- OpenCV / OpenCV.js。
- 更稳定的代理帧缓存。
- SQLite 素材索引。
- 在非 AI 流程验证有效之后，再考虑 CLIP 或其他 embedding 模型。

## 剪映/CapCut 使用流程

1. 选择本地视频或素材文件夹。
2. 等待本机分析完成。
3. 选择一个相似分组。
4. 在对比区同步播放多个候选镜头。
5. 把不合适的镜头移回相似区。
6. 复制时间码，或在 Electron 版里把对比区片段拖到剪映/CapCut 的素材区。
7. 在剪映/CapCut 中继续完成剪辑。

