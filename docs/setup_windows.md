# BBC Search Windows 安装与恢复指南

本文用于在一台新的 Windows 机器上，从零配置 BBC Search，直到代码检查、测试、构建和本地开发服务都能运行。文中的命令默认在普通用户权限的 PowerShell 或 Windows Terminal（PowerShell 配置文件）中执行；只有安装器明确要求时才使用管理员权限。

除非某一节另有说明，克隆完成后的命令都必须在仓库根目录运行，也就是包含 `package.json`、`package-lock.json` 和 `bootstrap.ps1` 的目录。

## 1. 一次性安装机器工具

BBC Search 当前实际使用以下工具：

- Git：克隆和更新仓库，并访问 GitHub。
- Node.js 与 npm：运行 Next.js 应用及 JavaScript/TypeScript 检查。当前 Next.js 版本要求 Node.js `>=20.9.0`，建议安装当前 Node.js LTS。
- Python 3.10 或更高版本：运行 `scripts/corpus/` 中的双语字幕和视频切片脚本。这些脚本当前只使用 Python 标准库，不需要创建虚拟环境或安装 pip 包。
- FFmpeg 与 FFprobe：分别用于生成 MP4 切片和检查媒体时长/流信息。它们是机器工具，不是 npm 依赖。
- 一个现代浏览器：打开本地 Next.js 页面。Chrome、Edge 或 Firefox 均可，没有额外浏览器运行时要求。

可以使用 Windows Package Manager 安装：

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Gyan.FFmpeg -e
```

安装结束后，完全关闭当前 PowerShell/Windows Terminal，再打开一个新窗口，让新的 PATH 生效。

逐项验证：

```powershell
git --version
node --version
npm --version
python --version
ffmpeg -version
ffprobe -version
```

最低要求是 `node --version` 不低于 `v20.9.0`，且所有命令都能被识别。若 Windows 上只有 Python Launcher，也可以运行：

```powershell
py -3 --version
```

之后把本文中的 `python` 替换为 `py -3` 即可。

## 2. 配置 GitHub 访问并克隆仓库

先确认当前机器能够访问 GitHub。使用 HTTPS 克隆时，私有仓库可能要求在浏览器中登录或使用 Git Credential Manager；不要把访问令牌写进仓库文件。

选择一个用于存放代码的目录，然后执行：

```powershell
Set-Location <你的代码目录>
git clone https://github.com/<GitHub用户名或组织名>/bbc-search.git
Set-Location .\bbc-search
```

如果仓库使用 SSH，则使用仓库页面提供的 SSH 地址：

```powershell
git clone git@github.com:<GitHub用户名或组织名>/bbc-search.git
Set-Location .\bbc-search
```

确认当前位置正确：

```powershell
Test-Path .\package.json
Test-Path .\package-lock.json
Test-Path .\bootstrap.ps1
```

三个结果都应为 `True`。

## 3. 安装项目依赖

仓库提交了 npm lockfile。对于新克隆，使用可复现的干净安装：

```powershell
npm ci
```

该命令严格按照 `package-lock.json` 安装，并创建 `node_modules`。不要改用 pnpm、Yarn 或其他包管理器。

以后如果只是拉取了包含 lockfile 变更的新代码，也可以再次运行 `npm ci`，让本地依赖与 lockfile 完全同步。只有在主动添加、删除或升级依赖并需要更新 lockfile 时，才使用：

```powershell
npm install <包名>
```

## 4. 创建本地环境配置

从仓库模板创建本机专用 `.env`：

```powershell
Copy-Item .\.env.example .\.env
notepad .\.env
```

填写以下变量，但不要把真实值粘贴到文档、Issue、聊天记录或提交中：

```dotenv
SUPABASE_URL=https://<你的 Supabase 项目>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<仅服务端使用的 Supabase service-role key>

