// 把 dist/赛博女友.exe 打成一个「双击就能装」的安装包 exe
// 用法：npm run build:installer   （先跑 npm run build:exe 生成主程序）
//
// 用 Windows 自带的 IExpress（iexpress.exe，系统组件，无需额外安装）做自解压包：
//   安装包内 = [主程序 exe] + [install.cmd] + [readme.txt]
//   双击后：解压到临时目录 → 跑 install.cmd → 复制到用户目录 + 建快捷方式 + 启动
//
// 模板文件在 installer/ 目录，改文案改那里就行：
//   installer/install.cmd   安装动作（必须是 GBK + CRLF，否则中文会乱码）
//   installer/readme.txt    安装后复制给用户看的使用说明（UTF-8 带 BOM）
//
// 坑（踩过）：
//   1) IExpress 的 .sed 只认 ANSI，且对含中文的路径非常脆弱 ——
//      所以 .sed 里不出现任何中文：TargetName 用临时 ASCII 路径，打完再搬到中文目录。
//   2) 模板文件按字节原样复制，绝不用字符串重写，否则 GBK / BOM 会被破坏。
import { readFile, writeFile, mkdir, copyFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, "dist");
const OUTDIR = path.join(DIST, "安装包");
const SRC_EXE = path.join(DIST, "赛博女友.exe");

const STAGE = path.join(os.tmpdir(), "cg-installer-build");   // 纯 ASCII，给 IExpress 用
const PAYLOAD = path.join(STAGE, "payload");
const SED = path.join(STAGE, "build.sed");
const SETUP_TMP = path.join(STAGE, "setup.exe");

const EXE_IN_PKG = "app.exe";     // 安装包里的主程序文件名（避免中文名进 CAB）
const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;   // 本地日期，不用 UTC
})();
const SETUP_NAME = `赛博女友_安装包_${today}.exe`;
const SETUP_OUT = path.join(OUTDIR, SETUP_NAME);

const IEXPRESS = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "iexpress.exe");

function log(...a) { console.log("  " + a.join(" ")); }

async function main() {
  if (!existsSync(SRC_EXE)) throw new Error(`找不到主程序：${SRC_EXE}\n请先执行 npm run build:exe`);
  if (!existsSync(IEXPRESS)) throw new Error(`找不到 IExpress：${IEXPRESS}（这个工具是 Windows 自带组件）`);

  const tplCmd = path.join(ROOT, "installer", "install.cmd");
  const tplReadme = path.join(ROOT, "installer", "readme.txt");
  for (const f of [tplCmd, tplReadme]) if (!existsSync(f)) throw new Error(`缺少模板文件：${f}`);

  log("[1] 准备暂存目录（ASCII 路径）");
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(PAYLOAD, { recursive: true });
  await mkdir(OUTDIR, { recursive: true });
  log("    " + STAGE);

  log("[2] 复制载荷");
  await copyFile(SRC_EXE, path.join(PAYLOAD, EXE_IN_PKG));
  const exeSize = (await stat(path.join(PAYLOAD, EXE_IN_PKG))).size;
  log(`    ${EXE_IN_PKG}   ${(exeSize / 1024 / 1024).toFixed(1)} MB`);

  await copyFile(tplCmd, path.join(PAYLOAD, "install.cmd"));
  await copyFile(tplReadme, path.join(PAYLOAD, "readme.txt"));

  // 只做体检，不改内容
  const cmdBuf = await readFile(path.join(PAYLOAD, "install.cmd"));
  const cmdTxt = new TextDecoder("gbk").decode(cmdBuf);
  const hasCrlf = cmdBuf.includes(Buffer.from("\r\n"));
  log(`    install.cmd   ${cmdBuf.length} B   GBK:${cmdTxt.includes("使用说明.txt") ? "OK" : "⚠"}  CRLF:${hasCrlf ? "OK" : "⚠"}`);
  const rmBuf = await readFile(path.join(PAYLOAD, "readme.txt"));
  log(`    readme.txt    ${rmBuf.length} B   BOM:${rmBuf[0] === 0xef ? "OK" : "⚠"}`);

  log("[3] 生成 IExpress 配置 build.sed（纯 ASCII）");
  const names = ["app.exe", "install.cmd", "readme.txt"];
  const FILE_MAP = { "app.exe": "FILE0", "install.cmd": "FILE1", "readme.txt": "FILE2" };
  const sed = [
    "[Version]",
    "Class=IEXPRESS",
    "SEDVersion=3",
    "[Options]",
    "PackagePurpose=InstallApp",
    "ShowInstallProgramWindow=0",
    "HideExtractAnimation=1",
    "UseLongFileName=1",
    "InsideCompressed=0",
    "CAB_FixedSize=0",
    "CAB_ResvCodeSigning=0",
    "RebootMode=N",
    "InstallPrompt=",
    "DisplayLicense=",
    "FinishMessage=",
    `TargetName=${SETUP_TMP}`,
    "FriendlyName=CyberGirlfriend Setup",
    "AppLaunched=install.cmd",
    "PostInstallCmd=<None>",
    "AdminQuietInstCmd=",
    "UserQuietInstCmd=",
    "SourceFiles=SourceFiles",
    "[Strings]",
    ...names.map((n) => `${FILE_MAP[n]}="${n}"`),
    "[SourceFiles]",
    `SourceFiles0=${PAYLOAD}\\`,
    "[SourceFiles0]",
    // 注意：这里每行必须是 %FILE0%= 的写法，末尾那个等号不能省，
    // 少了等号 IExpress 会直接以退出码 1 静默失败、什么都不产出。
    ...names.map((n) => `%${FILE_MAP[n]}%=`)
  ].join("\r\n");
  // 全 ASCII，latin1 与 utf8 等价；用 latin1 确保不会被加 BOM
  await writeFile(SED, Buffer.from(sed, "latin1"));
  log("    " + SED);

  log("[4] 调用 IExpress 打包（比较慢，请等几十秒）");
  await rm(SETUP_TMP, { force: true });
  execFileSync(IEXPRESS, ["/N", SED], { stdio: "inherit" });
  if (!existsSync(SETUP_TMP)) throw new Error("IExpress 没有产出 setup.exe，检查 .sed 的 TargetName / SourceFiles0");

  log("[5] 搬到交付目录");
  await rm(SETUP_OUT, { force: true });
  await copyFile(SETUP_TMP, SETUP_OUT);
  const setupSize = (await stat(SETUP_OUT)).size;
  log(`    ${SETUP_OUT}`);

  log("[6] 清理暂存目录");
  await rm(STAGE, { recursive: true, force: true });

  console.log("");
  log("完成");
  log(`大小：${(setupSize / 1024 / 1024).toFixed(1)} MB  （主程序 ${(exeSize / 1024 / 1024).toFixed(1)} MB，装进包后压缩约 ${((1 - setupSize / exeSize) * 100).toFixed(0)}%）`);
}

main().catch((e) => {
  console.error("\n打包安装包失败：" + (e?.stack || e?.message || e));
  process.exitCode = 1;
});
