# Phase 1 — Infrastructure Contract

> 项目：`Jiggy-zZ/bbc-search`  
> 阶段目标：建立稳定、最小、可测试的基础设施边界，为后续 Corpus、Search、Player 提供可靠依赖。  
> 推荐模型：GPT-5.6 Sol  
> 推荐 reasoning：Medium

---

## 0. 本阶段定位

Phase 1 只负责：

- Supabase PostgreSQL schema / migration
- Supabase server-side client
- Cloudflare R2 server-side client
- 环境变量校验
- `/api/health`
- 最小基础设施测试

Phase 1 **不负责**：

- 真实字幕导入
- 真实视频上传
- 搜索 API
- Corpus Parser
- FFmpeg
- UI 搜索功能
- Player
- Share
- 用户登录
- 后台管理

原则：

> 本阶段只验证“应用能安全、稳定地连接基础设施”，不提前实现业务逻辑。

---

# 1. Phase 0 前置清理

在进入本阶段业务实现前，先清理 Phase 0 中误提交的本地 Obsidian 配置。

删除：

```text
.obsidian/
```

并在 `.gitignore` 增加：

```gitignore
.obsidian/
```

理由：

- `.obsidian/workspace.json` 等属于本地编辑器状态
- 与产品代码无关
- 容易产生无意义 diff
- 不应成为项目运行依赖

该清理可和 Phase 1 一并提交。

---

# 2. 本阶段最终目录目标

Phase 1 完成后，至少应存在：

```text
bbc-search/
│
├─ app/
│  └─ api/
│     └─ health/
│        └─ route.ts
│
├─ lib/
│  ├─ env.ts
│  │
│  ├─ supabase/
│  │  └─ server.ts
│  │
│  └─ r2/
│     └─ client.ts
│
├─ supabase/
│  └─ migrations/
│     └─ 001_initial_schema.sql
│
├─ tests/                      # 若采用独立测试目录
│  └─ ...
│
├─ .env.example
├─ .gitignore
└─ docs/
   ├─ IMPLEMENTATION_MANUAL.md
   └─ PHASE_1_INFRASTRUCTURE.md
```

可以根据测试框架调整测试文件位置，但不要改变业务目录边界。

---

# 3. 环境变量 Contract

`.env.example` 当前字段：

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Phase 1 要建立统一的环境变量读取入口：

```text
lib/env.ts
```

业务代码禁止散落：

```ts
process.env.XYZ
```

应统一从 env module 获取。

## 3.1 分类

### Server-only secret

```text
SUPABASE_SERVICE_ROLE_KEY
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

这些值：

- 永远不得进入客户端 bundle
- 不得出现在 API response
- 不得打印完整值到 log
- 不得使用 `NEXT_PUBLIC_` 前缀

### Server-side non-secret / config

```text
SUPABASE_URL
R2_ACCOUNT_ID
R2_BUCKET_NAME
```

虽然部分值本身不敏感，但为了保持接口简单，本阶段仍通过 server-side config 使用。

### Public config

```text
NEXT_PUBLIC_APP_URL
```

允许前端读取。

---

# 4. 环境变量校验要求

建议使用轻量 schema validation，例如：

```text
zod
```

如果 Codex 判断无需额外依赖，也可以自行实现明确校验，但必须满足：

1. 应用启动或相关 server module 首次加载时发现缺失配置
2. 报错必须明确指出缺失字段名
3. 不得在错误信息中输出 secret 的实际值
4. production 环境不允许 silent fallback
5. test 环境允许通过 mock / injected env 运行

示例错误：

```text
Missing required environment variable: R2_BUCKET_NAME
```

不要：

```text
R2_SECRET_ACCESS_KEY=abc123 is invalid
```

---

# 5. Supabase Contract

## 5.1 Client 文件

```text
lib/supabase/server.ts
```

职责：

- 创建 server-side Supabase client
- 读取统一 env config
- 只供 server-side route / server module 使用

不要在 Phase 1 创建 browser client。

## 5.2 使用 Service Role 的原因

MVP 当前没有用户 Auth，也不让浏览器直接访问数据库。

数据访问链路：

```text
Browser
  ↓
