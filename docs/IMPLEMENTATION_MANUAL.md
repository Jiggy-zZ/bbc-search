# BBC Search 实现手册（AI Coding Action Manual）

> 项目：`Jiggy-zZ/bbc-search`  
> 定位：AI Coding 练手项目  
> MVP 语料：*The Big Bang Theory* 少量剧集  
> 核心闭环：**关键词搜索 → 双语台词结果 → 对应短视频播放 → 分享素材页**

---

## 0. 开发原则

本项目优先级：

1. 先跑通完整闭环
2. 数据结构稳定
3. 部署成本尽量接近 $0
4. 减少运维组件
5. AI Coding 分阶段、小步提交、可验收
6. 版权素材不进入 GitHub

### MVP 包含

- 英文/中文关键词搜索
- 搜索结果列表
- 中英双语台词
- 剧集与时间信息
- 点击结果播放对应短片段
- 独立素材页
- 分享素材页 URL
- 公网部署

### MVP 不包含

- 用户注册/登录
- 收藏、评论
- ASR / AI 翻译
- Semantic Search / Embedding
- 动态在线 FFmpeg 切片
- 在线上传电视剧并自动解析
- 全剧一次性导入
- CMS / 微服务 / Redis / Elasticsearch / Queue

---

# 1. 总体架构

```text
用户输入关键词
    ↓
Next.js Search API
    ↓
Supabase PostgreSQL
    ↓
dialogue_segments 关键词匹配
    ↓
返回台词 + 中文 + 剧集 + 时间 + clip_id
    ↓
用户点击结果
    ↓
Next.js 获取该 clip 的临时媒体 URL
    ↓
Cloudflare R2
    ↓
播放对应短 MP4
    ↓
/clip/{clip_id}
    ↓
分享稳定页面 URL
```

### 为什么不直接用 JSON

JSON 适合第一天 Demo，但会让数据与前端强耦合。剧集增加以后文件越来越大，搜索、排序、过滤、分享都会逐渐重构。因此 MVP 直接使用数据库，但保持 schema 很小。

---

# 2. 最低成本技术方案

| 组件 | 方案 | 用途 |
|---|---|---|
| Web/App | Next.js + TypeScript | UI、API、分享页面 |
| Hosting | Vercel Hobby | 公网部署 |
| Database | Supabase Postgres | 台词、剧集、片段映射 |
| Media Storage | Cloudflare R2 | 短 MP4 |
| Pipeline | Python | SRT 解析、对齐、导入 |
| Media Processing | FFmpeg | 本地视频切片 |
| Source Control | GitHub | 代码与文档 |

推荐职责：

```text
Supabase = structured data
R2       = media object storage
Vercel   = application
```

MVP 不在服务器动态 FFmpeg。原始整集只保存在本地，按台词时间离线生成短片段后上传 R2。

---

# 3. 代码架构

```text
bbc-search/
│
├─ app/
│  ├─ page.tsx                  # 搜索页
│  ├─ clip/[id]/page.tsx        # 素材分享页
│  └─ api/
│     ├─ search/route.ts        # 搜索 API
│     └─ clips/[id]/route.ts    # clip metadata + signed URL
│
├─ components/
│  ├─ SearchBox.tsx
│  ├─ SearchResultCard.tsx
│  ├─ ResultsList.tsx
│  ├─ ClipPlayer.tsx
│  ├─ SubtitleBlock.tsx
│  ├─ ShareButton.tsx
│  ├─ EmptyState.tsx
│  ├─ LoadingState.tsx
│  └─ ErrorState.tsx
│
├─ lib/
│  ├─ supabase/server.ts
│  ├─ r2/client.ts
│  ├─ r2/signed-url.ts
│  ├─ search/normalize.ts
│  ├─ search/types.ts
│  └─ env.ts
│
├─ scripts/
│  ├─ corpus/
│  │  ├─ parse_srt.py
│  │  ├─ align_subtitles.py
│  │  ├─ build_segments.py
│  │  ├─ generate_clips.py
│  │  ├─ upload_r2.py
│  │  └─ import_supabase.py
│  └─ verify_corpus.py
│
├─ data/
│  ├─ raw/                      # ignored
│  ├─ generated/                # ignored
│  └─ manifests/                # 可提交
│
├─ supabase/migrations/
│  └─ 001_initial_schema.sql
│
├─ docs/IMPLEMENTATION_MANUAL.md
├─ .env.example
├─ .gitignore
├─ README.md
└─ package.json
```

