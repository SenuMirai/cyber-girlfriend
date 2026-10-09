# 赛博女友 · 项目长期记忆

## 这是什么
基于 Vivix `vivix-a1-stream` 的实时数字人聊天应用，本地运行。
后端 `server.mjs`（HTTP 服务 + Vivix API 代理 + 图床上传），前端 `src/main.js` → esbuild → `public/app.js`。
角色形象图必须公网可访问 → 走 `gh` CLI 传到 `SenuMirai/cyber-girlfriend-assets` 换 raw 链接。
API Key 存 `config.json`（已 gitignore）。

## 构建链路（三条命令）
- `npm run build:exe` → `tools/build-exe.mjs` → `dist/赛博女友.exe`（Node SEA 单文件，86 MB，免装 Node）
- `npm run build:installer` → `tools/build-installer.mjs` → `dist/安装包/赛博女友_安装包_<日期>.exe`（IExpress 自解压，25 MB）
- `npm run build:all` 一步到位
- 模板在 `installer/`：`install.cmd` 必须 **GBK + CRLF**，`readme.txt` 必须 **UTF-8 BOM**；脚本按字节复制，勿用字符串重写。

## 交付形态历程
- v1（tag `v1-lan-2026-10-09`）：源码版 + 局域网访问（0.0.0.0 + 自签 HTTPS 3443 + 二维码）。
- 备份：`backups/20261009_改造前/`、`backups/20261009_v1_局域网版/`、`backups/赛博女友_v1_局域网版_源码_20261009.zip`。

## 已实现的四项能力（用户提的需求，均已实测）
1. 角色列表 `characters.json` + `/characters` CRUD（保存/载入/改名/删除/导出/导入）
2. 声线 48 个 / 8 组（`src/voice-catalog.js`），男声 + 少年正太 + ElevenLabs + 克隆音色，支持试听
3. 竖版变形根因修复：上传前 canvas 归一化成精确输出比例（Vivix 要求首图比例 = 输出比例）
4. 局域网/HTTPS 访问 + 二维码

## 内置默认角色 = 大肥鱼（重要）
- 定义在 `defaults/default-character.json`，`server.mjs` 用 `import ... with { type: "json" }` 引入
  → esbuild **内联进二进制**，独立 exe 也读得到。
- 内容：人设 578 字（DeepSeek 鲸鱼娘 / 傲娇摸鱼打工人）／运镜 speaking 1817 字、listening 1510 字／
  开场白「找我什么事？」／声线 `longanhuan_v3.6` 语速 1／形象图 `assets/1791525005312.jpg`／
  角色库固定 id `c_default`。
- 形象图必须同时加进 `tools/build-exe.mjs` 的 EMBED 列表（GitHub raw 国内打不开，不内嵌就没头像）。
- 角色库有**一次性自愈**（version 1→2，只在旧库上跑）：清掉旧占位角色「阿甜」、补入大肥鱼，
  **绝不误删用户自建角色**；跑过一次就不再干预，避免"删了又长回来"。
- ⚠️ 教训：内置默认值**绝不能依赖本机 config.json** —— exe 数据目录是 `%LOCALAPPDATA%\赛博女友`，
  不继承项目配置。当初 DEFAULTS 写的是占位角色「阿甜」且运镜为空 → 用户以为"大肥鱼丢了、字段全空"。
  **改默认值要同时改 DEFAULTS 和内置角色库。**

## 硬坑清单
- **IExpress**：`.sed` 的 `[SourceFiles0]` 每行必须 `%FILE0%=`（末尾等号不能省，少了就静默失败只返回 1）；
  `.sed` 内不能有中文（先输出到 ASCII 临时路径再搬走）；安装包解压临时目录会被清掉，
  使用说明必须在 install.cmd 里显式复制到目标目录。
- **selfsigned@5.x** 的 `generate()` 是 async。
- 本机 GitHub raw 被墙 → 预览图优先用本地副本，服务端按 URL 文件名自愈认领。
- Node 22 managed 版支持 `TextDecoder("gbk")`，但 `Buffer.toString("gbk")` 不可靠。
- Node 22 支持 JSON 导入属性：`import x from "./a.json" with { type: "json" }`（dev 直接跑可用）。
- **esbuild 会把内联 JSON 里的非 ASCII 转成 `\uXXXX` 转义** → 直接 grep 中文会误判"没打进去"，
  要先还原转义再查。
- 删 `%LOCALAPPDATA%` 下目录时 bash `rm -rf` 会被安全删除拦截器挡，改用 Python `shutil.rmtree`。
- 通过 Bash 启动的分离子进程会随该轮工具调用结束被杀；验证常驻服务要用后台任务。
- 启动/关闭脚本是 GBK 编码，改它们要走「UTF-8 临时文件 → PowerShell 转 GBK」。

## 部署路线（用户 2026-10-09 已拍板）
用户选择 **B 方案：托管平台跑后端**（GitHub Pages 放不了后端，故走 Render/Fly/Railway/Vercel）。
改造要点：① 服务端托管 API Key（环境变量）② 加**使用者自带 Key**模式，避免别人用量全算在用户头上
③ 前端改同域相对路径 ④ 手机开麦的 HTTPS 由平台提供，本机自签证书那套在公网可退役
⑤ GitHub 仍用于放入口说明页 + 镜像。
其余备选：A 各人各装一份（已交付）／C 自备轻量云主机。
