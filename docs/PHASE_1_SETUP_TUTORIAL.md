# Phase 1 外部服务配置教程

> 适用项目：`Jiggy-zZ/bbc-search`  
> 适用阶段：Phase 1 — Infrastructure Contract 完成后  
> 目标读者：第一次接触 Supabase、Cloudflare R2、环境变量和本地 health check

---

# 0. 你最终要完成什么

Phase 1 的代码已经写好了，但它现在还不知道：

- 去哪个 Supabase 项目访问数据库
- 去哪个 Cloudflare R2 bucket 访问视频素材
- 用什么凭证访问这两个服务

你需要手动完成 4 件事：

```text
1. 创建 Supabase project
2. 在 Supabase 执行项目 migration
3. 创建 private Cloudflare R2 bucket + bucket-scoped credentials
4. 把真实配置写进本地 .env.local，然后运行 /api/health
```

完成后，访问：

```text
http://localhost:3000/api/health
```

理想结果：

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

---

# 1. 开始前：确认本地项目已更新

在项目目录执行：

```bash
git pull
```

然后确认至少存在这些文件：

```text
.env.example
supabase/migrations/001_initial_schema.sql
lib/supabase/server.ts
lib/r2/client.ts
app/api/health/route.ts
```

如果你使用 VS Code / Cursor，可以直接在左侧文件树确认。

---

# 2. 创建 Supabase Project

官网：

<https://supabase.com/>

## 2.1 注册 / 登录

打开 Supabase，使用 GitHub 或其他方式登录。

进入 Dashboard 后：

```text
New project
```

如果页面要求先创建 Organization，可以先建立一个免费的个人 Organization。

---

## 2.2 创建项目

建议填写：

```text
Project name: bbc-search
Database password: 自己生成一个强密码并保存
Region: 选择离你较近的区域
Plan: Free
```

### Database password 是什么？

这是 PostgreSQL 数据库管理员密码。

当前 BBC Search 的 Web App 不直接使用这个密码，但以后如果使用数据库 CLI / 管理工具可能会需要。

因此：

> 保存到密码管理器，不要写进 GitHub。

创建项目后等待 Supabase 完成初始化。

---

# 3. 在 Supabase 执行 migration

项目已经有 migration：

```text
supabase/migrations/001_initial_schema.sql
```

它会创建：

```text
episodes
dialogue_segments
clips
```

三张表。

## 3.1 打开 SQL Editor

进入你的 Supabase project。

左侧菜单找到：

```text
SQL Editor
```

选择：

```text
New query
```

---

## 3.2 复制 migration 内容

本地打开：

```text
supabase/migrations/001_initial_schema.sql
```

复制文件的**全部内容**。

不要自己逐张表手工创建，也不要修改字段。

把全部 SQL 粘贴进 Supabase SQL Editor。

---

## 3.3 执行 SQL

点击：

```text
Run
```

如果成功，SQL Editor 不应出现红色错误。

然后打开左侧：

```text
Table Editor
```

应该能看到：

```text
episodes
dialogue_segments
clips
```

到这里数据库结构就建立好了。

### 注意

这个项目目前以仓库里的 migration 文件为 schema 的事实来源。

后面如果要修改数据库结构：

> 不要直接在 Supabase Table Editor 随意改字段。

应该先创建新的 migration，再执行 migration，避免“远端数据库”和 GitHub 中的 schema 不一致。

---

# 4. 获取 Supabase URL 和 Secret Key

当前项目需要：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## 4.1 获取 Project URL

在 Supabase project 中可以通过：

```text
Connect
```

或者：

```text
Settings → API Keys
```

找到 Project URL。

通常类似：

```text
https://abcdefghijk.supabase.co
```

它对应：

```text
SUPABASE_URL
```

---

## 4.2 获取 Secret Key

Supabase 目前正在从旧的：

```text
anon
service_role
```

迁移到新的：

```text
publishable key
secret key
```

BBC Search 的 Phase 1 代码变量名仍然叫：

```text
SUPABASE_SERVICE_ROLE_KEY
```