### 架构原则

- GitHub 不保存原始 MP4、SRT、generated clips、`.env` 或 API secret。
- 数据处理 pipeline 与 Web App 解耦。
- 片段文件是衍生物；事实关系保存在数据库。
- R2 中素材丢失时，可以根据本地源视频和时间戳重新生成。

---

# 4. 语料库建设

## 4.1 原始 MP4

《生活大爆炸》属于商业版权内容。练习时使用你依法拥有或获授权使用的本地媒体文件；不要把盗版下载站、绕 DRM 抓取流媒体等方式作为项目依赖。

如果项目以后作为公开 Portfolio 长期展示，建议切换到 Public Domain、Creative Commons 或自有版权素材。核心代码与架构无需变化。

## 4.2 SRT

优先使用与视频**同一来源/同一版本**的字幕。不同发行版本可能存在片头、剪辑、帧率、recap 差异，导致字幕整体偏移。

支持两种输入：

### A. 双语 SRT

```text
00:01:12,000 --> 00:01:15,000
I'm not crazy.
我没疯。
```

### B. 英文 SRT + 中文 SRT

```text
en/S01E01.srt
zh/S01E01.srt
```

第一轮只处理 `S01E01`。稳定后扩到 3–5 集。

---

# 5. 双语字幕对齐

不要假设 `en[i] == zh[i]`。

使用时间重合：

```text
overlap_duration = min(en.end, zh.end) - max(en.start, zh.start)
overlap_ratio = overlap_duration / max(en.duration, zh.duration)
```

同时计算中心时间距离：

```text
abs(en.center - zh.center)
```

MVP 候选条件：

```text
center_distance <= 2000 ms
```

优先：

1. overlap ratio 最大
2. center distance 最小

输出 `alignment_confidence`，低于阈值的记录进入人工检查。

---

# 6. 数据模型

## episodes

```sql
create table episodes (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  series text not null,
  season int not null,
  episode int not null,
  title text,
  duration_ms bigint,
  created_at timestamptz default now()
);
```

## dialogue_segments

```sql
create table dialogue_segments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id),
  start_ms bigint not null,
  end_ms bigint not null,
  speaker text,
  text_en text,
  text_zh text,
  normalized_en text,
  normalized_zh text,
  alignment_confidence numeric(4,3),
  created_at timestamptz default now()
);
```

## clips

```sql
create table clips (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid unique not null references dialogue_segments(id),
  object_key text unique not null,
  clip_start_ms bigint not null,
  clip_end_ms bigint not null,
  duration_ms bigint not null,
  status text not null default 'ready',
  created_at timestamptz default now()
);
```

R2 key 示例：

```text
tbbt/s01/e01/{segment_uuid}.mp4
```

数据库只保存 `object_key`，不保存会过期的 signed URL。

---

# 7. 视频切片

Pipeline：

```text
本地源视频
→ DialogueSegment
→ start - 1.5s / end + 2.0s
→ FFmpeg
→ 480p H.264 + AAC + faststart
→ R2
```

示例：

```bash
ffmpeg \
  -ss {start} \
  -to {end} \
  -i source.mp4 \
  -vf "scale=-2:480" \
  -c:v libx264 \
  -preset veryfast \
  -crf 28 \
  -c:a aac \
  -b:a 96k \
  -movflags +faststart \
  output.mp4
```

字幕不要烧录进视频，前端独立渲染双语文本。

---

# 8. Corpus Manifest 与验收

每集生成：

```text
data/manifests/tbbt-s01e01.json
```

示例：

```json
{
  "episode": "tbbt-s01e01",
  "segments": 287,
  "aligned": 279,
  "manual_review": 8,
  "clips_generated": 279,
  "version": 1
}
```

自动检查：

- `start_ms < end_ms`
- 时间范围不越界
- EN/ZH 至少一个非空
- segment/object key 唯一
- clip 存在且 duration > 0
- 无 orphan records

