// 把「赛博女友」打包成一个免装 Node 的独立 exe（Node SEA 单文件应用）
// 用法：npm run build:exe
//
// 做三件事：
//   1) 把前端（index.html / style.css / app.js / 默认形象图）内嵌成 base64 模块
//   2) 用 esbuild 把 server.mjs 打成一个 CJS 文件
//   3) 把这段 JS 注入到 node.exe 的副本里，产出一个自带 Node 运行时的 exe
import esbuild from "esbuild";
import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUILD = path.join(ROOT, "build");
const DIST = path.join(ROOT, "dist");
const EXE_NAME = "赛博女友.exe";

// 内嵌进 exe 的只读文件（打包后 exe 就不依赖这些外部文件了）
const EMBED = ["public/index.html", "public/style.css", "public/app.js", "assets/character.jpg"];

function log(...a) {
  console.log("  " + a.join(" "));
}

async function step(n, title) {
  log(`[${n}] ${title}`);
}

// 从 node.exe 里读出 SEA 的 sentinel fuse 值，避免写死后随 Node 版本失效
async function detectFuse(nodeExe) {
  const buf = await readFile(nodeExe);
  const s = buf.toString("latin1");
  const m = /NODE_SEA_FUSE_[0-9a-f]{32}/.exec(s);
  if (!m) throw new Error("没能在 node.exe 里找到 NODE_SEA_FUSE，当前 Node 版本可能不支持 SEA");
  return m[0];
}

async function main() {
  await mkdir(BUILD, { recursive: true });
  await mkdir(DIST, { recursive: true });

  await step(1, "打包前端 (src/main.js → public/app.js)");
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "main.js")],
    bundle: true,
    outfile: path.join(ROOT, "public", "app.js"),
    legalComments: "none",
    logLevel: "warning"
  });

  await step(2, "把前端文件内嵌成 base64 模块");
  const entries = [];
  for (const rel of EMBED) {
    const p = path.join(ROOT, rel);
    if (!existsSync(p)) {
      log(`    ! 跳过（文件不存在）：${rel}`);
      continue;
    }
    const b64 = (await readFile(p)).toString("base64");
    entries.push(`  ${JSON.stringify(rel)}: ${JSON.stringify(b64)}`);
    log(`    ${rel}  ${(b64.length / 1024).toFixed(0)} KB`);
  }
  const generated = `// 本文件由 tools/build-exe.mjs 自动生成，请勿手改。\nexport default {\n${entries.join(",\n")}\n};\n`;

  await step(3, "打包服务端 (esbuild → build/server.cjs)");
  const bundlePath = path.join(BUILD, "server.cjs");
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "server.mjs")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: bundlePath,
    legalComments: "none",
    logLevel: "warning",
    plugins: [
      {
        name: "embedded-assets",
        setup(b) {
          b.onResolve({ filter: /\.\/src\/embedded-assets\.js$/ }, () => ({ path: "embedded", namespace: "gen" }));
          b.onLoad({ filter: /.*/, namespace: "gen" }, () => ({ contents: generated, loader: "js" }));
        }
      }
    ]
  });
  if (result.warnings.length) for (const w of result.warnings) log("    warn: " + w.text);
  log(`    build/server.cjs  ${((await stat(bundlePath)).size / 1024).toFixed(0)} KB`);

  await step(4, "生成 SEA blob");
  const seaConfig = {
    main: bundlePath,
    output: path.join(BUILD, "sea-prep.blob"),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false
  };
  await writeFile(path.join(BUILD, "sea-config.json"), JSON.stringify(seaConfig, null, 2));
  execFileSync(process.execPath, ["--experimental-sea-config", path.join(BUILD, "sea-config.json")], {
    stdio: "inherit"
  });

  await step(5, `复制 node.exe → dist/${EXE_NAME}`);
  const exePath = path.join(DIST, EXE_NAME);
  await copyFile(process.execPath, exePath);
  const fuse = await detectFuse(process.execPath);
  log(`    fuse = ${fuse}`);

  await step(6, "注入 JS 到 exe");
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "postject", "dist", "cli.js"),
      exePath,
      "NODE_SEA_BLOB",
      path.join(BUILD, "sea-prep.blob"),
      "--sentinel-fuse",
      fuse
    ],
    { stdio: "inherit" }
  );

  const size = (await stat(exePath)).size;
  console.log("");
  log("完成 → " + exePath);
  log("大小：" + (size / 1024 / 1024).toFixed(1) + " MB（已自带 Node 运行时，目标机器不用装任何东西）");
}

main().catch((e) => {
  console.error("\n打包失败：" + (e?.stack || e?.message || e));
  process.exitCode = 1;
});
