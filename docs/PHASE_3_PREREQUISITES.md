# Phase 3 前置准备：生成 `segments.json` 与安装 FFmpeg

> 适用项目：`Jiggy-zZ/bbc-search`  
> 适用环境：Windows  
> 目标：在开始 Phase 3 视频切片前，准备好真实 `segments.json`，并确保本机可以直接调用 `ffmpeg` / `ffprobe`。

---

# 1. Phase 3 现在缺什么？

Phase 3 需要两个真实输入：

```text
data/raw/video/tbbt-s01e01.mkv
data/generated/tbbt-s01e01/segments.json
```

其中：

- `tbbt-s01e01.mkv`：你已经准备好的原始视频
- `segments.json`：必须先由 Phase 2 脚本根据双语 SRT 生成

Phase 3 还依赖本机命令：

```text
ffmpeg
ffprobe
```

这两个工具不属于 npm/Python 项目依赖，必须安装在 Windows 本机。

---

# 2. 确认原始文件位置

建议目录：

```text
data/
└─ raw/
   ├─ video/
   │  └─ tbbt-s01e01.mkv
   │
   └─ subtitles/
      └─ tbbt-s01e01.bilingual.srt
```

确认文件实际存在。

在项目根目录 PowerShell 中可以运行：

```powershell
Test-Path .\data\raw\video\tbbt-s01e01.mkv
Test-Path .\data\raw\subtitles\tbbt-s01e01.bilingual.srt
```

两个命令都应返回：

```text
True
```

如果返回 `False`，先检查文件名或目录位置。

---

# 3. 用 Phase 2 脚本生成真实 `segments.json`

当前仓库已有：

```text
scripts/corpus/build_corpus.py
scripts/corpus/verify_corpus.py
```

`build_corpus.py` 会读取双语 SRT，并生成：

```text
data/generated/tbbt-s01e01/segments.json
```

同时建议生成 manifest：

```text
data/manifests/tbbt-s01e01.json
```

## 3.1 执行 build

在项目根目录运行：

```powershell
python .\scripts\corpus\build_corpus.py `
  --episode tbbt-s01e01 `
  --subtitle .\data\raw\subtitles\tbbt-s01e01.bilingual.srt `
  --output .\data\generated\tbbt-s01e01\segments.json `
  --manifest .\data\manifests\tbbt-s01e01.json
```