每集随机人工抽样 30 条，检查视频、字幕、时间漂移、开头结尾是否截断。

---

# 9. 搜索设计

MVP 搜索：

```text
normalized_en ILIKE '%query%'
OR normalized_zh ILIKE '%query%'
```

Normalization：

- 英文：lowercase / trim / collapse whitespace / apostrophe normalization
- 中文：trim / collapse whitespace / 可选全半角统一

API：

```http
GET /api/search?q=crazy
```

返回核心字段：

```json
{
  "query": "crazy",
  "count": 12,
  "results": [
    {
      "segmentId": "...",
      "clipId": "...",
      "episode": "S01E01",
      "speaker": "Sheldon",
      "startMs": 71200,
      "textEn": "I'm not crazy.",
      "textZh": "我没疯。"
    }
  ]
}
```

排序：完整短语 > starts-with > contains > episode > timestamp。最多返回 50 条。

后续升级：`pg_trgm` → PostgreSQL FTS → multilingual embedding。Embedding 不进入 MVP。

---

# 10. 前端交互

## 首页 `/`

- 大搜索框为第一视觉焦点
- 输入 2 个字符后开始请求
- 300ms debounce
- Enter 立即搜索
- URL 同步为 `/?q=crazy`
- 刷新后搜索词不丢失

## 结果卡

展示：

```text
S02E03 · Sheldon · 05:31

I'm not crazy. My mother had me tested.
我没疯，我妈带我检查过。

[ ▶ Play ]     [ Share ]
```

关键词高亮只发生在 UI，不修改数据库文本。

## 桌面布局

```text
┌──────── results ────────┬──── player ──────────┐
│ result 1                │      VIDEO           │
│ result 2                │                      │
│ result 3                │ English subtitle     │
│ ...                     │ 中文字幕             │
│                         │ [ Share ]            │
└─────────────────────────┴──────────────────────┘
```

移动端保持列表，点击结果后打开 bottom sheet 或 full-screen player。

---

# 11. Player

点击 Play：

1. 设置 selectedClip
2. 请求 `GET /api/clips/{clipId}`
3. Server 查数据库
4. Server 为 R2 `object_key` 生成临时 signed URL
5. 返回 metadata + `mediaUrl`
6. `<video>` 播放

建议 signed URL 有效期 10 分钟。

R2 API key 永不进入浏览器。

---

# 12. 分享

搜索状态：

```text
/?q=pizza
```

具体素材：

```text
/clip/{clipId}
```

分享按钮分享具体 clip URL，而不是搜索参数。

优先：

```js
navigator.share()
```

fallback：

```js
navigator.clipboard.writeText(location.href)
```

独立 clip 页面展示视频、EN、中文、SxxExx、speaker、返回搜索入口。

---

# 13. UI Style 与状态

风格：

- dark theme
- 中性灰背景
- 弱边框卡片
- 搜索框第一视觉焦点
- 播放器第二视觉焦点
- 不做 Netflix 海报墙
- 不做复杂渐变与装饰动画

必须实现的状态：

### Search

- initial
- typing
- loading
- results
- no results
- error

### Player

- not selected
- loading
- ready
- media error
- expired URL refresh

### Share

- sharing
- copied
- failed

---

# 14. 安全与环境变量

Supabase 与 R2 的 secret 只在 Next.js server-side 使用。

`.env.example`：

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

R2 bucket 使用 private；前端通过短期 signed GET URL 播放。

CORS 允许：

```text
http://localhost:3000
https://<vercel-domain>
```

仅开放 GET/HEAD。

---

# 15. 部署方案

## Step 1 — GitHub

提交代码、docs、migration、scripts、`.env.example`；不提交版权素材。

## Step 2 — Supabase

建立 Free project，运行 `001_initial_schema.sql`，确认三张表存在。先插入一条 fake/test 数据验证连接。

## Step 3 — Cloudflare R2

创建 private bucket `bbc-search-media`；创建 bucket scoped credentials；先上传自制测试 MP4，验证 signed URL 播放，再上传练习语料。

## Step 4 — Vercel

