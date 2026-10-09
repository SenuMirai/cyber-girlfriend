// 赛博女友 · 本地服务端
// 职责：托管网页 + 代理 Vivix API（API Key 只留在本机，不下发到浏览器）+ 角色库 + 局域网访问
// 文档：https://docs.vivix.ai/streaming-avatar/get-started/quickstart
import http from "node:http";
import https from "node:https";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import selfsigned from "selfsigned";
import { voiceLabel, providerFor } from "./src/voice-catalog.js";

const execFileP = promisify(execFile);

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(ROOT, "config.json");
const LIBRARY_PATH = path.join(ROOT, "characters.json");
const UPLOAD_DIR = path.join(ROOT, "assets", "uploads");
const API_BASE = "https://api.vivix.ai/v1";
const ASSET_RE = /\.(jpe?g|png|webp|gif)$/i;

// ---------------- 配置 ----------------
const DEFAULTS = {
  api_key: "",
  public_base_url: "",
  host: "0.0.0.0", // 监听所有网卡，手机/平板才能连进来；只想本机用就改成 127.0.0.1
  port: 3000,
  https_port: 3443,
  lan_access: true,
  model: "vivix-a1-stream",
  output: { aspect_ratio: "9:16", resolution: "720p" },
  character: {
    avatar_id: "girlfriend",
    name: "阿甜",
    persona: "你是「阿甜」，20 岁的广东女生，是用户的女朋友，你们正在恋爱中。回复简短自然，只输出要说出口的话。",
    opening_line: "宝宝怎么啦",
    source_image: {
      source_image_id: "front",
      url: "./assets/character.jpg",
      media_type: "image/jpeg",
      description: "",
      local_path: ""
    }
  },
  voice: { tts_voice_id: "longanlingxi", speed: 1, tts_provider: "", tts_model_id: "", tts_api_key: "" },
  motion: { speaking_prompt: "", listening_prompt: "" },
  session: { max_duration_seconds: 1200, auto_close_seconds: 60, recording_mode: "off" }
};

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch === undefined ? base : patch;
  if (typeof base !== "object" || base === null) return patch === undefined ? base : patch;
  if (typeof patch !== "object" || patch === null) return base;
  const out = { ...base };
  for (const key of Object.keys(patch)) out[key] = deepMerge(base[key], patch[key]);
  return out;
}

async function loadConfig() {
  let cfg;
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    cfg = deepMerge(DEFAULTS, raw);
  } catch {
    cfg = structuredClone(DEFAULTS);
  }
  if (repairLocalPath(cfg)) await persistConfig(cfg);
  return cfg;
}

// 预览要跟 Vivix 实际用的那张图一致，所以以 url 的文件名为准去 assets 里认领本地副本
// （GitHub raw 在国内经常打不开，有本地副本预览才稳）；找不到就清空，避免指向不存在的文件。
function repairLocalPath(cfg) {
  const img = cfg.character?.source_image;
  if (!img) return false;
  const before = img.local_path || "";
  let next = "";
  const base = path.basename((img.url || "").split("?")[0]);
  if (base && ASSET_RE.test(base)) {
    for (const rel of [`assets/uploads/${base}`, `assets/${base}`]) {
      if (existsSync(path.join(ROOT, rel))) {
        next = rel;
        break;
      }
    }
  }
  if (!next && before && existsSync(path.join(ROOT, before))) next = before;
  if (next === before) return false;
  img.local_path = next;
  return true;
}

async function persistConfig(cfg) {
  const out = { ...cfg };
  // 内部字段不写回文件
  for (const k of ["_tmp_voice_override"]) delete out[k];
  await writeFile(CONFIG_PATH, JSON.stringify(out, null, 2), "utf8");
}

function effectiveApiKey(cfg) {
  return (process.env.VIVIX_API_KEY || cfg.api_key || "").trim();
}