Next.js API / Server
  ↓
Supabase
```

因此 Service Role Key 只存在服务端。

## 5.3 Server-only 防护

建议对 server-only module 使用 Next.js 的 server-only 边界，例如：

```ts
import "server-only";
```

目标：防止后续误把 secret client import 到 Client Component。

---

# 6. Initial Database Schema

创建：

```text
supabase/migrations/001_initial_schema.sql
```

本阶段建立三个核心实体：

```text
episodes
dialogue_segments
clips
```

---

## 6.1 episodes

```sql
create table episodes (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  series text not null,
  season int not null,
  episode int not null,
  title text,
  duration_ms bigint,
  created_at timestamptz not null default now()
);
```

补充约束建议：

```sql
check (season > 0)
check (episode > 0)
check (duration_ms is null or duration_ms > 0)
```

`slug` 示例：

```text
tbbt-s01e01
```

---

## 6.2 dialogue_segments

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

  created_at timestamptz not null default now()
);
```

必须增加：

```sql
check (start_ms >= 0)
check (end_ms > start_ms)
check (text_en is not null or text_zh is not null)
check (
  alignment_confidence is null
  or (alignment_confidence >= 0 and alignment_confidence <= 1)
)
```

### Phase 1 不创建复杂搜索索引

本阶段最多只创建明显必要的基础索引：

```sql
create index ... on dialogue_segments (episode_id);
```

不要提前加入：

- pg_trgm
- full text search
- embedding
- vector index

这些属于 Phase 5 或以后。

---

## 6.3 clips

```sql
create table clips (
  id uuid primary key default gen_random_uuid(),

  segment_id uuid unique not null
    references dialogue_segments(id),

  object_key text unique not null,

  clip_start_ms bigint not null,
  clip_end_ms bigint not null,

  duration_ms bigint not null,

  status text not null default 'ready',

  created_at timestamptz not null default now()
);
```

必须增加：

```sql
check (clip_start_ms >= 0)
check (clip_end_ms > clip_start_ms)
check (duration_ms > 0)
```

`status` MVP 建议限制为：

```text
ready
missing
error
```

实现方式可选：

- check constraint
- PostgreSQL enum

优先简单，不建立复杂状态机。

---

# 7. Foreign Key 删除策略

Phase 1 必须明确，不允许依赖数据库默认行为后再猜。

推荐：

```text
episode
  ↓ owns
dialogue_segments
  ↓ owns
clips
```

因此开发/语料重建场景下建议：

```sql
references episodes(id) on delete cascade
references dialogue_segments(id) on delete cascade
```

理由：

Corpus 是可重建数据。

如果删除一集：

```text
episode
→ segments
→ clip metadata
```

应该一起删除。

注意：

数据库 cascade **不会自动删除 R2 object**。

R2 清理属于以后 ingestion / maintenance 流程，不在 Phase 1 实现。

---

# 8. R2 Client Contract

创建：

```text
lib/r2/client.ts
```

Cloudflare R2 使用 S3-compatible API。

推荐依赖：

```text
@aws-sdk/client-s3
```

client 需要配置：