但是你**优先使用新的 Secret key**：

```text
sb_secret_...
```

把它填进：

```text
SUPABASE_SERVICE_ROLE_KEY
```

即可。

这里“环境变量名字”暂时保留旧名字，只是为了不修改 Phase 1 已冻结的代码 contract；真正填入的凭证使用 Supabase 当前推荐的 Secret key。

### 在哪里找？

进入：

```text
Settings → API Keys
```

找到：

```text
Secret key
```

如果项目只显示旧 key，可以根据 Dashboard 提示创建新的 Publishable / Secret keys。

### 极重要

`sb_secret_...` 属于服务器最高权限凭证。

禁止：

```text
发给别人
截图公开
提交 GitHub
写进 README
写进前端 NEXT_PUBLIC_* 变量
```

如果 Secret key 泄露，应立即在 Supabase Dashboard 中创建新 key 并撤销旧 key。

Supabase 官方文档：

<https://supabase.com/docs/guides/getting-started/api-keys>

---

# 5. 创建 Cloudflare R2

Cloudflare R2 是本项目未来保存短视频 clip 的对象存储。

官网：

<https://dash.cloudflare.com/>

如果没有 Cloudflare 账号，先注册。

---

# 6. 开通 R2

进入 Cloudflare Dashboard。

找到：

```text
Storage & databases → R2
```

第一次使用 R2 时，Cloudflare 可能要求先激活 R2 / 添加 billing information。

这不代表一定产生费用。

R2 Standard 有免费额度，但 Cloudflare 当前可能仍要求先完成 R2 开通流程后才能创建 API credentials。

请在确认 Cloudflare 页面显示的价格/免费额度后再继续。

---

# 7. 创建 private R2 bucket

进入：

```text
R2 → Overview
```

点击：

```text
Create bucket
```

建议 bucket 名：

```text
bbc-search-media
```

建议：

```text
Storage class: Standard
Location: Automatic / 默认
```

创建即可。

### Private 是不是需要额外设置？

R2 bucket 默认不是公网公开的。

因此：

> 不要开启 Public Development URL，也不要绑定公开 custom domain。

只要保持 Public Access 未开启，就满足本项目的 private bucket 需求。

项目以后会通过后端生成临时 signed URL 给浏览器播放，而不是把整个 bucket 公开。

Cloudflare 官方文档：

<https://developers.cloudflare.com/r2/buckets/create-buckets/>

---

# 8. 获取 R2 Account ID

BBC Search 需要：

```text
R2_ACCOUNT_ID
```

在 R2 Overview / Account Details 中可以看到 Account ID。

它通常是一串字符，例如：

```text
0123456789abcdef0123456789abcdef
```

R2 的 S3 endpoint 最终形如：

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

项目代码会自己拼这个 URL，所以 `.env.local` 里只需要填 Account ID，不要填完整 endpoint。

---

# 9. 创建 bucket-scoped R2 credentials

这是最关键的一步。

你需要生成：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

## 9.1 打开 R2 API Tokens

在：

```text
R2 → Overview
```

找到 Account Details 附近的：

```text
API Tokens / Manage
```

Cloudflare 当前可能显示：

```text
Create Account API token
```

或：

```text
Create User API token
```

个人练手项目二者都可以。

如果没有特殊需求，使用当前 Dashboard 推荐给你的标准 R2 API token 流程即可。

---

## 9.2 设置权限

权限选择：

```text
Object Read & Write
```

不要给整个账户所有 bucket 权限。

找到 bucket scope：

```text
Apply to specific buckets only
```

只选择：

```text
bbc-search-media
```

这就是：

> bucket-scoped credentials

即使凭证意外泄露，它能访问的范围也被限制在这个 bucket，而不是整个 Cloudflare R2 账户。

### 为什么需要 Read & Write？

当前 `/api/health` 主要检查 bucket 是否可访问；后面的 corpus pipeline 还需要：

```text
上传 clip
读取 clip
```

所以先用 Object Read & Write。

---

## 9.3 创建并复制 credentials

创建 token 后 Cloudflare 会显示：