// ---------------- 角色库（characters.json） ----------------
// 一个角色 = 形象图 + 名字 + 人设 + 声线 + 画面比例 的完整快照，可随时切回来
function snapshotOf(cfg) {
  return {
    output: { aspect_ratio: cfg.output?.aspect_ratio || "9:16", resolution: cfg.output?.resolution || "720p" },
    character: {
      avatar_id: cfg.character?.avatar_id || "girlfriend",
      name: cfg.character?.name || "",
      persona: cfg.character?.persona || "",
      opening_line: cfg.character?.opening_line || "",
      source_image: {
        source_image_id: cfg.character?.source_image?.source_image_id || "front",
        url: cfg.character?.source_image?.url || "",
        media_type: cfg.character?.source_image?.media_type || "image/jpeg",
        description: cfg.character?.source_image?.description || "",
        local_path: cfg.character?.source_image?.local_path || ""
      }
    },
    voice: {
      tts_voice_id: cfg.voice?.tts_voice_id || "",
      speed: Number(cfg.voice?.speed ?? 1),
      tts_provider: cfg.voice?.tts_provider || "",
      tts_model_id: cfg.voice?.tts_model_id || ""
      // tts_api_key 刻意不存进角色库，避免密钥跟着角色包到处跑
    },
    motion: {
      speaking_prompt: cfg.motion?.speaking_prompt || "",
      listening_prompt: cfg.motion?.listening_prompt || ""
    }
  };
}