R2_ACCOUNT_ID=<Cloudflare account ID>
R2_ACCESS_KEY_ID=<R2 API token 的 access key ID>
R2_SECRET_ACCESS_KEY=<R2 API token 的 secret access key>
R2_BUCKET_NAME=<BBC Search 使用的 R2 bucket 名称>

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

各变量用途：

- `SUPABASE_URL`：Supabase 项目 API 地址，必须是完整 URL。
- `SUPABASE_SERVICE_ROLE_KEY`：服务端数据库访问凭据，权限很高；绝不能加 `NEXT_PUBLIC_` 前缀，也不能发送到浏览器。
- `R2_ACCOUNT_ID`：组成 Cloudflare R2 S3 兼容端点。
- `R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY`：服务端访问 R2 的一对凭据。
- `R2_BUCKET_NAME`：健康检查和后续媒体操作使用的 bucket。
- `NEXT_PUBLIC_APP_URL`：应用公开基础地址；本地开发保持 `http://localhost:3000`。

`.env` 和其他 `.env.*` 文件默认被 Git 忽略，只有不含真实秘密的 `.env.example` 可以提交。检查时不要打印 `.env` 内容，可以运行：

```powershell
git check-ignore .env
```

应输出 `.env`。

## 5. 运行仓库就绪检查

仍在仓库根目录执行：

```powershell
.\bootstrap.ps1
```

这个脚本只检查并报告状态，不会安装包、安装媒体工具、创建 secrets 或修改配置。

在完整的本地开发环境中，下列项目应显示 `[OK]`：

- Node、npm、FFmpeg、FFprobe：机器级命令可用。
- `.env.example`：仓库模板存在。
- `.env`：本机配置已经创建。这是缺失的本地配置时显示的提示，不代表仓库文件损坏。
- `node_modules`：npm 依赖已经安装。