```text
endpoint:
https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com

region:
auto

credentials:
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

## 本阶段只做 client

Phase 1 不实现：

- upload helper
- delete helper
- signed media URL endpoint
- media player

这些放到后续 Phase。

但可以提供一个最小内部 probe，用于 health check。

---

# 9. `/api/health` Contract

建立：

```text
GET /api/health
```

目的：

验证运行环境和基础设施状态。

建议响应：

```json
{
  "status": "ok",
  "services": {
    "app": "ok",
    "database": "ok",
    "storage": "ok"
  }
}
```

若服务异常：

```json
{
  "status": "degraded",
  "services": {
    "app": "ok",
    "database": "error",
    "storage": "ok"
  }
}
```

HTTP 状态建议：

```text
200 → all infrastructure checks OK
503 → any required infrastructure check failed
```

---

# 10. Health Check 必须做什么

## App

只要 route 正常运行：

```text
app = ok
```

## Database

执行一个最小、无副作用请求。

例如：

```sql
select id from episodes limit 1
```

空表也必须算健康。

健康的判断是：

```text
query executed successfully
```

不是：

```text
query returned row
```

## R2

使用低成本、无副作用操作。

优先：

```text
HeadBucket
```

或等价 bucket access probe。

不要：

- 上传测试对象
- 删除对象
- list 全 bucket

---

# 11. Health API 安全要求

响应不得返回：

- Supabase URL（非必要）
- Service Role Key
- R2 Account ID
- Access Key
- Secret Key
- Bucket 内对象名称
- raw provider error stack

生产环境返回概括状态即可。

Server log 可以记录有限错误信息，但也不得包含 secret。

示例：

```text
R2 health check failed: AccessDenied
```

而不是完整 credentials / request headers。

---

# 12. 错误处理边界

不要做全局复杂 error framework。

Phase 1 只需要：

```text
configuration error
provider connection error
health response mapping
```

错误信息必须：

- 对开发者可定位
- 对客户端不过度暴露内部细节

---

# 13. 测试策略

Phase 1 需要最小自动测试。

Codex 可以根据当前 Next.js 版本选择合适测试工具，但不要引入沉重 E2E stack。

推荐：

```text
Vitest
```

如果当前环境已有更自然方案，也可以使用。

---

## 13.1 env tests

至少测试：

```text
valid env → parse success
missing required env → explicit failure
secret value → never appears in error
```

---

## 13.2 health response tests

至少测试：

```text
DB OK + R2 OK → 200 / status ok
DB fail → 503 / degraded
R2 fail → 503 / degraded
both fail → 503 / degraded
```

外部 provider 应 mock。

单元测试不得依赖真实 Supabase/R2 网络连接。

---

# 14. Manual Integration Check

自动测试之外，需要一次人工真实连接验证。

使用你自己的：

```text
Supabase Free project
Cloudflare R2 bucket
```

步骤：

1. 配置 `.env.local`
2. 在 Supabase 执行 `001_initial_schema.sql`
3. 确认三张表创建成功
4. 创建 private R2 bucket
5. 配置 bucket-scoped credentials
6. 启动 `npm run dev`
7. 访问：

```text
http://localhost:3000/api/health
```

预期：

```json
{
  "status": "ok",
  "services": {
    "app": "ok",
    "database": "ok",
    "storage": "ok"
  }
}
```

这一部分需要真实账号配置，Codex 不能替你创建或猜 secret。

---

# 15. Dependencies 边界

Phase 1 可以合理增加：

```text
@supabase/supabase-js
@aws-sdk/client-s3
zod               # optional but recommended
server-only
vitest             # if tests use it
```

禁止因为 Phase 1 引入：

- Prisma
- Drizzle
- Redis
- Elasticsearch
- pgvector client
- Docker Compose
- Terraform
- Pulumi
- queue
- auth library

数据库当前只有三个简单实体，直接维护 SQL migration 足够。

---

# 16. SQL Migration 原则

`001_initial_schema.sql` 必须：

- 可以在空数据库完整执行
- schema 明确
- constraint 明确
- 不包含测试数据
- 不包含真实 TBBT 数据
- 不包含 secrets

Phase 1 不要求复杂 rollback migration。

开发中如 schema 需要修改：

如果 `001` 尚未进入真实 Corpus 使用，可以在 Phase 1 内修正；

Phase 1 冻结后，后续修改应新建：

```text
002_*.sql
003_*.sql
```

不要持续重写历史 migration。

---

# 17. Phase 1 Server Boundary

必须保持：

```text
Client Component
    X
    X cannot import
    ↓
Supabase Service Role client
R2 credential client
```

允许：

```text
Route Handler
Server Component
Server-only module
    ↓