function summarize(rec) {
  return {
    id: rec.id,
    name: rec.name,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
    thumbnail: rec.config?.character?.source_image?.local_path
      ? "/" + rec.config.character.source_image.local_path.replace(/^\.?\//, "")
      : "",
    image_url: rec.config?.character?.source_image?.url || "",
    voice_id: rec.config?.voice?.tts_voice_id || "",
    voice_name: voiceLabel(rec.config?.voice?.tts_voice_id || ""),
    aspect_ratio: rec.config?.output?.aspect_ratio || "9:16",
    persona: (rec.config?.character?.persona || "").slice(0, 80)
  };
}

function newRecord(name, cfg) {
  const now = new Date().toISOString();
  const snap = snapshotOf(cfg);
  return {
    id: "c_" + randomUUID().slice(0, 8),
    name: (name || snap.character.name || "未命名角色").slice(0, 40),
    created_at: now,
    updated_at: now,
    config: snap
  };
}

async function loadLibrary() {
  let lib;
  try {
    lib = JSON.parse(await readFile(LIBRARY_PATH, "utf8"));
    if (!lib || !Array.isArray(lib.characters)) throw new Error("格式不对");
  } catch {
    // 首次运行：把当前 config.json 里的角色收进角色库，用户一打开就能看到它
    const cfg = await loadConfig();
    lib = { version: 1, characters: [newRecord(cfg.character?.name || "默认角色", cfg)] };
    await persistLibrary(lib);
  }
  return lib;
}

async function persistLibrary(lib) {
  await writeFile(LIBRARY_PATH, JSON.stringify(lib, null, 2), "utf8");
}

// ---------------- Vivix API ----------------
const ERROR_HINTS = {
  10001: "API Key 缺失或无效，请在右上角设置里检查",
  10003: "API Key 无效，请在右上角设置里检查",
  10004: "Vivix 账号未开通计费或余额不足",
  10005: "Vivix 账号余额不足，请先充值",
  10008: "请求过于频繁，请稍后重试",
  10009: "该 API Key 没有 vivix-a1-stream 的访问权限",
  20004: "请求参数有误，请检查设置",
  30004: "请求参数有误，请检查设置",
  20012: "缺少角色配置",
  20013: "角色配置无效，请检查角色图片",
  20014: "缺少输出设置（9:16 / 720p）",
  20005: "会话不存在或已过期",
  30006: "并发会话数已达上限，请稍后重试",
  30008: "模型容量繁忙，请稍后重试"
};

async function vivix(pathname, body, method = "POST") {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${body.__key}`, "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(stripKey(body)),
    signal: AbortSignal.timeout(60000)
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw httpError(502, `Vivix 返回了非 JSON 响应（HTTP ${res.status}）`);
  }
  if (!res.ok || data.code !== 0) {
    const code = data.code ?? res.status;
    const hint = ERROR_HINTS[code];
    throw httpError(502, `${hint || "Vivix 请求失败"}${data.message ? `：${data.message}` : ""}`, code);
  }
  return data.data;
}

function stripKey(obj) {
  const { __key, ...rest } = obj;
  return rest;
}

// 角色图片必须是公网可访问的 URL（Vivix 服务器要来抓取）
function resolveImageUrl(cfg) {
  const image = cfg.character.source_image || {};
  const url = (image.url || "").trim();
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.PUBLIC_BASE_URL || cfg.public_base_url || "").trim().replace(/\/+$/, "");
  if (!base) {
    throw httpError(
      400,
      "角色图片目前是本机文件，Vivix 服务器抓取不到。二选一：① 在「角色图片」里点「选择照片」，程序会自动传到你的 GitHub 仓库并生成公网地址；② 在 config.json 里填写 public_base_url（本服务部署到公网后的地址）。"
    );
  }
  return `${base}/${path.basename(url)}`;
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ---------------- 角色图片发布（传到用户的 GitHub，生成公网 raw 链接） ----------------
const GH_REPO = "cyber-girlfriend-assets";

async function ghRun(args, timeout = 60000) {
  const { stdout } = await execFileP("gh", args, {
    timeout,
    env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
    windowsHide: true
  });
  return stdout.trim();
}

async function ghReady() {
  try {
    await ghRun(["auth", "status"], 20000);
    return true;
  } catch {
    return false;
  }
}

let ghCache = null; // { owner, slug, branch }

async function ghTarget() {
  if (ghCache) return ghCache;
  const owner = await ghRun(["api", "user", "-q", ".login"], 30000);
  if (!owner) throw httpError(500, "读取 GitHub 账号失败");
  const slug = `${owner}/${GH_REPO}`;
  try {
    await ghRun(["repo", "view", slug], 30000);
  } catch {
    await ghRun(["repo", "create", GH_REPO, "--public", "--description", "赛博女友 · 角色素材"], 90000);
  }
  let branch = "main";
  try {
    branch = (await ghRun(["api", `repos/${slug}`, "-q", ".default_branch"], 30000)) || "main";
  } catch { /* 空仓库时沿用 main */ }
  ghCache = { owner, slug, branch };
  return ghCache;
}

async function ghUploadFile(slug, localPath, remotePath) {
  const content = (await readFile(localPath)).toString("base64");
  const payload = { message: `upload ${remotePath}`, content };
  // 同名文件已存在时带上 sha，做覆盖更新
  try {
    const sha = await ghRun(["api", `repos/${slug}/contents/${remotePath}`, "-q", ".sha"], 30000);
    if (sha) payload.sha = sha;
  } catch { /* 不存在则新建 */ }
  const tmp = path.join(os.tmpdir(), `gh-upload-${Date.now()}.json`);
  await writeFile(tmp, JSON.stringify(payload), "utf8");
  try {
    await ghRun(["api", "--method", "PUT", `repos/${slug}/contents/${remotePath}`, "--input", tmp], 120000);
  } finally {
    try { await rm(tmp, { force: true }); } catch { /* 忽略 */ }
  }
}

// 等待公网地址真正可访问（raw CDN 刚推送时会有几秒延迟）
async function waitForPublic(url, tries = 10, delayMs = 1500) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "Cache-Control": "no-cache" } });
      if (res.ok) return true;
    } catch { /* 继续重试 */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function publishImage(localPath, fileName) {
  if (!(await ghReady())) {
    throw httpError(
      400,
      "没有检测到可用的 GitHub 登录。请先在终端执行一次 gh auth login 完成登录，再回来上传。"
    );
  }
  const { slug, branch } = await ghTarget();
  const remotePath = `characters/${fileName}`;
  await ghUploadFile(slug, localPath, remotePath);
  const publicUrl = `https://raw.githubusercontent.com/${slug}/${branch}/${remotePath}`;
  const verified = await waitForPublic(publicUrl);
  return { publicUrl, verified, repo: slug };
}

function buildSessionBody(cfg, voiceOverride = null) {
  const c = cfg.character;
  const v = { ...cfg.voice, ...(voiceOverride || {}) };
  const tts = { tts_voice_id: v.tts_voice_id, payload: { speed: Number(v.speed) || 1 } };
  if (v.tts_provider) tts.tts_provider = v.tts_provider;
  if (v.tts_model_id) tts.tts_model_id = v.tts_model_id;
  if (v.tts_api_key) tts.tts_api_key = v.tts_api_key;

  const body = {
    model: cfg.model,
    output: cfg.output,
    avatars: [
      {
        avatar_id: c.avatar_id,
        instructions: c.persona,
        visual: {
          source_images: [
            {
              source_image_id: c.source_image.source_image_id,
              url: resolveImageUrl(cfg),
              media_type: c.source_image.media_type || "image/jpeg"
            }
          ]
        }
      }
    ],
    session: { active_avatar_id: c.avatar_id, source_image_id: c.source_image.source_image_id },
    pipeline_config: { tts_config: tts },
    auto_close: { disconnected_timeout_seconds: Number(cfg.session.auto_close_seconds) || 60 },
    max_duration_seconds: Math.max(4, Number(cfg.session.max_duration_seconds) || 1200),
    recording_mode: cfg.session.recording_mode === "on" ? "on" : "off"
  };
  if (c.source_image.description) body.avatars[0].visual.source_images[0].description = c.source_image.description;
  if (cfg.motion.speaking_prompt?.trim()) body.pipeline_config.motion_enhanced = { prompt: cfg.motion.speaking_prompt.trim() };
  if (cfg.motion.listening_prompt?.trim()) body.pipeline_config.motion_planner = { prompt: cfg.motion.listening_prompt.trim() };
  return body;
}

// ---------------- 会话状态（本地单会话） ----------------
let sessionId = null;
let starting = false;

async function createSession(cfg, voiceOverride = null) {
  const key = effectiveApiKey(cfg);
  if (!key) throw httpError(400, "还没有填写 Vivix API Key，请点右上角「设置」填写，或设置环境变量 VIVIX_API_KEY");
  if (starting) throw httpError(409, "正在创建会话，请稍候");
  starting = true;
  try {
    if (sessionId) {
      // 释放上一个残留会话，避免并发上限
      try {
        await vivix(`/realtime-avatar/sessions/${encodeURIComponent(sessionId)}/close`, { __key: key });
      } catch { /* 忽略旧会话关闭失败 */ }
      sessionId = null;
      await new Promise((r) => setTimeout(r, 1200));
    }
    const data = await vivix("/realtime-avatar/sessions", { ...buildSessionBody(cfg, voiceOverride), __key: key });
    sessionId = data.session_id;
    return {
      session_id: data.session_id,
      model: data.model,
      output: data.output,
      voice: { tts_voice_id: (voiceOverride?.tts_voice_id) || cfg.voice.tts_voice_id },
      expires_at: data.expires_at,
      control: data.control,
      delivery: data.delivery
    };
  } finally {
    starting = false;
  }
}

async function closeSession(cfg) {
  const key = effectiveApiKey(cfg);
  if (!sessionId) return { status: "closed" };
  const id = sessionId;
  sessionId = null;
  if (!key) return { status: "closed" };
  const result = await vivix(`/realtime-avatar/sessions/${encodeURIComponent(id)}/close`, { __key: key });
  return { status: result.status };
}

// ---------------- 局域网 / 证书 ----------------
const VIRTUAL_HINT = /(vmware|virtualbox|hyper-v|vethernet|wsl|tailscale|zerotier|loopback|docker|npcap|tap-|tun-)/i;

function lanIPv4s() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      if (ni.address.startsWith("169.254.")) continue;
      if (VIRTUAL_HINT.test(name)) continue;
      out.push({ name, address: ni.address });
    }
  }
  const score = (ip) =>
    ip.startsWith("192.168.") ? 3 : ip.startsWith("10.") ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  out.sort((a, b) => score(b.address) - score(a.address));
  return out;
}

