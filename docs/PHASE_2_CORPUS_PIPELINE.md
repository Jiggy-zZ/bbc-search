# Phase 2 — 单集双语字幕语料 Pipeline

> 项目：`Jiggy-zZ/bbc-search`  
> 阶段目标：把一集双语 SRT 稳定转换为可供后续搜索、切片和入库使用的结构化语料。  
> 本阶段定位：练手项目，**只做一集**，优先体验完整流程，不引入不必要复杂度。

---

## 1. 冻结决策

Phase 2 采用以下已确认方案：

1. **双语 SRT 是唯一字幕主数据源。**
2. 不再提供或校验纯英文 SRT。
3. 双语中英文已经存在于同一个 SRT cue，因此**不实现独立中英字幕对齐算法**。
4. 本阶段**完全不处理 speaker**，所有记录统一为 `null`。
5. 本阶段**不访问 Supabase**。
6. 本阶段**不读取视频、不调用 FFmpeg、不生成 clip**。
7. 本阶段只处理一集，不做批量剧集框架。
8. 原始字幕与生成后的完整语料不提交 GitHub；GitHub 只提交代码、测试与不含台词正文的 manifest。

这意味着原总手册中的：

```text
parse_srt.py
align_subtitles.py
build_segments.py
```

在本阶段调整为：

```text
parse_srt.py
build_corpus.py
verify_corpus.py
```

不创建 `align_subtitles.py`。

---

# 2. 输入数据

## 2.1 视频

当前源视频为 MKV，例如：

```text
data/raw/video/tbbt-s01e01.mkv
```

**Phase 2 不读取该文件。**

它会在 Phase 3 中第一次参与处理：

```text
segments.json + MKV
→ FFmpeg
→ short MP4 clips
```

FFmpeg 可以直接读取 MKV，因此无需提前人工转 MP4。

---

## 2.2 双语 SRT

建议文件名：

```text
data/raw/subtitles/tbbt-s01e01.bilingual.srt
```

实际格式示例：

```srt
1
00:00:02,380 --> 00:00:04,840
{\fs16\an2\b0}如果一个光子打向有两个狭缝的平面
So if a photon is directed through a plane

2
00:00:04,960 --> 00:00:06,530
{\fs16\an2\b0}如果有一个狭缝可以观测到
with two slits in it and either slit is observed,
```

一个 cue 已经同时包含：

```text
sequence
timestamp
Chinese
English
```

因此它本身已经完成了双语时间对齐。

---

# 3. Phase 2 数据流

```text
bilingual SRT
    ↓
parse SRT blocks
    ↓
SubtitleCue
    ↓
clean subtitle control tags
    ↓
classify lines as Chinese / English
    ↓
merge same-language lines
    ↓
normalize text
    ↓
DialogueSegment
    ↓
segments.json
    ↓
verify corpus
    ↓
manifest.json + console review output
```

本阶段的核心产物是：

```text
SRT
→ segments.json
```

---

# 4. 本地目录约定

```text
data/
├─ raw/
│  ├─ video/
│  │  └─ tbbt-s01e01.mkv
│  │
│  └─ subtitles/
│     └─ tbbt-s01e01.bilingual.srt
│
├─ generated/
│  └─ tbbt-s01e01/
│     └─ segments.json
│
└─ manifests/
   └─ tbbt-s01e01.json
```

其中：

```text
data/raw/
data/generated/
```

继续由 `.gitignore` 忽略。

`data/manifests/` 可以提交，因为 manifest 不包含完整字幕正文。

---

# 5. 核心数据结构

## 5.1 SubtitleCue

`parse_srt.py` 的纯解析结果建议定义为：

```python
SubtitleCue(
    sequence=1,
    start_ms=2380,
    end_ms=4840,
    lines=[
        "{\\fs16\\an2\\b0}如果一个光子打向有两个狭缝的平面",
        "So if a photon is directed through a plane",
    ],
)
```

`SubtitleCue` 只描述 SRT 结构，不理解：

- 中文
- 英文
- speaker
- episode
- database

Parser 应保持纯粹。

---

## 5.2 DialogueSegment

最终生成结构建议为：

```json
{
  "sequence": 1,
  "start_ms": 2380,
  "end_ms": 4840,
  "speaker": null,
  "text_zh": "如果一个光子打向有两个狭缝的平面",
  "text_en": "So if a photon is directed through a plane",
  "normalized_zh": "如果一个光子打向有两个狭缝的平面",
  "normalized_en": "so if a photon is directed through a plane",
  "alignment_confidence": null
}
```