如果 PowerShell 因执行策略拒绝运行该脚本，可以只为这一次启动一个绕过策略的子进程，不修改系统策略：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1
```

## 6. 验证项目

依次运行当前 `package.json` 支持的检查：

```powershell
npm run lint
npm test
npm run build
```

预期结果：

- `npm run lint`：ESLint 完成且没有错误。
- `npm test`：Vitest 单元测试通过。
- `npm run build`：Next.js 生产构建完成。

Python 语料和切片脚本也有标准库单元测试。可选但建议运行：

```powershell
python -m unittest discover -s .\tests\corpus -p "test_*.py" -v
```

这些测试使用临时/模拟数据，不需要把真实 MKV、SRT 或生成 clips 放入 Git。

## 7. 启动本地开发服务

在仓库根目录运行：

```powershell
npm run dev
```

Next.js 当前默认监听：

```text
http://localhost:3000
```

在浏览器打开该地址。需要停止开发服务时，在运行它的终端按 `Ctrl+C`。

当前健康检查地址为：

```text
http://localhost:3000/api/health
```

该接口会真实访问 Supabase 和 R2。两个服务都成功时返回 HTTP 200 和 `status: "ok"`；配置缺失、凭据错误、bucket/数据表不可访问或网络异常时会返回 HTTP 503 和 `status: "degraded"`。不要用假凭据判断外部服务已经配置成功。

如需在本机预览生产构建，可在 `npm run build` 成功后运行：

```powershell
npm start
```

## 8. 本地媒体与语料工具

Git 克隆不会包含原始剧集、SRT、生成的 `segments.json` 或 MP4 clips。需要运行语料/切片流程时，把你有权使用的本地文件放在被忽略的目录中，例如：

```text
data/raw/video/<episode>.mkv
data/raw/subtitles/<episode>.bilingual.srt
data/generated/<episode>/
```

确认 FFmpeg 能读取媒体：

```powershell
ffprobe .\data\raw\video\<episode>.mkv
```

Phase 2/3 的具体命令和数据契约见：

- `docs/PHASE_2_CORPUS_PIPELINE.md`
- `docs/PHASE_3_CLIP_GENERATION.md`
- `docs/PHASE_3_PREREQUISITES.md`

不要把原始版权视频、SRT、生成 clips 或 secrets 强制加入 Git。

## 9. 以后重新打开项目

一次性安装和 `.env` 配置完成后，日常启动只需要：

```powershell
Set-Location <你的代码目录>\bbc-search
git pull
npm ci
.\bootstrap.ps1
npm run dev
```

如果 `git pull` 后 `package-lock.json` 没有变化且 `node_modules` 状态正常，可以省略 `npm ci`。如果只想启动而不拉取更新，则只需进入仓库并运行 `npm run dev`。

## 10. Windows 故障排查

### `node` 或 `npm` 无法识别

先关闭所有终端并重新打开，然后运行：

```powershell
Get-Command node
Get-Command npm
node --version
npm --version
```

仍然找不到时，重新安装 Node.js LTS，并确认安装器已把 Node.js 加入用户或系统 PATH。不要把 Codex、IDE 或其他工具的临时 Node runtime 路径写入项目文件；换设备后该路径通常不存在。

### PowerShell 禁止加载 `npm.ps1`

如果错误信息包含“在此系统上禁止运行脚本”或 `PSSecurityException`，可以调用同目录下不受 PowerShell 脚本策略影响的 Windows 命令包装器：

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

也可以在理解影响后，为当前用户启用已签名/本地脚本：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

该设置不是 BBC Search 的必需项目配置；不希望修改执行策略时，持续使用 `npm.cmd` 即可。

### `ffmpeg` 或 `ffprobe` 无法识别

先重开终端并检查：

```powershell
Get-Command ffmpeg
Get-Command ffprobe
winget list --id Gyan.FFmpeg -e
```

如果 winget 显示已经安装而命令仍找不到，确认 FFmpeg 的 `bin` 目录位于 PATH。必要时重新安装：

```powershell
winget uninstall --id Gyan.FFmpeg -e
winget install --id Gyan.FFmpeg -e
```

安装后再次完全关闭并重开终端。不要把 FFmpeg 加入 `package.json`。

### `node_modules` 不存在或状态陈旧

从仓库根目录按照 lockfile 重建：

```powershell
npm ci
```

`npm ci` 会移除现有 `node_modules` 后干净安装。先保存你在依赖目录中的任何临时调试内容；正常情况下不应手工修改 `node_modules`。

### `.env` 缺失

重新从模板创建：

```powershell
Copy-Item .\.env.example .\.env
notepad .\.env
```

只从对应服务的控制台取值，不要从公开仓库、示例文本或他人的环境文件复制秘密。

### 外部凭据导致开发、构建或测试失败

先区分本地代码检查和真实服务检查：

- 当前 Vitest 单元测试使用测试数据，不应要求可用的 Supabase/R2 账号。
- 当前 Next.js 构建不应主动调用 Supabase/R2；如果错误明确指出缺少环境变量，检查 `.env` 是否存在、变量名是否与 `.env.example` 完全一致、URL 是否为合法完整 URL。
- `/api/health` 会真实连接两个服务；HTTP 503 通常表示环境变量、网络、Supabase `episodes` 表、R2 bucket 或权限仍需修复。

不要把真实 secret 写进测试文件来“修复”测试。若需要验证真实服务，只在被忽略的 `.env` 中填入本机凭据，然后重启开发服务器。

## 11. 完成检查表

- [ ] `git`、`node`、`npm`、`python`、`ffmpeg`、`ffprobe` 都能在新终端中运行。
- [ ] 仓库已克隆，并且当前目录是仓库根目录。
- [ ] `npm ci` 已成功完成。
- [ ] `.env` 已从 `.env.example` 创建并只保存在本机。
- [ ] `.\bootstrap.ps1` 的必要检查均为 `[OK]`。
- [ ] `npm run lint`、`npm test`、`npm run build` 均通过。
- [ ] `npm run dev` 可以启动，浏览器能打开 `http://localhost:3000`。
- [ ] 原始媒体、字幕、生成 clips 和 secrets 没有进入 Git。