const CERT_DIR = path.join(ROOT, "certs");
const CERT_KEY = path.join(CERT_DIR, "key.pem");
const CERT_CRT = path.join(CERT_DIR, "cert.pem");
const CERT_META = path.join(CERT_DIR, "meta.json");

// 自签证书：手机通过 https 打开时浏览器才允许调用麦克风（http 的局域网地址会被禁用麦克风）
async function ensureCert(ips) {
  const want = JSON.stringify([...ips].sort());
  try {
    const meta = JSON.parse(await readFile(CERT_META, "utf8"));
    if (meta.want === want && existsSync(CERT_KEY) && existsSync(CERT_CRT)) {
      return { ok: true, generated: false };
    }
  } catch { /* 需要重新生成 */ }
  try {
    await mkdir(CERT_DIR, { recursive: true });
    const altNames = [
      { type: 2, value: "localhost" },
      { type: 7, ip: "127.0.0.1" },
      ...ips.map((ip) => ({ type: 7, ip }))
    ];
    const pems = await selfsigned.generate([{ name: "commonName", value: "cyber-girlfriend.local" }], {
      days: 3650,
      keySize: 2048,
      algorithm: "sha256",
      extensions: [{ name: "subjectAltName", altNames }]
    });
    await writeFile(CERT_KEY, pems.private, "utf8");
    await writeFile(CERT_CRT, pems.cert, "utf8");
    await writeFile(CERT_META, JSON.stringify({ want, ips, created_at: new Date().toISOString() }, null, 2), "utf8");
    return { ok: true, generated: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------- HTTP 服务 ----------------
const STATIC_FILES = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/index.html": ["public/index.html", "text/html; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"]
};
const ASSET_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) reject(httpError(413, "请求体过大"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(httpError(400, "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// 拉取远程图片给前端做裁切（绕开浏览器跨域限制）
function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw httpError(400, "图片地址不合法");
  }
  if (!/^https?:$/.test(u.protocol)) throw httpError(400, "只支持 http/https 图片地址");
  const h = u.hostname;
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    throw httpError(400, "出于安全考虑，不允许抓取本机/局域网地址");
  }
  return u.toString();
}

const netState = { httpsReady: false, certGenerated: false, certError: "", httpsPort: 0 };
// 启动时填充的实际监听信息（/netinfo 要回给前端真实的端口，而不是配置文件里的值）
const RUNTIME = { host: "0.0.0.0", port: 3000, httpsPort: 3443 };

async function handle(req, res, secure) {
  const url = new URL(req.url, "http://localhost");
  try {
    // ---- 设置读写 ----
    if (req.method === "GET" && url.pathname === "/config") {
      const cfg = await loadConfig();
      const key = effectiveApiKey(cfg);
      const { api_key, ...safe } = cfg;
      const voice = { ...safe.voice };
      const voiceKeySet = Boolean(voice.tts_api_key);
      delete voice.tts_api_key;
      safe.voice = voice;
      return send(res, 200, {
        ok: true,
        env_key: Boolean(process.env.VIVIX_API_KEY),
        api_key_set: Boolean(key),
        api_key_hint: key ? `••••${key.slice(-4)}` : "",
        voice_key_set: voiceKeySet,
        config: safe
      });
    }
    if (req.method === "POST" && url.pathname === "/config") {
      const patch = await readBody(req);
      const cfg = await loadConfig();
      const { api_key, clear_api_key, voice_key, clear_voice_key, ...rest } = patch || {};
      if (clear_api_key) cfg.api_key = "";
      else if (typeof api_key === "string" && api_key.trim() && !api_key.includes("••••")) cfg.api_key = api_key.trim();
      cfg.voice = cfg.voice || {};
      if (clear_voice_key) cfg.voice.tts_api_key = "";
      else if (typeof voice_key === "string" && voice_key.trim() && !voice_key.includes("••••")) cfg.voice.tts_api_key = voice_key.trim();
      const merged = deepMerge(cfg, rest || {});
      await persistConfig(merged);
      return send(res, 200, { ok: true });
    }

    // ---- 角色库 ----
    if (req.method === "GET" && url.pathname === "/characters") {
      const lib = await loadLibrary();
      return send(res, 200, { ok: true, characters: lib.characters.map(summarize) });
    }
    if (req.method === "GET" && url.pathname === "/characters/export") {
      const lib = await loadLibrary();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cyber-girlfriend-characters-${stamp}.json"`,
        "Cache-Control": "no-store"
      });
      return res.end(JSON.stringify(lib, null, 2));
    }
    if (req.method === "POST" && url.pathname === "/characters/import") {
      const body = await readBody(req, 8 * 1024 * 1024);
      const incoming = Array.isArray(body?.data?.characters) ? body.data.characters : [];
      if (!incoming.length) throw httpError(400, "角色包里没有找到角色");
      const lib = await loadLibrary();
      let added = 0;
      const existIds = new Set(lib.characters.map((c) => c.id));
      for (const rec of incoming) {
        if (!rec || !rec.config || !rec.config.character) continue;
        let id = typeof rec.id === "string" && rec.id ? rec.id : "c_" + randomUUID().slice(0, 8);
        if (existIds.has(id)) id = "c_" + randomUUID().slice(0, 8);
        lib.characters.push({
          id,
          name: String(rec.name || rec.config.character.name || "导入角色").slice(0, 40),
          created_at: rec.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          config: rec.config
        });
        existIds.add(id);
        added++;
      }
      await persistLibrary(lib);
      return send(res, 200, { ok: true, added });
    }
    if (req.method === "POST" && url.pathname === "/characters") {
      const body = await readBody(req);
      const cfg = await loadConfig();
      const lib = await loadLibrary();
      const rec = newRecord(body?.name, cfg);
      lib.characters.unshift(rec);
      await persistLibrary(lib);
      return send(res, 200, { ok: true, character: summarize(rec) });
    }

    const chMatch = /^\/characters\/([^/]+)(\/apply)?$/.exec(url.pathname);
    if (chMatch) {
      const id = decodeURIComponent(chMatch[1]);
      const lib = await loadLibrary();
      const idx = lib.characters.findIndex((c) => c.id === id);
      if (idx < 0) throw httpError(404, "角色不存在（可能已被删除）");
      const rec = lib.characters[idx];

      // 载入：用快照覆盖 config.json
      if (req.method === "POST" && chMatch[2] === "/apply") {
        const cfg = await loadConfig();
        const snap = structuredClone(rec.config);
        const merged = deepMerge(cfg, {
          output: snap.output,
          character: snap.character,
          motion: snap.motion,
          voice: { ...snap.voice, tts_api_key: cfg.voice?.tts_api_key || "" }
        });
        await persistConfig(merged);
        return send(res, 200, { ok: true, name: rec.name });
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        if (typeof body?.name === "string" && body.name.trim()) rec.name = body.name.trim().slice(0, 40);
        rec.updated_at = new Date().toISOString();
        await persistLibrary(lib);
        return send(res, 200, { ok: true, character: summarize(rec) });
      }
      if (req.method === "DELETE") {
        lib.characters.splice(idx, 1);
        await persistLibrary(lib);
        // 顺手清掉这个角色独占的本地图片（被其他角色或当前配置引用的不删）
        const localPath = rec.config?.character?.source_image?.local_path || "";
        if (url.searchParams.get("purge") === "1" && localPath.startsWith("assets/uploads/")) {
          const stillUsed =
            lib.characters.some((c) => c.config?.character?.source_image?.local_path === localPath) ||
            (await loadConfig()).character?.source_image?.local_path === localPath;
          if (!stillUsed) {
            try { await rm(path.join(ROOT, localPath), { force: true }); } catch { /* 忽略 */ }
          }
        }
        return send(res, 200, { ok: true });
      }
      throw httpError(405, "不支持的请求方法");
    }

    // ---- 声线目录 ----
    if (req.method === "GET" && url.pathname === "/voices") {
      const cfg = await loadConfig();
      const key = effectiveApiKey(cfg);
      const cloned = [];
      let notice = "";
      if (key) {
        try {
          const data = await vivix("/voices", { __key: key }, "GET");
          for (const v of data?.voices || []) {
            // 工作区里克隆的音色（voice_ 开头）才是能直接用的
            if (typeof v?.voice_id === "string" && v.voice_id.startsWith("voice_")) {
              cloned.push({ id: v.voice_id, name: v.name || v.voice_id, desc: v.language || "克隆音色" });
            }
          }
        } catch (e) {
          notice = `没能读取克隆音色：${e.message}`;
        }
      }
      return send(res, 200, { ok: true, cloned, notice });
    }

    // ---- 局域网信息 ----
    if (req.method === "GET" && url.pathname === "/netinfo") {
      const cfg = await loadConfig();
      const port = RUNTIME.port;
      const httpsPort = RUNTIME.httpsPort;
      const ips = lanIPv4s();
      const lan = ips.map((x) => ({
        name: x.name,
        ip: x.address,
        http: `http://${x.address}:${port}`,
        https: netState.httpsReady ? `https://${x.address}:${httpsPort}` : ""
      }));
      return send(res, 200, {
        ok: true,
        secure,
        port,
        https_port: httpsPort,
        https_ready: netState.httpsReady,
        cert_generated: netState.certGenerated,
        cert_error: netState.certError,
        lan_access: cfg.lan_access !== false,
        hostname: os.hostname(),
        lan,
        local: `http://localhost:${port}`
      });
    }

    // ---- 上传角色照片：本地留存 + 发布到 GitHub 生成公网地址 ----
    if (req.method === "POST" && url.pathname === "/upload") {
      const body = await readBody(req, 24 * 1024 * 1024);
      const m = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(body.data || "");
      if (!m) throw httpError(400, "只支持 PNG / JPEG / WebP 图片");
      const rawExt = m[2].toLowerCase();
      const ext = rawExt === "jpeg" ? "jpg" : rawExt;
      const buf = Buffer.from(m[3].replace(/\s/g, ""), "base64");
      if (!buf.length) throw httpError(400, "图片内容为空");
      if (buf.length > 12 * 1024 * 1024) throw httpError(413, "图片太大了（请小于 12MB）");

      await mkdir(UPLOAD_DIR, { recursive: true });
      const name = `${Date.now()}.${ext}`;
      const localPath = path.join(UPLOAD_DIR, name);
      await writeFile(localPath, buf);

      const { publicUrl, verified, repo } = await publishImage(localPath, name);

      const cfg = await loadConfig();
      cfg.character.source_image.url = publicUrl;
      cfg.character.source_image.media_type = `image/${ext === "jpg" ? "jpeg" : ext}`;
      cfg.character.source_image.local_path = `assets/uploads/${name}`;
      cfg.character.source_image.description = ""; // 换了照片，旧的英文描述不再适用
      await persistConfig(cfg);

      return send(res, 200, {
        ok: true,
        url: publicUrl,
        verified,
        repo,
        preview: `/assets/uploads/${name}`,
        local_path: `assets/uploads/${name}`,
        note: verified ? "公网地址已生效" : "已上传，公网地址生效中（通常几秒内可用）"
      });
    }

    // ---- 远程图片转 dataURL（给前端做比例裁切用） ----
    if (req.method === "POST" && url.pathname === "/proxy-image") {
      const body = await readBody(req);
      const target = assertPublicUrl(String(body.url || "").trim());
      const r = await fetch(target, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw httpError(502, `图片抓取失败（HTTP ${r.status}）`);
      const type = r.headers.get("content-type") || "image/jpeg";
      if (!/^image\//i.test(type)) throw httpError(400, "这个地址不是图片");
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) throw httpError(413, "图片太大（超过 12MB）");
      return send(res, 200, { ok: true, data: `data:${type};base64,${buf.toString("base64")}` });
    }

    // ---- 会话（可带一次性音色覆盖：?voice=xxx&provider=&model= 用于试听对比，不写入配置） ----
    if (req.method === "POST" && url.pathname === "/session") {
      const cfg = await loadConfig();
      const vid = (url.searchParams.get("voice") || "").trim();
      const override = vid
        ? {
            tts_voice_id: vid,
            tts_provider: (url.searchParams.get("provider") || "").trim(),
            tts_model_id: (url.searchParams.get("model") || "").trim()
          }
        : null;
      const info = await createSession(cfg, override);
      return send(res, 200, info);
    }
    if (req.method === "POST" && url.pathname === "/close") {
      const cfg = await loadConfig();
      const info = await closeSession(cfg);
      return send(res, 200, { ok: true, ...info });
    }

    // ---- 退出服务（供「关闭.cmd」调用）----
    if (req.method === "POST" && url.pathname === "/shutdown") {
      send(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 150);
      return;
    }

    // ---- 静态资源 ----
    if (req.method === "GET") {
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204, { "Cache-Control": "no-store" });
        return res.end();
      }
      const file = STATIC_FILES[url.pathname];
      if (file) return send(res, 200, await readFile(path.join(ROOT, file[0])), file[1]);
      if (url.pathname.startsWith("/assets/")) {
        const rel = url.pathname.slice("/assets/".length);
        const name = path.basename(rel);
        const ext = path.extname(name).toLowerCase();
        if (!ASSET_TYPES[ext]) return send(res, 404, { error: "不支持的文件类型" });
        // 仅允许 assets/ 根目录与 assets/uploads/ 子目录，防止路径穿越
        const sub = rel.includes("/") ? "uploads" : "";
        if (rel.includes("/") && !rel.startsWith("uploads/")) return send(res, 404, { error: "Not Found" });
        try {
          const data = await readFile(path.join(ROOT, "assets", sub, name));
          return send(res, 200, data, ASSET_TYPES[ext]);
        } catch {
          return send(res, 404, { error: "文件不存在" });
        }
      }
    }
    send(res, 404, { error: "Not Found" });
  } catch (err) {
    send(res, err.status || 500, { error: err.message || String(err), code: err.code });
  }
}