Infrastructure clients
```

如果 Codex 为了方便把 provider secret 暴露成 `NEXT_PUBLIC_*`：

**直接判定 Phase 1 不通过。**

---

# 18. Logging 原则

Phase 1 只使用简单 logging。

允许：

```ts
console.error(...)
```

不需要引入 logging platform。

不得 log：

- `.env` 全量
- secret
- authorization headers
- signed credentials

---

# 19. Phase 1 不做 Repository Pattern

不要建立：

```text
DatabaseRepository
StorageRepository
InfrastructureFactory
ProviderAdapterFactory
```

目前只有一个数据库和一个对象存储。

直接：

```text
lib/supabase/server.ts
lib/r2/client.ts
```

即可。

未来真实出现第二 provider，再抽象。

---

# 20. Phase 1 Definition of Done

全部满足才算完成。

## Repository

- [ ] `.obsidian/` 已删除
- [ ] `.obsidian/` 已加入 `.gitignore`
- [ ] 无 secret 提交 Git

## Environment

- [ ] `lib/env.ts` 存在
- [ ] required env 缺失时明确失败
- [ ] secret 不进入 client bundle

## Database

- [ ] `001_initial_schema.sql` 存在
- [ ] episodes 创建成功
- [ ] dialogue_segments 创建成功
- [ ] clips 创建成功
- [ ] FK / check constraints 正确
- [ ] 删除 cascade 策略明确

## Supabase

- [ ] server-only client 存在
- [ ] 不存在 browser service-role client

## R2

- [ ] server-only R2 client 存在
- [ ] credentials 不暴露

## Health

- [ ] `/api/health` 存在
- [ ] DB probe 正常
- [ ] R2 probe 正常
- [ ] provider fail 返回 503
- [ ] response 不泄露内部 credential

## Quality

- [ ] tests 通过
- [ ] `npm run lint` 通过
- [ ] `npm run build` 通过
- [ ] manual `/api/health` integration check 通过

---

# 21. 推荐 Commit 边界

可以一个 Phase 一个 commit：

```text
feat: establish infrastructure contract
```

也可以拆成：

```text
chore: remove local editor state
feat: add database infrastructure
feat: add r2 infrastructure
feat: add health endpoint
```

对于当前练手项目，优先简单；一个清晰 Phase commit 即可。

---

# 22. Codex 执行 Prompt

直接将下面内容交给 Codex：

```text
Implement Phase 1 — Infrastructure Contract for bbc-search.

Read first:
- docs/IMPLEMENTATION_MANUAL.md
- docs/PHASE_1_INFRASTRUCTURE.md
- README.md
- AGENTS.md
- the current repository code

Treat PHASE_1_INFRASTRUCTURE.md as the execution contract for this phase.

Before coding:
1. inspect the current repository and Phase 0 output
2. summarize the implementation plan
3. list files to create/change/delete
4. call out any conflict between the current repo and the Phase 1 contract

Then implement Phase 1 only.

Important boundaries:
- remove committed .obsidian local state and ignore it
- keep Supabase Service Role and R2 credentials server-only
- create the initial SQL migration
- create minimal Supabase and R2 clients
- implement environment validation
- implement GET /api/health
- add focused automated tests
- do not implement corpus parsing, upload/import, search, UI, player, share, auth, ORM, Redis, queue, Docker, or embeddings
- do not add abstractions for hypothetical future providers

After implementation:
1. run tests
2. run npm run lint
3. run npm run build
4. summarize files changed
5. explain any assumptions
6. explicitly report anything that still requires Jiggy to configure manually in Supabase or Cloudflare R2

Do not expand scope without approval.
```

---

# 23. 本阶段人工参与点

Phase 1 中只有以下事项需要 Jiggy 本人操作或确认：

```text
1. 创建 / 选择 Supabase project
2. 执行 migration
3. 创建 R2 bucket
4. 创建 bucket-scoped R2 credentials
5. 将真实值写入本地 .env.local
6. 最终访问 /api/health 做真实集成验证
```

这些 credential 不应发送给 Codex，也不应提交 GitHub。

---

# 24. Phase 1 完成后的冻结结果

Phase 1 结束时，我们只要求证明：

```text
Next.js
   ↓
server-only infrastructure layer
   ├── Supabase reachable
   └── R2 reachable
```

此时系统中甚至可以：

```text
0 episodes
0 dialogue segments
0 clips
```

这完全正常。

真实语料从 Phase 2 开始进入系统。