### 字段说明

- `sequence`：原始 SRT cue 序号，仅用于追踪和人工检查。
- `start_ms` / `end_ms`：统一使用整数毫秒。
- `speaker`：Phase 2 固定 `null`。
- `text_zh`：清理后的中文原文。
- `text_en`：清理后的英文原文。
- `normalized_zh` / `normalized_en`：后续搜索使用。
- `alignment_confidence`：固定 `null`，因为没有运行 alignment 算法。

### 为什么 Phase 2 不生成 UUID

UUID 属于数据库实体身份。

Phase 2 是：

```text
source transformation
```

而不是：

```text
database ingestion
```

数据库 ID 留到后续 import 阶段处理。

---

# 6. 时间处理

SRT：

```text
00:00:02,380
```

统一转换为：

```text
2380
```

内部不要同时维护：

```text
timestamp string
seconds float
milliseconds int
```

只使用整数毫秒作为事实口径。

## 时间校验

每个 cue 必须满足：

```text
start_ms >= 0
end_ms > start_ms
```

非法时间应明确报错，而不是静默跳过。

---

# 7. 字幕样式标签清理

实际字幕含：

```text
{\fs16\an2\b0}
```

这是 ASS/SSA 风格 override tag，不属于台词。

输入：

```text
{\fs16\an2\b0}如果一个光子打向有两个狭缝的平面
```

输出：

```text
如果一个光子打向有两个狭缝的平面
```

Phase 2 只实现当前真实需要的简单规则：

```text
删除 {...} 形式的字幕控制块
```

不建立完整 ASS/SSA parser。

如果后续真实数据出现新的格式，再针对实际情况扩展。

---

# 8. 中英文拆分

不要硬编码：

```text
第一行 = 中文
第二行 = 英文
```

因为同一语言未来可能因为字幕换行出现多行。

建议逻辑：

```text
逐行清理
↓
忽略清理后为空的行
↓
包含 CJK 字符 → Chinese
否则主要为 Latin / punctuation → English
↓
同语言多行按空格合并
```

例如：

```text
这是很长的一句中文字幕
可能被拆成两行
This is a long English subtitle
that may also wrap.
```

输出：

```json
{
  "text_zh": "这是很长的一句中文字幕 可能被拆成两行",
  "text_en": "This is a long English subtitle that may also wrap."
}
```

### 缺失语言

允许：

```text
English only
Chinese only
```

例如只有英文时：

```json
{
  "text_zh": null,
  "text_en": "Bazinga!"
}
```

但至少必须有一种语言有正文。

---

# 9. 文本 Normalization

## 9.1 English

MVP 只做：

1. trim
2. lowercase
3. 连续空白折叠为一个空格
4. 将常见 Unicode apostrophe 统一为普通 `'`

例如：

```text
Original:
So if a photon is directed through a plane

Normalized:
so if a photon is directed through a plane
```

不做：

- stemming
- lemmatization
- 去标点
- stop words
- 分词

---

## 9.2 Chinese

只做：

1. trim
2. 连续空白折叠

不做：

- 中文分词
- 简繁转换
- 拼音
- 去标点

---

# 10. `alignment_confidence`

本阶段固定：

```text
null
```

原因：中英文来自同一个双语 cue，本阶段没有执行任何 alignment 算法。

不要填写 `1.0`，避免误导后续代码认为这是算法输出的置信度。

---

# 11. `speaker`

本阶段固定：

```text
null
```

明确禁止为了补 speaker 引入：

- LLM 推断
- transcript 网站
- 声纹识别
- ASR
- 人工角色标注系统

speaker 不是当前 MVP 搜索闭环的必要条件。

---

# 12. Python 模块划分

Phase 2 只实现三个核心文件：

```text
scripts/corpus/
├─ parse_srt.py
├─ build_corpus.py
└─ verify_corpus.py
```

可根据测试组织需要增加：

```text
tests/corpus/
```

但不要扩展为大型 package/framework。

---

## 12.1 `parse_srt.py`

职责唯一：

```text
SRT text/file
→ List[SubtitleCue]
```

负责：

- UTF-8 / UTF-8 BOM
- CRLF / LF
- cue sequence
- SRT timestamp parsing
- multiline text preservation
- 明确报告 malformed block

不负责：

- 中文/英文判断
- normalization
- manifest
- database
- episode metadata

---

## 12.2 `build_corpus.py`

职责：

```text
SubtitleCue
→ clean tags
→ split languages
→ normalize
→ DialogueSegment
→ segments.json
→ manifest.json
```