> PowerShell 中反引号 `` ` `` 表示换行续写。你也可以把命令写成一整行。

单行版：

```powershell
python .\scripts\corpus\build_corpus.py --episode tbbt-s01e01 --subtitle .\data\raw\subtitles\tbbt-s01e01.bilingual.srt --output .\data\generated\tbbt-s01e01\segments.json --manifest .\data\manifests\tbbt-s01e01.json
```

成功后会看到类似：

```text
Built 300 segments for tbbt-s01e01 (... bilingual, ... English only, ... Chinese only).
```

实际数字以你的字幕为准。

---

# 4. 验证 `segments.json`

先确认文件已经生成：

```powershell
Test-Path .\data\generated\tbbt-s01e01\segments.json
```

应返回：

```text
True
```

然后运行 Phase 2 验证脚本：

```powershell
python .\scripts\corpus\verify_corpus.py .\data\generated\tbbt-s01e01\segments.json --samples 10
```

预期看到：

```text
Episode: tbbt-s01e01
Segments: ...
Bilingual: ...
English only: ...
Chinese only: ...
Invalid: 0
```

最重要的是：

```text
Invalid: 0
```

同时检查打印出来的随机样本：

- 时间戳合理
- 中文正确
- 英文正确
- 没有残留类似 `{\fs16\an2\b0}` 的控制标签

如果这里失败，先不要进入 Phase 3。

---

# 5. 安装 FFmpeg / FFprobe

## 推荐方式：Windows `winget`

Windows Package Manager 当前有 `Gyan.FFmpeg` 包，并同时提供：

```text
ffmpeg
ffprobe
ffplay
```

在 PowerShell 中运行：

```powershell
winget install --id Gyan.FFmpeg -e
```

安装结束后，**关闭当前 PowerShell / Terminal，再重新打开一个新的窗口**。

这是因为 PATH/命令别名通常需要新的 shell 会话才能生效。

---

# 6. 验证 FFmpeg 安装

打开新的 PowerShell，运行：

```powershell
ffmpeg -version
```

然后：

```powershell
ffprobe -version
```

只要两个命令都能输出版本信息，就说明 Phase 3 所需工具已经可用。

也可以运行：

```powershell
Get-Command ffmpeg
Get-Command ffprobe
```

应该能看到实际命令位置。

---

# 7. 如果 `winget` 安装后仍提示“无法识别 ffmpeg”

按下面顺序检查。

## 7.1 先重开终端

不要只在原窗口重试。

完全关闭：

- PowerShell
- Windows Terminal
- VS Code integrated terminal

然后重新打开。

## 7.2 检查 winget 是否认为 FFmpeg 已安装

```powershell
winget list --id Gyan.FFmpeg
```

如果能看到 `Gyan.FFmpeg`，说明程序已经安装，只是当前 shell 没识别 PATH/alias。

## 7.3 重新安装

必要时：

```powershell
winget uninstall --id Gyan.FFmpeg -e
winget install --id Gyan.FFmpeg -e
```

然后再次重开 Terminal。

---

# 8. 验证 FFmpeg 能读取你的 MKV

安装完成后，不要马上全量切片。

先运行：

```powershell
ffprobe .\data\raw\video\tbbt-s01e01.mkv
```

正常情况会输出视频信息，包括：

- container: Matroska / MKV
- duration
- video stream
- audio stream

只要没有类似：

```text
No such file or directory
Invalid data found when processing input
```

就说明 MKV 能被正常读取。

---

# 9. Phase 3 开始前最终检查

依次运行：

```powershell
Test-Path .\data\raw\video\tbbt-s01e01.mkv
Test-Path .\data\raw\subtitles\tbbt-s01e01.bilingual.srt
Test-Path .\data\generated\tbbt-s01e01\segments.json
ffmpeg -version
ffprobe -version
```

前三个 `Test-Path` 都应该为：

```text
True
```

`ffmpeg` 和 `ffprobe` 都应该打印版本信息。

然后再次运行：

```powershell
python .\scripts\corpus\verify_corpus.py .\data\generated\tbbt-s01e01\segments.json --samples 10
```

确保：

```text
Invalid: 0
```

满足以上条件后，才进入 Phase 3 的 `--limit 5` 试切片。

---

# 10. 不需要做的事情

当前阶段不要：

- 把 MKV 转成完整 MP4
- 把视频上传 R2
- 把 `segments.json` 手工编辑出来
- 把 `segments.json` 提交 GitHub
- 把视频或字幕提交 GitHub
- 重新实现 Phase 2
- 安装 Docker
- 安装独立媒体服务器

正确顺序只有：

```text
双语 SRT
↓
Phase 2 build_corpus.py
↓
segments.json

Windows
↓
安装 FFmpeg
↓
ffmpeg / ffprobe 可用

以上两项完成
↓
Phase 3 --limit 5
```

---

# 11. Checklist

在告诉 Codex 继续 Phase 3 前确认：

- [ ] `data/raw/video/tbbt-s01e01.mkv` 存在
- [ ] `data/raw/subtitles/tbbt-s01e01.bilingual.srt` 存在
- [ ] 已运行 `build_corpus.py`
- [ ] `data/generated/tbbt-s01e01/segments.json` 已生成
- [ ] `verify_corpus.py` 返回 `Invalid: 0`
- [ ] 已安装 FFmpeg
- [ ] `ffmpeg -version` 正常
- [ ] `ffprobe -version` 正常
- [ ] `ffprobe` 可以读取真实 MKV

全部完成后即可执行 Phase 3。