Import GitHub repo，设置所需环境变量并部署 Next.js。

## Step 5 — R2 CORS

加入最终 Vercel domain，再做搜索 → 播放 → 分享 smoke test。

## Step 6 — Corpus Import

```text
prepare local video/subtitle
→ parse
→ align
→ review
→ generate clips
→ upload R2
→ import DB
→ verify
```

真实 Corpus 最后导入。

---

# 16. MVP 开发 Phase

## Phase 0 — Bootstrap

实现 Next.js、TypeScript、ESLint、基础目录、`.gitignore`、`.env.example`。

DoD：`npm install`、`npm run dev`、`npm run lint`、`npm run build` 全部通过。

## Phase 1 — Infrastructure Contract

实现 Supabase migration/client、R2 client、`/api/health`、环境变量校验。

## Phase 2 — Corpus Parser

实现 `parse_srt.py`、`align_subtitles.py`、`build_segments.py`，只支持 S01E01。测试 UTF-8、多行字幕、timestamp、punctuation、alignment、invalid cue。

## Phase 3 — Clip Generator

实现 `generate_clips.py`，随机抽样检查 30 段。

## Phase 4 — Upload + Import

实现 `upload_r2.py`、`import_supabase.py`，必须 idempotent、duplicate-safe、支持 dry-run。

## Phase 5 — Search API

实现 EN/ZH keyword matching、normalization、ranking、limit、errors。

## Phase 6 — Search UI

实现 SearchBox、ResultsList、ResultCard、URL query state、Loading/Empty/Error。

## Phase 7 — Player

实现 `GET /api/clips/{id}`、ClipPlayer、SubtitleBlock。

## Phase 8 — Share

实现 `/clip/[id]` 与 ShareButton。

## Phase 9 — Deployment

完成 Vercel、Supabase、R2、CORS、production env vars 与 smoke test。

开发顺序：

```text
0 Bootstrap
↓
1 Infrastructure
↓
2 ONE episode corpus parser
↓
人工验收
↓
3 clip generation
↓
4 upload/import
↓
5 search API
↓
6 UI
↓
7 player
↓
8 share
↓
9 deployment
↓
扩到 3–5 episodes
```

---

# 17. Codex 协作规则

每次只做一个 Phase。

标准 Prompt：

```text
You are implementing Phase X of bbc-search.

Read first:
- docs/IMPLEMENTATION_MANUAL.md
- README.md
- existing code and tests

Scope:
[本 Phase]

Do not implement:
[后续 Phase]

Before coding:
1. inspect the repository
2. summarize the implementation plan
3. identify files to create/change

Then implement.

After implementation:
1. run relevant tests
2. run lint/build where applicable
3. summarize changed files
4. report assumptions
5. do not expand scope without approval
```

禁止 Codex 擅自引入：Redis、Elasticsearch、vector DB、登录、CMS、微服务、queue、Docker orchestration、在线 FFmpeg、全剧导入或“为了未来”建立复杂抽象。

原则：**有真实需求再增加复杂度。**

---

# 18. 最终 Definition of Done

用户能够：

```text
打开公网 URL
→ 搜英文或中文
→ 看到匹配双语台词
→ 知道季/集/角色/时间
→ 点击结果播放正确短片
→ 分享 clip URL
→ 另一窗口打开同一素材
```

并满足：

- GitHub 无版权媒体
- GitHub 无 secrets
- DB 与 media 解耦
- Corpus 可重建
- 单集 pipeline 可重复执行
- 部署成本接近 $0
- 后续扩充剧集不需要重构核心架构

---

# 19. 当前冻结技术决策

| 决策 | MVP |
|---|---|
| Framework | Next.js + TypeScript |
| Database | Supabase Postgres |
| Media | Cloudflare R2 |
| Search | SQL keyword search |
| Media generation | local Python + FFmpeg |
| Clip strategy | pre-generated short MP4 |
| Subtitle display | HTML UI |
| Share unit | clip ID |
| Hosting | Vercel |
| Auth | none |
| AI/embedding | not in MVP |
| Initial corpus | exactly 1 episode |

Phase 0–9 期间原则上冻结这些决策，除非真实实现证明不可行。