// 启动后自动打开浏览器（设 NO_OPEN=1 可关闭）
function openBrowser(url) {
  try {
    const [cmd, args] =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    console.log("  已自动打开浏览器（不想自动打开：设 NO_OPEN=1 再启动）");
  } catch { /* 打不开浏览器不影响服务 */ }
}

const cfg0 = await loadConfig();
const HOST = (process.env.HOST || (cfg0.lan_access === false ? "127.0.0.1" : cfg0.host) || "0.0.0.0").trim();
const PORT = Number(process.env.PORT || cfg0.port || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || cfg0.https_port || 3443);
RUNTIME.host = HOST;
RUNTIME.port = PORT;
RUNTIME.httpsPort = HTTPS_PORT;

const ips = lanIPv4s().map((x) => x.address);
const cert = await ensureCert(ips);
netState.httpsReady = cert.ok;
netState.certGenerated = Boolean(cert.generated);
netState.certError = cert.ok ? "" : cert.error || "证书生成失败";
netState.httpsPort = HTTPS_PORT;
if (netState.httpsReady && cert.generated) console.log("  已生成本机自签证书 certs/（供手机 https 访问使用）");

const server = http.createServer((req, res) => handle(req, res, false));
server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  赛博女友 已启动");
  console.log("  · 本机：  http://localhost:" + PORT);
  if (HOST === "0.0.0.0") {
    if (!ips.length) console.log("  · 局域网：没检测到局域网 IPv4（检查一下网卡/Wi-Fi）");
    for (const ip of ips) console.log("  · 手机/平板：http://" + ip + ":" + PORT + "  （打字聊天可用；开麦需要 https）");
  } else {
    console.log("  · 当前只监听本机（config.json 里 lan_access / host 可打开局域网访问）");
  }
  if (netState.httpsReady) {
    for (const ip of ips) console.log("  · 手机开麦：  https://" + ip + ":" + HTTPS_PORT + "  （首次会提示证书不受信任，点「继续访问」即可）");
  } else {
    console.log("  · 手机开麦所需的 https 没起来：" + netState.certError);
  }
  console.log("  · API Key：" + (process.env.VIVIX_API_KEY ? "来自环境变量 VIVIX_API_KEY" : "请在页面右上角「设置」里填写"));
  console.log("");
  if (process.env.NO_OPEN !== "1") openBrowser(`http://localhost:${PORT}`);
});

if (netState.httpsReady) {
  try {
    const tls = await readFile(CERT_KEY, "utf8").then(async (key) => ({
      key,
      cert: await readFile(CERT_CRT, "utf8")
    }));
    const httpsServer = https.createServer(tls, (req, res) => handle(req, res, true));
    httpsServer.listen(HTTPS_PORT, HOST, () => {
      console.log("  HTTPS 已监听 " + HTTPS_PORT + " 端口（手机在此地址上可以开麦）");
    });
    httpsServer.on("error", (e) => {
      netState.httpsReady = false;
      console.log("  HTTPS 启动失败（" + e.message + "），不影响 http 使用");
    });
  } catch (e) {
    netState.httpsReady = false;
    console.log("  HTTPS 启动失败（" + e.message + "），不影响 http 使用");
  }
}