```text
Access Key ID
Secret Access Key
```

分别对应：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

### 极重要

Cloudflare 通常只会显示一次 Secret Access Key。

因此创建完成后立刻复制并安全保存。

不要把：

```text
API Token 字符串
Access Key ID
Secret Access Key
```

混淆。

BBC Search 使用的是 S3-compatible credentials：

```text
Access Key ID
Secret Access Key
```

Cloudflare 官方文档：

<https://developers.cloudflare.com/r2/api/tokens/>

---

# 10. 创建 `.env.local`

现在回到本地项目目录。

项目根目录已经有：

```text
.env.example
```

它只是字段模板，不放真实 secret。

新建：

```text
.env.local
```

## 10.1 内容

填写：

```bash
SUPABASE_URL=https://你的-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_你的真实SecretKey

R2_ACCOUNT_ID=你的CloudflareAccountID
R2_ACCESS_KEY_ID=你的R2AccessKeyID
R2_SECRET_ACCESS_KEY=你的R2SecretAccessKey
R2_BUCKET_NAME=bbc-search-media

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

例如结构上应该类似：

```bash
SUPABASE_URL=https://abcdefghijk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxxxxxxxxxxx

R2_ACCOUNT_ID=0123456789abcdef0123456789abcdef
R2_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_BUCKET_NAME=bbc-search-media

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

上面只是示意。

**绝对不要把示例值当真实值使用。**

---

# 11. 确认 `.env.local` 不会提交 GitHub

项目 `.gitignore` 已忽略：

```text
.env
.env.*
```

同时例外保留：

```text
!.env.example
```

所以：

```text
.env.example → 可以提交
.env.local   → 不应该提交
```

创建 `.env.local` 后建议执行：

```bash
git status
```

正确情况：

> `.env.local` 不应该出现在待提交文件列表中。

如果它出现了：

**不要 commit。先停止并检查 `.gitignore`。**

---

# 12. 安装依赖

如果 Phase 1 后还没安装依赖：

```bash
npm install
```

如果已经执行过，也可以直接进入下一步。

---

# 13. 启动项目

在项目根目录运行：

```bash
npm run dev
```

正常情况下终端会看到类似：

```text
Local: http://localhost:3000
```

保持这个终端窗口运行。

不要关闭。

---

# 14. 测试 `/api/health`

浏览器打开：

```text
http://localhost:3000/api/health
```

## 14.1 全部成功

应该看到：

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

这表示：

```text
Next.js 正常
Supabase 正常
R2 正常
```

Phase 1 的真实 integration check 即通过。

---

# 15. 如果返回 `degraded`

可能类似：

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

或者：

```json
{
  "status": "degraded",
  "services": {
    "app": "ok",
    "database": "ok",
    "storage": "error"
  }
}
```

HTTP status 会是：

```text
503
```

这不是网页坏了，而是 health endpoint 明确告诉你某个外部服务没连通。

---

# 16. Database = error 怎么排查

按这个顺序检查。

## A. migration 有没有执行？

Supabase Table Editor 中应有：

```text
episodes
dialogue_segments
clips
```

当前 health check 会查询：

```text
episodes
```

即使里面 0 条数据也没关系。

但表不存在就会失败。

---

## B. `SUPABASE_URL` 是否正确？

必须类似：

```text
https://xxxxxxxx.supabase.co
```

不要填 Dashboard 页面 URL。

错误示例：

```text
https://supabase.com/dashboard/project/xxxx
```

---

## C. Secret key 是否正确？

推荐：

```text
sb_secret_...
```

不要填：

```text
sb_publishable_...
```

也不要填数据库 password。

---

## D. 修改 `.env.local` 后有没有重启 Next.js？

环境变量修改后，最稳妥的做法：

终端：

```text
Ctrl + C
```

然后重新：

```bash
npm run dev
```

---

# 17. Storage = error 怎么排查

## A. bucket 名必须完全一致

例如 Cloudflare bucket：

```text
bbc-search-media
```

则：

```bash
R2_BUCKET_NAME=bbc-search-media
```

