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

## 硬坑清单
- **IExpress**：`.sed` 的 `[SourceFiles0]` 每行必须 `%FILE0%=`（末尾等号不能省，少了就静默失败只返回 1）；
  `.sed` 内不能有中文（先输出到 ASCII 临时路径再搬走）；安装包解压临时目录会被清掉，
  使用说明必须在 install.cmd 里显式复制到目标目录。
- **selfsigned@5.x** 的 `generate()` 是 async。
- 本机 GitHub raw 被墙 → 预览图优先用本地副本，服务端按 URL 文件名自愈认领。
- Node 22 managed 版支持 `TextDecoder("gbk")`，但 `Buffer.toString("gbk")` 不可靠。
- 通过 Bash 启动的分离子进程会随该轮工具调用结束被杀；验证常驻服务要用后台任务。
- 启动/关闭脚本是 GBK 编码，改它们要走「UTF-8 临时文件 → PowerShell 转 GBK」。

## 待用户拍板
公网部署（用户想要「挂 GitHub、免费、所有人可访问」）存在硬障碍：
程序需后端来 ① 保管 API Key ② 建实时会话 ③ 传图片。GitHub Pages 只能放静态文件。
三条路：A 各人各装一份（已交付）／B 免费托管平台跑后端（Render/Fly/Railway）／C 自备轻量云主机。