建议 CLI 示例：

```bash
python scripts/corpus/build_corpus.py \
  --episode tbbt-s01e01 \
  --subtitle data/raw/subtitles/tbbt-s01e01.bilingual.srt \
  --output data/generated/tbbt-s01e01/segments.json \
  --manifest data/manifests/tbbt-s01e01.json
```

具体 CLI 参数名可以由实现合理调整，但必须保持简单、明确。

### 重复执行

在相同输入下重复执行应生成等价输出，不依赖上一次运行状态。

---

## 12.3 `verify_corpus.py`

职责：

读取 `segments.json`，执行自动校验，并提供人工抽样视图。

建议 CLI：

```bash
python scripts/corpus/verify_corpus.py \
  data/generated/tbbt-s01e01/segments.json \
  --samples 30
```

输出示意：

```text
Episode: tbbt-s01e01
Segments: 287
Bilingual: 281
English only: 4
Chinese only: 2
Invalid: 0

Random sample #142
00:08:31.420 -> 00:08:34.100
ZH: ...
EN: ...
```

随机抽样只是人工检查工具，不修改输出。

如果为了可复现测试需要，可以支持固定 random seed，但不是强制要求。

---

# 13. `segments.json`

建议顶层结构：

```json
{
  "episode": "tbbt-s01e01",
  "segments": [
    {
      "sequence": 1,
      "start_ms": 2380,
      "end_ms": 4840,
      "speaker": null,
      "text_zh": "如果一个光子打向有两个狭缝的平面",
      "text_en": "So if a photon is directed through a plane",
      "normalized_zh": "如果一个光子打向有两个狭缝的平面",
      "normalized_en": "so if a photon is directed through a plane",
      "alignment_confidence": null
    }
  ]
}
```

完整 `segments.json` 位于 `data/generated/`，不提交 GitHub。

---

# 14. Manifest

路径：

```text
data/manifests/tbbt-s01e01.json
```

Manifest 只保存统计与 pipeline 元信息，不保存完整台词。

建议：

```json
{
  "episode": "tbbt-s01e01",
  "source": {
    "type": "bilingual_srt"
  },
  "cues": 287,
  "segments": 287,
  "bilingual": 281,
  "english_only": 4,
  "chinese_only": 2,
  "invalid": 0,
  "version": 1
}
```

### Manifest 原则

- 可以提交 GitHub。
- 不包含字幕正文。
- 不包含本机绝对路径。
- 不包含 secrets。
- 数字应来自实际处理结果，不硬编码。

---

# 15. 自动校验

`verify_corpus.py` 至少检查：

1. `sequence` 存在且为正整数。
2. `start_ms >= 0`。
3. `end_ms > start_ms`。
4. `text_en` / `text_zh` 至少一个非空。
5. `normalized_en` 与 `text_en` 的存在状态一致。
6. `normalized_zh` 与 `text_zh` 的存在状态一致。
7. `speaker is null`。
8. `alignment_confidence is null`。
9. segment 数量大于 0。
10. sequence 不应意外重复。

本阶段不验证视频 duration，因为 Phase 2 不读取 MKV。

---

# 16. 测试范围

项目是练手用途，不追求大规模测试矩阵。

建议约 8–12 个有价值测试即可。

至少覆盖：

| Case | Expected |
|---|---|
| 普通单行 SRT | 正确解析 |
| 双语 cue | 正确生成 EN/ZH |
| `{\fs16...}` | 控制标签被移除 |
| 多行中文 | 正确合并 |
| 多行英文 | 正确合并 |
| UTF-8 BOM | 正常读取 |
| CRLF | 正常读取 |
| LF | 正常读取 |
| malformed timestamp | 明确失败 |
| `end <= start` | 明确失败 |
| English only | 允许生成 |
| Chinese only | 允许生成 |

测试 fixture 必须是自制的极短样例，不提交真实影视字幕片段。

---

# 17. Error Handling

原则：

> 数据结构错误要显式失败；合法但不完整的数据可以继续。

### 应失败

- timestamp 无法解析
- end <= start
- cue 完全没有文本
- JSON 输出不可写

### 可继续并计入统计

- English only
- Chinese only
- cue 内有额外空白行
- cue 含可清理的字幕 style tag

不要为了“尽量跑完”静默吞掉 malformed cue。

---

# 18. 本阶段禁止事项

Codex 不得在 Phase 2 擅自：