大小写/拼写都必须一致。

---

## B. Account ID 是否正确？

不要填：

```text
Access Key ID
```

也不要填 Cloudflare Zone ID。

需要的是：

```text
Cloudflare Account ID
```

---

## C. Access Key / Secret Access Key 是否拿反？

必须：

```text
R2_ACCESS_KEY_ID        = Access Key ID
R2_SECRET_ACCESS_KEY    = Secret Access Key
```

---

## D. Token 有没有 bucket 权限？

确认 token 权限：

```text
Object Read & Write
```

并且 bucket scope 包含：

```text
bbc-search-media
```

---

## E. 是否用了普通 Cloudflare API Token？

本项目通过 AWS S3 SDK 连接 R2。

因此需要的是 R2 创建页最终给你的：

```text
Access Key ID
Secret Access Key
```

不是普通 Cloudflare Bearer API Token。

---

# 18. 如果页面直接报环境变量错误

例如终端提示：

```text
Missing required environment variable: R2_ACCOUNT_ID
```

或：

```text
Missing required environment variables: ...
```

说明 `.env.local` 中缺字段、字段名拼错，或者值为空。

当前 Phase 1 要求这 7 个变量全部存在：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
NEXT_PUBLIC_APP_URL
```

直接和 `.env.example` 一行一行对照。

---

# 19. 完成后建议额外执行

health 成功后，停止 dev server：

```text
Ctrl + C
```

然后执行：

```bash
npm run lint
npm test
npm run build
```

如果项目的 `package.json` 中当前没有 `npm test` script，则按 Phase 1 Codex 提交中实际提供的 test 命令执行。

最终至少确认：

```text
lint 通过
测试通过
build 通过
health 通过
```

---

# 20. 完成后不要把什么提交到 GitHub

不要提交：

```text
.env.local
真实 Supabase Secret key
真实 R2 Secret Access Key
数据库密码
任何 credential 截图
```

可以提交：

```text
.env.example
migration
代码
本教程
```

---

# 21. 完成检查表

在进入 Phase 2 前逐项检查：

- [ ] 已创建 Supabase Free project
- [ ] 已执行 `001_initial_schema.sql`
- [ ] Table Editor 可以看到 `episodes`
- [ ] Table Editor 可以看到 `dialogue_segments`
- [ ] Table Editor 可以看到 `clips`
- [ ] 已取得 Supabase Project URL
- [ ] 已取得 Supabase Secret key
- [ ] 已开通 Cloudflare R2
- [ ] 已创建 `bbc-search-media`
- [ ] bucket 未开启 Public Access
- [ ] 已创建只作用于 `bbc-search-media` 的 R2 credentials
- [ ] 已保存 Access Key ID
- [ ] 已保存 Secret Access Key
- [ ] 已创建本地 `.env.local`
- [ ] `git status` 不显示 `.env.local`
- [ ] `npm run dev` 可以启动
- [ ] `/api/health` 返回 `status: ok`
- [ ] database = `ok`
- [ ] storage = `ok`

全部打勾后，Phase 1 的人工配置部分才算完成。

---

# 22. 你现在不需要做的事情

不要提前：

- 上传《生活大爆炸》视频
- 配置 R2 public domain
- 设置 R2 CORS
- 创建 Vercel 项目
- 建用户系统
- 往数据库导入正式语料
- 手动创建 `episodes` 数据
- 开始 Semantic Search

这些都属于后续 Phase。

当前目标只有一个：

> **让本地 Next.js 同时成功连接 Supabase 和 private R2。**

---

# 23. 官方参考

Supabase API Keys：

<https://supabase.com/docs/guides/getting-started/api-keys>

Supabase Database Migrations：

<https://supabase.com/docs/guides/local-development/database-migrations>

Cloudflare R2 Create Bucket：

<https://developers.cloudflare.com/r2/buckets/create-buckets/>

Cloudflare R2 Authentication / API Tokens：

<https://developers.cloudflare.com/r2/api/tokens/>

Cloudflare R2 S3 API：

<https://developers.cloudflare.com/r2/get-started/s3/>