- 连接 Supabase
- 写入数据库
- 调用 Cloudflare R2
- 读取 MKV
- 调用 FFmpeg
- 创建 clip
- 推断 speaker
- 引入 LLM
- 引入 embedding
- 引入语言检测模型
- 实现复杂字幕 alignment
- 支持多剧集批处理框架
- 为未来设计插件系统
- 将真实 SRT 或 `segments.json` 提交 GitHub

原则：

> 当前源数据没有的问题，不提前制造解决方案。

---

# 19. Phase 2 Definition of Done

Phase 2 完成必须满足：

- [ ] 双语 SRT 能完整解析。
- [ ] timestamp 被统一转换为整数毫秒。
- [ ] `{...}` 字幕控制标签能清除。
- [ ] 中英文能从同一个 cue 正确拆出。
- [ ] 同语言多行能正确合并。
- [ ] `speaker` 始终为 `null`。
- [ ] `alignment_confidence` 始终为 `null`。
- [ ] normalization 符合本文件规则。
- [ ] 能生成 `data/generated/tbbt-s01e01/segments.json`。
- [ ] 能生成不含台词正文的 manifest。
- [ ] `verify_corpus.py` 能完成自动校验并输出抽样内容。
- [ ] 测试覆盖核心 parser / cleaning / language split / validation 情况。
- [ ] 所有自动测试通过。
- [ ] 人工随机检查约 30 条，未发现明显拆分或时间解析问题。
- [ ] 真实字幕文件和生成语料没有被 Git 跟踪。

---

# 20. Phase 2 完成后的边界

完成后我们应该拥有：

```text
tbbt-s01e01.bilingual.srt
        ↓
      Phase 2
        ↓
segments.json
```

但此时仍然**没有**：

- database rows
- R2 objects
- video clips
- searchable web UI

下一阶段 Phase 3 才处理：

```text
segments.json
+
tbbt-s01e01.mkv
↓
FFmpeg
↓
short MP4 clips
```

---

# 21. Codex 执行 Prompt

建议模型：**GPT-5.6 Sol**  
建议 reasoning：**Medium**。如果在实际字幕格式上出现异常，再提高到 High 排查，不需要默认 High。

```text
You are implementing Phase 2 of bbc-search.

Read first:
- docs/IMPLEMENTATION_MANUAL.md
- docs/PHASE_2_CORPUS_PIPELINE.md
- AGENTS.md
- the current repository code

The Phase 2 execution contract in docs/PHASE_2_CORPUS_PIPELINE.md is authoritative when it narrows or supersedes the older general Phase 2 description in IMPLEMENTATION_MANUAL.md.

Goal:
Implement a minimal single-episode bilingual SRT -> structured corpus pipeline.

Important frozen decisions:
- The bilingual SRT is the only subtitle source.
- Do not implement EN/ZH subtitle alignment.
- Do not use a separate English SRT.
- speaker must always be null.
- alignment_confidence must always be null.
- Do not touch Supabase, R2, MKV, FFmpeg, or clip generation in this phase.
- Only one episode is in scope.

Before coding:
1. Inspect the repository and existing ignores/tests/configuration.
2. Summarize your concrete implementation plan.
3. List files you will create or modify.
4. Call out any conflict between the repository and PHASE_2_CORPUS_PIPELINE.md before changing code.

Implement only Phase 2.

Expected core modules:
- scripts/corpus/parse_srt.py
- scripts/corpus/build_corpus.py
- scripts/corpus/verify_corpus.py
- focused tests/fixtures as needed

Requirements:
- Parse standard SRT into cues.
- Convert timestamps to integer milliseconds.
- Remove {...} subtitle override/control blocks.
- Split cleaned lines into Chinese vs English using a simple deterministic CJK-based rule.
- Merge multiple lines of the same language.
- Normalize text only as specified in the execution contract.
- Generate segments.json locally under ignored data/generated/.
- Generate a manifest without subtitle text.
- Provide corpus validation and optional random sample display.
- Fail clearly on malformed structural data.
- Keep dependencies minimal; prefer Python standard library when practical.
- Do not commit copyrighted subtitle content as test fixtures. Use synthetic fixtures.

After implementation:
1. Run all new Python tests.
2. Run existing npm lint/build to ensure the web project was not broken.
3. Demonstrate the CLI using synthetic fixture data if the real local SRT is unavailable to you.
4. Confirm generated/raw media paths remain ignored by Git.
5. Summarize changed files.
6. Report assumptions and anything that still requires manual testing with the real SRT.
7. Do not implement Phase 3.
```
