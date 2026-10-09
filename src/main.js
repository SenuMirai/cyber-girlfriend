// 赛博女友 · 前端逻辑
// 接入：Vivix vivix-a1-stream（REST 创建会话 + WSS 控制通道 + TRTC 实时音视频）
import TRTC from "trtc-sdk-v5";
import qrcode from "qrcode-generator";
import { VOICE_GROUPS } from "./voice-catalog.js";

/* ================= 工具 ================= */
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ================= Key 本地保管 ================= */
// 公网部署时服务端不保存任何人的 Key，所以 Key 存在你自己这台设备的浏览器里，
// 每次请求通过请求头带给服务端，服务端用完即丢、不落盘。
const KEY_STORE = "cg_vivix_key";
const VOICE_KEY_STORE = "cg_voice_key";
const lsGet = (k) => {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
};
const lsSet = (k, v) => {
  try {
    v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略即可 */
  }
};
let apiKeyMem = lsGet(KEY_STORE);
let voiceKeyMem = lsGet(VOICE_KEY_STORE);

// 前端所有跟后端的往来都从这里走，统一带上使用者自己的 Key
function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (apiKeyMem) headers.set("X-Vivix-Key", apiKeyMem);
  if (voiceKeyMem) headers.set("X-Voice-Key", voiceKeyMem);
  return window.fetch(path, { ...options, headers, credentials: "same-origin" });
}

const els = {
  stage: $("#stage"),
  avatarVideo: $("#avatar-video"),
  poster: $("#poster"),
  brandDot: $("#brand-dot"),
  brandName: $("#brand-name"),
  chat: $("#chat"),
  messages: $("#messages"),
  chatCollapse: $("#chat-collapse"),
  startWrap: $("#start-wrap"),
  startBtn: $("#start-btn"),
  startCallBtn: $("#start-call-btn"),
  liveWrap: $("#live-wrap"),
  micBtn: $("#mic-btn"),
  input: $("#text-input"),
  sendBtn: $("#send-btn"),
  hangupBtn: $("#hangup-btn"),
  callChip: $("#call-chip"),
  callText: $("#call-text"),
  speakingTip: $("#speaking-tip"),
  interruptBtn: $("#interrupt-btn"),
  enableSound: $("#enable-sound"),
  toast: $("#toast"),
  shareBtn: $("#share-btn"),
  settingsBtn: $("#settings-btn"),
  settingsMask: $("#settings-mask"),
  settingsClose: $("#settings-close"),
  settingsSave: $("#settings-save"),
  speedLabel: $("#speed-label"),
  // 分享
  shareMask: $("#share-mask"),
  shareClose: $("#share-close"),
  qrImg: $("#qr-img"),
  shareLines: $("#share-lines"),
  shareTip: $("#share-tip"),
  shareCopy: $("#share-copy"),
  shareRefresh: $("#share-refresh"),
  // 上传 / 裁切
  uploadBtn: $("#cfg-upload-btn"),
  uploadInput: $("#cfg-upload"),
  uploadState: $("#cfg-upload-state"),
  uploadPreview: $("#cfg-upload-preview"),
  refetchBtn: $("#cfg-refetch-btn"),
  cropPanel: $("#crop-panel"),
  cropAspect: $("#cfg-crop-aspect"),
  cropMode: $("#cfg-crop-mode"),
  cropFocus: $("#cfg-crop-focus"),
  cropBefore: $("#crop-before"),
  cropBeforeMeta: $("#crop-before-meta"),
  cropAfter: $("#crop-after"),
  cropAfterMeta: $("#crop-after-meta"),
  cropHint: $("#crop-hint"),
  cropConfirm: $("#crop-confirm"),
  cropCancel: $("#crop-cancel"),
  ratioState: $("#cfg-ratio-state"),
  // 角色库
  charList: $("#char-list"),
  charNewName: $("#char-new-name"),
  charSaveBtn: $("#char-save-btn"),
  charExportBtn: $("#char-export-btn"),
  charImportBtn: $("#char-import-btn"),
  charImportInput: $("#char-import-input"),
  // 声线
  cfgVoice: $("#cfg-voice"),
  voiceCustom: $("#cfg-voice-custom"),
  voiceSource: $("#voice-source"),
  voiceKeyField: $("#voice-key-field"),
  voiceKey: $("#cfg-voice-key"),
  voiceKeyState: $("#voice-key-state"),
  voiceTestBtn: $("#voice-test-btn"),
  voiceTestState: $("#voice-test-state"),
  // 网络
  netLines: $("#net-lines"),
  netTip: $("#net-tip")
};

let toastTimer = null;
function toast(message, { error = false, sticky = false, duration = 5000 } = {}) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("error", error);
  els.toast.hidden = false;
  if (!sticky) toastTimer = setTimeout(() => (els.toast.hidden = true), duration);
}
function hideToast() {
  clearTimeout(toastTimer);
  els.toast.hidden = true;
}
function setBrandDot(state) {
  els.brandDot.className = "brand-dot" + (state ? ` ${state}` : "");
}

/* ================= 状态 ================= */
const state = {
  session: null,
  rtc: null,
  ws: null,
  wsReady: false,
  live: false,
  micOn: false,
  stopping: false,
  openingSent: false,
  openingBubble: null,
  openingFallback: null,
  pendingOpeningRoute: false,
  responseRoute: new Map(), // response_id -> 气泡元素
  pendingItems: new Set(),
  resumes: new Set(),
  seq: 0,
  expiryTimer: null,
  cfg: null,
  mode: "local", // local=本机自用 / public=公网部署
  net: null,
  characters: [],
  currentCharId: "",
  clonedVoices: [],
  voiceTest: null // 试听音色时的一次性覆盖 {tts_voice_id, tts_provider, tts_model_id}
};

/* ================= 配置 ================= */
function ratioOf(aspect) {
  const [w, h] = String(aspect || "9:16").split(":").map(Number);
  return h > 0 ? w / h : 0.5625;
}
function aspectLabel(r) {
  if (Math.abs(r - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(r - 1) < 0.02) return "1:1";
  if (Math.abs(r - 3 / 4) < 0.02) return "3:4";
  if (Math.abs(r - 4 / 3) < 0.02) return "4:3";
  return r.toFixed(2) + ":1";
}
function currentOutputRatio() {
  return ratioOf(state.cfg?.output?.aspect_ratio || "9:16");
}

// 本地文件优先（GitHub raw 在国内经常打不开，预览用本地那份最稳）
function previewUrlFor(image) {
  if (!image) return "/assets/character.jpg";
  const local = (image.local_path || "").trim();
  if (local && !/^https?:/i.test(local)) return "/" + local.replace(/^\.?\//, "");
  const url = (image.url || "").trim();
  if (!url) return "/assets/character.jpg";
  return /^https?:\/\//i.test(url) ? url : "/" + url.replace(/^\.?\//, "");
}

function applyStageRatio(aspect) {
  const r = ratioOf(aspect);
  document.documentElement.style.setProperty("--stage-r", String(r));
  layoutChat(r);
}

// 对话区停靠：宽屏停右侧（不挡人）；横版满屏时贴右内侧；窄屏跟随底部
function layoutChat(ratio) {
  const r = ratio || currentOutputRatio();
  const colW = Math.min(window.innerWidth, window.innerHeight * r);
  const room = window.innerWidth - colW;
  els.chat.classList.toggle("dock-outside", room >= 420);
  els.chat.classList.toggle("dock-inside", room < 420 && colW >= 720);
}

function applyConfigToUI(payload) {
  const { api_key_set, api_key_hint, env_key, voice_key_set, config, mode } = payload;
  state.cfg = config;
  state.mode = mode || "local";

  // 状态提示：公网部署下服务端不保存任何人的 Key，只有本浏览器里有
  const onPublic = state.mode === "public";
  $("#api-key-state").textContent = onPublic
    ? apiKeyMem
      ? "已存在本浏览器中（服务端不保存；换浏览器或换设备要重新填）"
      : "请填你自己的 Vivix API Key —— 只存在本浏览器，不会上传到服务器"
    : env_key
      ? "已通过环境变量 VIVIX_API_KEY 提供（这里的填写会被忽略）"
      : api_key_set
        ? `已保存 ${api_key_hint} · 留空表示不修改`
        : "尚未填写";
  $("#cfg-api-key").value = "";
  // 已经有可用 Key 就别弹设置面板打扰人
  if (!(onPublic && apiKeyMem) && !api_key_set && !env_key) els.settingsMask.hidden = false;

  // 表单
  $("#cfg-aspect").value = config.output.aspect_ratio;
  $("#cfg-resolution").value = config.output.resolution;
  $("#cfg-name").value = config.character.name || "";
  $("#cfg-opening").value = config.character.opening_line || "";
  $("#cfg-image-url").value = config.character.source_image.url || "";
  $("#cfg-image-desc").value = config.character.source_image.description || "";
  $("#cfg-persona").value = config.character.persona || "";
  els.cfgVoice.value = config.voice.tts_voice_id || "longanlingxi";
  els.voiceCustom.value = "";
  els.voiceKey.value = "";
  els.voiceKeyState.textContent = voice_key_set ? "已保存 ElevenLabs Key（留空表示不修改）" : "尚未填写";
  $("#cfg-speed").value = config.voice.speed ?? 1;
  els.speedLabel.textContent = Number(config.voice.speed ?? 1).toFixed(1);
  $("#cfg-speak-prompt").value = config.motion.speaking_prompt || "";
  $("#cfg-listen-prompt").value = config.motion.listening_prompt || "";
  $("#cfg-max-duration").value = Math.round((config.session.max_duration_seconds || 1200) / 60);
  $("#cfg-auto-close").value = config.session.auto_close_seconds ?? 60;
  if ($("#cfg-port")) $("#cfg-port").value = config.port ?? 3000;
  if ($("#cfg-https-port")) $("#cfg-https-port").value = config.https_port ?? 3443;
  if ($("#cfg-lan")) $("#cfg-lan").checked = config.lan_access !== false;

  syncVoiceSelection(config.voice.tts_voice_id, config.voice);
  updateImageHint();
  applyStageRatio(config.output.aspect_ratio);
  updateRatioOptions();
  applyModeUI();

  // 人物画面占位图（优先本地文件；本地缺失时回落到公网地址）
  setPoster(config.character.source_image);
  els.uploadPreview.src = previewUrlFor(config.character.source_image);
  els.uploadPreview.hidden = false;
  checkImageRatio();
}

// GitHub raw 在国内经常打不开，所以本地这份优先；万一本地文件被删了再回落到公网地址
function setPoster(image) {
  const local = previewUrlFor(image);
  const remote = (image?.url || "").trim();
  els.poster.onerror = () => {
    els.poster.onerror = null;
    if (/^https?:\/\//i.test(remote) && !els.poster.src.endsWith(remote)) els.poster.src = remote;
  };
  els.poster.src = local;
  document.documentElement.style.setProperty("--poster-url", `url("${local}")`);
}

function updateImageHint() {
  const url = $("#cfg-image-url").value.trim();
  if (state.mode === "public") {
    $("#cfg-image-hint").textContent = /^https?:\/\//i.test(url)
      ? "公网图片 ✓（Vivix 服务器可以直接抓取）"
      : "本机文件：点上面的「选择照片」，会传到这个服务自己身上并生成公网直链";
    return;
  }
  $("#cfg-image-hint").textContent = /^https?:\/\//i.test(url)
    ? "公网图片 ✓（Vivix 服务器可以直接抓取）"
    : "本机文件：Vivix 服务器抓不到。请点上面的「选择照片」自动上传，或在 config.json 填 public_base_url";
}

// 公网模式：这台服务是给所有人用的，所以把"本机/端口/局域网"这些只有自己才需要的设置收起来
function applyModeUI() {
  const onPublic = state.mode === "public";
  if ($("#net-local-opts")) $("#net-local-opts").hidden = onPublic;
  if ($("#net-title")) $("#net-title").textContent = onPublic ? "分享给朋友" : "其他设备访问";
  if ($("#api-key-label")) $("#api-key-label").textContent = onPublic ? "你自己的 Vivix API Key" : "Vivix API Key";
  const keyInput = $("#cfg-api-key");
  if (keyInput) keyInput.placeholder = onPublic ? "只存在你的浏览器里，不会上传" : "粘贴 API Key";
}

async function loadConfig() {
  const res = await apiFetch("/config");
  const payload = await res.json();
  applyConfigToUI(payload);
}

function collectConfigPatch() {
  const existing = state.cfg?.character?.source_image || {};
  const voice = resolveVoiceSelection();
  return {
    api_key: $("#cfg-api-key").value.trim(),
    voice_key: els.voiceKey.value.trim(),
    output: {
      aspect_ratio: $("#cfg-aspect").value,
      resolution: $("#cfg-resolution").value
    },
    port: Number($("#cfg-port")?.value || state.cfg?.port || 3000),
    https_port: Number($("#cfg-https-port")?.value || state.cfg?.https_port || 3443),
    lan_access: $("#cfg-lan") ? $("#cfg-lan").checked : true,
    character: {
      name: $("#cfg-name").value.trim(),
      opening_line: $("#cfg-opening").value.trim(),
      persona: $("#cfg-persona").value,
      source_image: {
        source_image_id: existing.source_image_id || "front",
        media_type: existing.media_type || "image/jpeg",
        url: $("#cfg-image-url").value.trim(),
        description: $("#cfg-image-desc").value.trim(),
        local_path: existing.local_path || ""
      }
    },
    voice: {
      tts_voice_id: voice.id,
      speed: Number($("#cfg-speed").value),
      tts_provider: voice.provider || "",
      tts_model_id: voice.model || ""
    },
    motion: {
      speaking_prompt: $("#cfg-speak-prompt").value,
      listening_prompt: $("#cfg-listen-prompt").value
    },
    session: {
      max_duration_seconds: Math.max(60, Number($("#cfg-max-duration").value || 20) * 60),
      auto_close_seconds: Math.max(0, Number($("#cfg-auto-close").value || 60)),
      recording_mode: state.cfg?.session?.recording_mode || "off"
    }
  };
}

async function saveConfig() {
  els.settingsSave.disabled = true;
  try {
    // 使用者自己填的 Key 就地留在本浏览器（公网部署时服务端不保存任何人的 Key）
    const typedKey = $("#cfg-api-key").value.trim();
    if (typedKey && !typedKey.includes("••••")) {
      apiKeyMem = typedKey;
      lsSet(KEY_STORE, typedKey);
    }
    const typedVoiceKey = els.voiceKey.value.trim();
    if (typedVoiceKey && !typedVoiceKey.includes("••••")) {
      voiceKeyMem = typedVoiceKey;
      lsSet(VOICE_KEY_STORE, typedVoiceKey);
    }
    const res = await apiFetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectConfigPatch())
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存失败");
    await loadConfig();
    await refreshCharacters();
    await loadNetInfo();
    els.settingsMask.hidden = true;
    toast("设置已保存，下次开始聊天时生效", { duration: 3000 });
  } catch (e) {
    toast(`保存失败：${e.message}`, { error: true });
  } finally {
    els.settingsSave.disabled = false;
  }
}

/* ================= 角色列表 ================= */
async function refreshCharacters() {
  try {
    const res = await apiFetch("/characters");
    const data = await res.json();
    state.characters = data.characters || [];
  } catch {
    state.characters = [];
  }
  renderCharacters();
}

function renderCharacters() {
  if (!state.characters.length) {
    els.charList.innerHTML = '<p class="tip">还没有存过角色。点上面「保存当前设置为角色」，把现在的形象图 + 人设 + 声线整体存下来。</p>';
    return;
  }
  els.charList.innerHTML = "";
  for (const c of state.characters) {
    const card = document.createElement("div");
    card.className = "char-card";
    const thumbSrc = c.thumbnail || c.image_url || "";
    const thumb = thumbSrc ? `<img src="${esc(thumbSrc)}" alt="" />` : '<span class="char-noimg">无图</span>';
    card.innerHTML = `
      <div class="char-thumb">${thumb}</div>
      <div class="char-meta">
        <input class="char-name-input" type="text" value="${esc(c.name)}" maxlength="40" />
        <div class="char-sub">${esc(c.voice_name || c.voice_id || "未设音色")}</div>
        <div class="char-sub">${esc(c.aspect_ratio || "9:16")}${c.updated_at ? " · " + esc(String(c.updated_at).slice(0, 10)) : ""}</div>
      </div>
      <div class="char-acts">
        <button class="mini-btn" data-act="apply" type="button">载入</button>
        <button class="mini-btn danger-ish" data-act="delete" type="button">删除</button>
      </div>`;
    card.querySelector('[data-act="apply"]').addEventListener("click", () => applyCharacter(c));
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteCharacter(c));
    const thumbImg = card.querySelector(".char-thumb img");
    if (thumbImg && c.image_url && c.image_url !== thumbSrc) {
      thumbImg.addEventListener("error", () => {
        thumbImg.src = c.image_url;
      }, { once: true });
    }
    const nameInput = card.querySelector(".char-name-input");
    nameInput.addEventListener("change", () => renameCharacter(c, nameInput.value.trim()));
    els.charList.appendChild(card);
  }
}

async function saveCharacter() {
  const name = (els.charNewName?.value || "").trim() || $("#cfg-name").value.trim();
  if (!name) return toast("先给角色起个名字（上面的输入框，或下面「名字」字段）", { error: true });
  els.charSaveBtn.disabled = true;
  try {
    // 先把当前表单内容落盘，再快照，避免存到旧值
    await apiFetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectConfigPatch())
    }).then((r) => r.json()).then((d) => {
      if (d.error) throw new Error(d.error);
    });
    const res = await apiFetch("/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存失败");
    if (els.charNewName) els.charNewName.value = "";
    state.currentCharId = data.character.id;
    await loadConfig();
    await refreshCharacters();
    toast(`已存为角色「${data.character.name}」`, { duration: 3000 });
  } catch (e) {
    toast(`保存角色失败：${e.message}`, { error: true });
  } finally {
    els.charSaveBtn.disabled = false;
  }
}

async function applyCharacter(c) {
  try {
    const res = await apiFetch(`/characters/${encodeURIComponent(c.id)}/apply`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "载入失败");
    state.currentCharId = c.id;
    await loadConfig();
    updateRatioOptions();
    toast(`已载入「${c.name}」${state.session ? "，挂断后重新开始聊天才会换人" : "，点「开始聊天」生效"}`, { duration: 4000 });
  } catch (e) {
    toast(`载入失败：${e.message}`, { error: true });
  }
}

async function renameCharacter(c, name) {
  if (!name || name === c.name) return;
  try {
    const res = await apiFetch(`/characters/${encodeURIComponent(c.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "改名失败");
    c.name = data.character.name;
    toast("已改名", { duration: 2000 });
  } catch (e) {
    toast(`改名失败：${e.message}`, { error: true });
    renderCharacters();
  }
}

async function deleteCharacter(c) {
  if (!window.confirm(`删除角色「${c.name}」？（同时清理它独占的本地图片，已上传到 GitHub 的那份不动）`)) return;
  try {
    const res = await apiFetch(`/characters/${encodeURIComponent(c.id)}?purge=1`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "删除失败");
    await refreshCharacters();
    toast(`已删除「${c.name}」`, { duration: 2500 });
  } catch (e) {
    toast(`删除失败：${e.message}`, { error: true });
  }
}

function exportCharacters() {
  window.location.href = "/characters/export";
}

async function importCharacters(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.characters)) throw new Error("这不是本程序导出的角色包");
    const res = await apiFetch("/characters/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: parsed })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "导入失败");
    await refreshCharacters();
    toast(`导入了 ${data.added} 个角色`, { duration: 3000 });
  } catch (e) {
    toast(`导入失败：${e.message}`, { error: true });
  }
}

/* ================= 形象图：比例归一化 ================= */
// 核心：Vivix 拿首图当基准生成视频，首图比例 ≠ 输出比例时，模型会把人物拉伸（竖版看起来就是被压扁变窄）。
// 所以在「上传前」就把图片做成目标比例的成品：要么裁切铺满，要么补边不裁人，人物比例始终是对的。
const CROP = {
  source: null, // HTMLImageElement
  sourceLabel: "",
  sw: 0,
  sh: 0,
  result: null // { dataUrl, tw, th, mode }
};

function maxSideFor(targetR) {
  const MAX_SIDE = 2048;
  const MAX_PIXELS = 4.4e6;
  let w, h;
  if (targetR <= 1) {
    h = MAX_SIDE;
    w = Math.round(h * targetR);
  } else {
    w = MAX_SIDE;
    h = Math.round(w / targetR);
  }
  const px = w * h;
  if (px > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / px);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return { w: w - (w % 2), h: h - (h % 2) };
}

function decideCropMode(sw, sh, targetR, mode) {
  if (mode !== "auto") return mode;
  const srcR = sw / sh;
  const kept = srcR > targetR ? targetR / srcR : srcR / targetR; // 裁切后还能留下多少面积
  return kept >= 0.55 ? "cover" : "contain";
}

function drawNormalized(img, { targetR, mode, focus }) {
  const { w: tw, h: th } = maxSideFor(targetR);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const real = decideCropMode(sw, sh, targetR, mode);
  const cv = document.createElement("canvas");
  cv.width = tw;
  cv.height = th;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const fy = focus === "top" ? 0.15 : focus === "bottom" ? 0.85 : 0.5;

  if (real === "cover") {
    const scale = Math.max(tw / sw, th / sh);
    const cw = tw / scale;
    const ch = th / scale;
    const sx = (sw - cw) * 0.5;
    const sy = (sh - ch) * fy;
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, tw, th);
  } else {
    // 背景用同一张图的模糊放大版铺满，避免生硬黑边；前景保持原比例完整放入
    ctx.fillStyle = "#0b0b0e";
    ctx.fillRect(0, 0, tw, th);
    try {
      ctx.save();
      ctx.filter = "blur(26px) brightness(0.55) saturate(1.15)";
      const bScale = Math.max(tw / sw, th / sh) * 1.14;
      const bw = sw * bScale;
      const bh = sh * bScale;
      ctx.drawImage(img, (tw - bw) / 2, (th - bh) / 2, bw, bh);
      ctx.restore();
    } catch { /* 老浏览器不支持 canvas filter，就用上面的深色底 */ }
    const scale = Math.min(tw / sw, th / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
  }
  return { dataUrl: cv.toDataURL("image/jpeg", 0.92), tw, th, mode: real };
}

function updateRatioOptions() {
  // 「跟随画面比例」把当前输出比例写在选项文字里，用户一眼知道会做成什么样
  const first = els.cropAspect?.querySelector('option[value="follow"]');
  if (first) first.textContent = `跟随画面比例（当前 ${state.cfg?.output?.aspect_ratio || "9:16"}）`;
}

function targetRatioForCrop() {
  const v = els.cropAspect.value;
  return v === "follow" ? currentOutputRatio() : ratioOf(v);
}

function openCropPreview(img, label) {
  CROP.source = img;
  CROP.sourceLabel = label;
  CROP.sw = img.naturalWidth;
  CROP.sh = img.naturalHeight;
  els.cropBefore.src = img.src;
  els.cropBeforeMeta.textContent = `${CROP.sw} × ${CROP.sh} · ${aspectLabel(CROP.sw / CROP.sh)}`;
  els.cropPanel.hidden = false;
  renderCropResult();
}

function renderCropResult() {
  if (!CROP.source) return;
  const targetR = targetRatioForCrop();
  const res = drawNormalized(CROP.source, {
    targetR,
    mode: els.cropMode.value,
    focus: els.cropFocus.value
  });
  CROP.result = res;
  els.cropAfter.src = res.dataUrl;
  els.cropAfterMeta.textContent = `${res.tw} × ${res.th} · ${aspectLabel(res.tw / res.th)}`;

  const srcR = CROP.sw / CROP.sh;
  const same = Math.abs(srcR - targetR) / targetR < 0.03;
  const cropAxis = srcR > targetR ? "左右" : "上下";
  let text;
  if (same) {
    text = "原图比例已经和目标一致，直接缩放即可，人物不会变形。";
  } else if (res.mode === "cover") {
    text = `原图比目标${srcR > targetR ? "宽" : "高"}，裁切会切掉${cropAxis}多余部分，人物比例不变；想少切一点就选「补边不裁人」。`;
  } else {
    text = `原图比目标${srcR > targetR ? "宽" : "高"}得比较多，硬裁会切掉人物，所以用「补边」：人物完整保留，多余部分用这张图自己的模糊版补上。`;
  }
  if (res.mode === "cover" && srcR > targetR) text += "（本次裁的是左右，取景选项不起作用）";
  els.cropHint.textContent = text;
}

function loadImageFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("这张图片读不出来"));
    img.src = src;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("读文件失败"));
    fr.readAsDataURL(file);
  });
}

async function handlePickFile(file) {
  try {
    setUploadState("读取图片…");
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImageFromSrc(dataUrl);
    setUploadState("");
    openCropPreview(img, file.name);
  } catch (e) {
    setUploadState(`❌ ${e.message}`, true);
  }
}

// 把当前已经在用的图片抓回来重新裁（换过画面比例之后修复变形用）
async function refetchCurrentImage() {
  const url = $("#cfg-image-url").value.trim();
  const local = state.cfg?.character?.source_image?.local_path || "";
  els.refetchBtn.disabled = true;
  try {
    setUploadState("取回当前图片…");
    let src = "";
    if (local) src = "/" + local.replace(/^\.?\//, "");
    else if (/^https?:\/\//i.test(url)) {
      const r = await apiFetch("/proxy-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "取回失败");
      src = d.data;
    } else {
      throw new Error("当前还没有形象图，先点「选择照片」");
    }
    const img = await loadImageFromSrc(src);
    setUploadState("");
    openCropPreview(img, "当前图片");
  } catch (e) {
    setUploadState(`❌ ${e.message}`, true);
  } finally {
    els.refetchBtn.disabled = false;
  }
}

async function confirmUpload() {
  if (!CROP.result) return;
  els.cropConfirm.disabled = true;
  try {
    setUploadState("上传中…（传到 GitHub，稍等几秒）");
    const res = await apiFetch("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: CROP.result.dataUrl })
    });
    const info = await res.json();
    if (!res.ok) throw new Error(info.error || "上传失败");
    $("#cfg-image-url").value = info.url;
    $("#cfg-image-desc").value = "";
    updateImageHint();

    // 服务端只认了 url，本地这份路径也要落到 state 里，预览才会用本地文件
    if (state.cfg?.character?.source_image) {
      state.cfg.character.source_image.url = info.url;
      state.cfg.character.source_image.local_path = info.local_path;
      state.cfg.character.source_image.media_type = "image/jpeg";
      state.cfg.character.source_image.description = "";
    }
    els.cropPanel.hidden = true;
    CROP.source = null;
    CROP.result = null;
    els.uploadPreview.src = info.preview;
    els.uploadPreview.hidden = false;
    els.poster.src = info.preview;
    document.documentElement.style.setProperty("--poster-url", `url("${info.preview}")`);
    setUploadState(`✅ 已换新形象图，${info.note}`);
    checkImageRatio();
    toast("形象图已按目标比例处理好并上传，点「开始聊天」看效果", { duration: 4000 });
  } catch (e) {
    setUploadState(`❌ ${e.message}`, true);
  } finally {
    els.cropConfirm.disabled = false;
  }
}

function setUploadState(text, isError = false) {
  els.uploadState.textContent = text;
  els.uploadState.style.color = isError ? "#ff8d98" : "";
}

function measureImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// 检查「当前形象图」和「输出比例」配不配 —— 这就是竖版被压扁的根源
async function checkImageRatio() {
  if (!els.ratioState) return;
  const image = state.cfg?.character?.source_image;
  if (!image?.url) {
    els.ratioState.textContent = "还没有形象图，先点「选择照片」。";
    return;
  }
  els.ratioState.textContent = "检查当前形象图…";
  const dim = await measureImage(previewUrlFor(image));
  if (!dim || !dim.w) {
    els.ratioState.textContent = "读不到这张图（可能网络不通）。点「重新裁切当前图片」可以按目标比例重新处理一张。";
    return;
  }
  const srcR = dim.w / dim.h;
  const targetR = currentOutputRatio();
  const same = Math.abs(srcR - targetR) / targetR < 0.03;
  if (same) {
    els.ratioState.textContent = `✅ ${dim.w}×${dim.h}（${aspectLabel(srcR)}）与输出比例一致，人物不会变形。`;
  } else {
    els.ratioState.textContent =
      `⚠️ 当前形象图是 ${dim.w}×${dim.h}（${aspectLabel(srcR)}），输出是 ${aspectLabel(targetR)}：` +
      `模型会按输出比例去生成，人物容易被压扁变窄。点「重新裁切当前图片」修一下。`;
  }
}

/* ================= 声线目录 ================= */
function buildVoiceSelect() {
  const sel = els.cfgVoice;
  sel.innerHTML = "";
  const groups = VOICE_GROUPS.map((g) => ({ ...g }));
  if (state.clonedVoices.length) {
    groups.push({
      id: "cloned",
      label: "我的克隆音色（来自你的 Vivix 工作区）",
      provider: "",
      model: "",
      source: "cloned",
      items: state.clonedVoices
    });
  }
  for (const g of groups) {
    const og = document.createElement("optgroup");
    og.label = g.label;
    for (const v of g.items) {
      const op = document.createElement("option");
      op.value = v.id;
      op.textContent = v.desc ? `${v.name} · ${v.desc}` : v.name;
      op.dataset.provider = g.provider || "";
      op.dataset.model = g.model || "";
      op.dataset.source = g.source || "";
      og.appendChild(op);
    }
    sel.appendChild(og);
  }
}

// 当前配置里的音色如果不在目录里（比如手填的 ID、历史遗留），临时补一项出来，避免静默改成别的音色
function syncVoiceSelection(id, voice) {
  if (!id) return;
  let found = [...els.cfgVoice.options].some((o) => o.value === id);
  if (!found) {
    const og = document.createElement("optgroup");
    og.label = "当前使用（不在目录里）";
    const op = document.createElement("option");
    op.value = id;
    op.textContent = `${id} · 当前使用`;
    op.dataset.provider = voice?.tts_provider || "";
    op.dataset.model = voice?.tts_model_id || "";
    op.dataset.source = "custom";
    og.appendChild(op);
    els.cfgVoice.appendChild(og);
  }
  els.cfgVoice.value = id;
  updateVoiceNote();
}

function resolveVoiceSelection() {
  const custom = els.voiceCustom.value.trim();
  if (custom) return { id: custom, provider: "", model: "", source: "custom" };
  const op = els.cfgVoice.selectedOptions[0];
  return {
    id: els.cfgVoice.value,
    provider: op?.dataset.provider || "",
    model: op?.dataset.model || "",
    source: op?.dataset.source || ""
  };
}

function updateVoiceNote() {
  const op = els.cfgVoice.selectedOptions[0];
  if (!op) return;
  const src = op.dataset.source;
  const custom = els.voiceCustom.value.trim();
  let note = "";
  if (src === "official") note = "✅ 来自 Vivix 官方文档，可直接用。";
  else if (src === "candidate") note = "⚠️ 候选音色：出自 CosyVoice 官方音色表，Vivix 文档没列。能用最好，报错就换回上面「已验证」那几组。";
  else if (src === "cloned") note = "✅ 你自己克隆的音色，直接可用。";
  else note = "自定义 ID，能不能用取决于 Vivix 那边认不认。";
  if (custom) note = `将使用手填的「${custom}」，下拉里选的会被忽略。`;
  els.voiceSource.textContent = note;
  const isEleven = op.dataset.provider === "elevenlabs";
  els.voiceKeyField.hidden = !isEleven;
  els.voiceTestState.textContent = isEleven
    ? "ElevenLabs 音色要你先填上面的 Key，否则会报错"
    : "会真实开一次会话（计费），听完点挂断即可";
}

async function loadVoiceCatalog() {
  try {
    const res = await apiFetch("/voices");
    const data = await res.json();
    state.clonedVoices = data.cloned || [];
    buildVoiceSelect();
    if (data.notice) toast(data.notice, { error: true, duration: 6000 });
    if (state.cfg) syncVoiceSelection(state.cfg.voice.tts_voice_id, state.cfg.voice);
  } catch {
    buildVoiceSelect();
  }
}

/* ================= 其他设备访问 ================= */
async function loadNetInfo() {
  try {
    const res = await apiFetch("/netinfo");
    state.net = await res.json();
  } catch {
    state.net = null;
  }
  renderNetInfo();
  renderShare();
}

function renderNetInfo() {
  const n = state.net;
  if (!n || !els.netLines) return;

  // 公网部署：不需要局域网那套说明，直接告诉大家网址
  if (n.mode === "public") {
    const url = n.public_url || location.origin;
    els.netLines.innerHTML = [`<div class="net-line">网址：<b>${esc(url)}</b></div>`].join("");
    els.netTip.textContent =
      "这个服务部署在公网上，把网址发给谁，谁就能打开用（要用自己的 Vivix API Key）。手机浏览器打开这个网址就能开麦，不需要装任何东西。";
    return;
  }

  const lines = [`本机：${n.local}`];
  for (const l of n.lan || []) {
    lines.push(`${l.name}：${l.http}${l.https ? ` ｜ 开麦：${l.https}` : ""}`);
  }
  els.netLines.innerHTML = lines.map((t) => `<div class="net-line">${esc(t)}</div>`).join("");
  els.netTip.textContent = n.https_ready
    ? "手机、平板连同一个 Wi-Fi 就能打开上面的地址。想在手机上开麦说话，必须用 https 那个地址（http 下浏览器会禁用麦克风）；首次打开会提示证书不受信任，点「继续访问」即可。"
    : `手机想开麦需要 https，但本机证书没起来：${n.cert_error || "未知原因"}。此时手机仍可正常打字聊天。`;
}

function bestShareUrl() {
  const n = state.net;
  if (!n) return location.origin;
  if (n.mode === "public") return n.public_url || location.origin;
  const lan = (n.lan || [])[0];
  if (!lan) return n.local;
  return lan.https || lan.http;
}

function renderQr(text) {
  try {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    els.qrImg.src = qr.createDataURL(4, 8);
  } catch (e) {
    els.qrImg.removeAttribute("src");
    toast(`二维码生成失败：${e.message}`, { error: true });
  }
}

function renderShare() {
  const n = state.net;
  if (!n) return;
  const url = bestShareUrl();
  renderQr(url);

  if (n.mode === "public") {
    els.shareLines.innerHTML = [
      `扫码打开：<b>${esc(url)}</b>`,
      "手机浏览器直接打开就能用，不用装东西，也不用连同一个 Wi-Fi。"
    ]
      .map((t) => `<div class="net-line">${t}</div>`)
      .join("");
    els.shareTip.textContent = "第一次打开会让你填自己的 Vivix API Key，填一次就记住了。手机开麦需要浏览器授权麦克风，点允许即可。";
    return;
  }

  const rows = [];
  rows.push(`扫码地址：<b>${esc(url)}</b>`);
  for (const l of n.lan || []) {
    rows.push(`${esc(l.name)}　打字：${esc(l.http)}${l.https ? `　开麦：${esc(l.https)}` : ""}`);
  }
  if (!(n.lan || []).length) {
    rows.push("没检测到局域网地址：确认这台电脑连着 Wi-Fi/网线，且没被防火墙挡住。");
  }
  els.shareLines.innerHTML = rows.map((t) => `<div class="net-line">${t}</div>`).join("");
  els.shareTip.textContent = n.https_ready
    ? "手机首次打开 https 地址会提示「证书无效」，点「高级 → 继续前往」就能用，之后就能开麦了。"
    : "当前 https 没起来，手机只能用打字聊天；想在手机开麦请先修好证书问题。";
}

function openShare() {
  els.shareMask.hidden = false;
  loadNetInfo();
}

/* ================= 消息气泡 ================= */
function addMessage(role, text = "", { streaming = false } = {}) {
  const el = document.createElement("div");
  el.className = `msg ${role}${streaming ? " streaming" : ""}`;
  el.textContent = text;
  els.messages.appendChild(el);
  els.messages.scrollTop = els.messages.scrollHeight;
  return el;
}

/* ================= 控制通道 ================= */
function wsSend(obj) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
  state.ws.send(JSON.stringify(obj));
  return true;
}

function connectControl(info) {
  return new Promise((resolve, reject) => {
    const url = new URL(info.control.url);
    url.searchParams.set("token", info.control.client_secret);
    const ws = new WebSocket(url);
    state.ws = ws;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("控制通道连接超时"));
    }, 15000);

    ws.onopen = () => {
      clearTimeout(timer);
      state.wsReady = true;
      resolve();
    };
    ws.onerror = () => {
      if (!state.wsReady) {
        clearTimeout(timer);
        reject(new Error("控制通道连接失败"));
      }
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (!state.wsReady) return reject(new Error("控制通道连接失败"));
      state.wsReady = false;
      if (!state.stopping) {
        setBrandDot("error");
        toast("控制通道已断开，请挂断后重新开始", { error: true, sticky: true });
      }
    };
    ws.onmessage = ({ data }) => {
      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        return; // 忽略无法解析的消息
      }
      handleServerEvent(evt);
    };
  });
}

function handleServerEvent(evt) {
  const rid = evt.response_id || evt.response?.id;
  switch (evt.type) {
    case "conversation.item.created":
      // 文字消息已入库 → 请求她回答
      if (evt.item?.id && state.pendingItems.has(evt.item.id)) {
        state.pendingItems.delete(evt.item.id);
        wsSend({ type: "response.create" });
      }
      break;

    case "response.created":
      if (state.pendingOpeningRoute && rid) {
        state.pendingOpeningRoute = false;
        if (state.openingBubble) state.responseRoute.set(rid, state.openingBubble);
      }
      break;

    case "response.output_text.delta": {
      const el = routeBubble(rid);
      if (el) {
        el.textContent += evt.delta || "";
        els.messages.scrollTop = els.messages.scrollHeight;
      }
      break;
    }

    case "response.output_text.done": {
      const el = routeBubble(rid);
      if (el && typeof evt.text === "string" && evt.text) el.textContent = evt.text;
      finishBubble(el);
      break;
    }

    case "response.done":
      finishBubble(routeBubble(rid));
      els.speakingTip.hidden = true;
      break;

    case "response.render.started":
      els.speakingTip.hidden = false;
      break;

    case "response.render.stopped":
      els.speakingTip.hidden = true;
      break;

    case "conversation.item.input_audio_transcription.completed":
      if (evt.transcript) addMessage("user", evt.transcript);
      break;

    case "session.closed":
      if (!state.stopping) {
        toast("会话已结束", {});
        resetToIdle({ keepChat: true, system: "会话已结束" });
      }
      break;

    case "error": {
      const msg = evt.error?.message || evt.message || "未知错误";
      if (evt.error?.code === "response_not_active" || /no active response/i.test(msg)) break; // 打断时空响应，忽略
      toast(`服务端提示：${msg}`, { error: true });
      break;
    }

    default:
      break; // 前向兼容：忽略未知事件
  }
}

function routeBubble(rid) {
  if (!rid) return null;
  if (!state.responseRoute.has(rid)) {
    // 新的一条她的话：新建气泡
    const el = addMessage("assistant", "", { streaming: true });
    state.responseRoute.set(rid, el);
  }
  const el = state.responseRoute.get(rid);
  // 有真实文本事件到达时，取消开场白的兜底展示
  if (el === state.openingBubble && state.openingFallback) {
    clearTimeout(state.openingFallback);
    state.openingFallback = null;
  }
  return el;
}

function finishBubble(el) {
  if (el) el.classList.remove("streaming");
}

/* ================= TRTC 实时音视频 ================= */
async function connectRtc(info) {
  const media = info.delivery?.media?.trtc;
  if (!media) throw new Error("会话没有返回 TRTC 播放凭证");

  const rtc = TRTC.create();
  state.rtc = rtc;

  rtc.on(TRTC.EVENT.AUTOPLAY_FAILED, (event) => {
    state.resumes.add(event.resume);
    els.enableSound.hidden = false;
  });
  rtc.on(TRTC.EVENT.ERROR, (e) => toast(`播放出错：${e.message || e}`, { error: true }));
  rtc.on(TRTC.EVENT.REMOTE_VIDEO_AVAILABLE, ({ userId, streamType }) => {
    if (userId !== media.publisher_user_id) return;
    rtc
      .startRemoteVideo({ userId, streamType, view: "avatar-video" })
      .catch((e) => toast(`视频接入失败：${e.message || e}`, { error: true, sticky: true }));
  });
  rtc.on(TRTC.EVENT.FIRST_VIDEO_FRAME, ({ userId }) => {
    if (userId === media.publisher_user_id) onFirstFrame();
  });

  await rtc.enterRoom({
    sdkAppId: Number(media.sdk_app_id),
    userId: media.user_id,
    userSig: media.user_sig,
    strRoomId: media.room_id,
    scene: TRTC.TYPE.SCENE_RTC,
    autoReceiveVideo: false
  });
}

function onFirstFrame() {
  if (state.live) return;
  state.live = true;
  els.stage.classList.add("live");
  hideToast();
  setBrandDot(state.micOn ? "call" : "live");
  setTimeout(sendOpening, 350);
}

/* ================= 开场白（精确台词） ================= */
const VOICE_TEST_LINE = "你好，现在听到的就是这个声音，你觉得合适吗？";

function sendOpening() {
  const testing = Boolean(state.voiceTest);
  const line = testing ? VOICE_TEST_LINE : (state.cfg?.character?.opening_line || "").trim();
  if (!line || state.openingSent || !state.wsReady) return;
  state.openingSent = true;

  const bubble = addMessage("assistant", "", { streaming: true });
  state.openingBubble = bubble;
  state.pendingOpeningRoute = true;
  // 若服务端没有回文本事件，兜底展示台词
  state.openingFallback = setTimeout(() => {
    if (!bubble.textContent) bubble.textContent = line;
    bubble.classList.remove("streaming");
  }, 1600);

  wsSend({
    type: "response.create",
    response: { script: { vocal: { type: "speech", text: line } } }
  });
  if (testing) toast("正在试听这个音色，听完点右下角挂断就行", { duration: 6000 });
}

/* ================= 会话生命周期 ================= */
async function startChat({ withMic = false, testVoice = false } = {}) {
  if (state.session || els.startBtn.disabled) return;
  els.startBtn.disabled = true;
  els.startCallBtn.disabled = true;
  setBrandDot("connecting");
  toast(testVoice ? "正在用这个音色开一次会话…" : "正在唤醒她…", { sticky: true });

  try {
    let path = "/session";
    if (testVoice && state.voiceTest) {
      const q = new URLSearchParams({
        voice: state.voiceTest.tts_voice_id,
        provider: state.voiceTest.tts_provider || "",
        model: state.voiceTest.tts_model_id || ""
      });
      path += "?" + q.toString();
    }
    const res = await apiFetch(path, { method: "POST" });
    const info = await res.json();
    if (!res.ok) throw new Error(info.error || `创建会话失败（HTTP ${res.status}）`);
    state.session = info;
    state.stopping = false;

    await connectControl(info);
    await connectRtc(info);

    enterLiveUI();
    toast("已接通 · 和她说说话吧", { duration: 2500 });
    scheduleExpiry(info.expires_at);
    if (withMic) await toggleMic(true);
  } catch (e) {
    const isTest = Boolean(state.voiceTest);
    await hangup({ silent: true });
    setBrandDot("error");
    toast(
      isTest
        ? `这个音色没通过：${e.message}\n（多半是 Vivix 不认这个 ID，换回「已验证」分组里的音色）`
        : e.message,
      { error: true, sticky: true }
    );
  } finally {
    els.startBtn.disabled = false;
    els.startCallBtn.disabled = false;
  }
}

function enterLiveUI() {
  els.startWrap.hidden = true;
  els.liveWrap.hidden = false;
  els.chat.hidden = false;
  els.input.focus({ preventScroll: true });
}

async function hangup({ silent = false } = {}) {
  state.stopping = true;
  clearTimeout(state.expiryTimer);
  try {
    await apiFetch("/close", { method: "POST" });
  } catch {
    /* 忽略关闭失败 */
  }
  try {
    if (state.micOn) await state.rtc?.stopLocalAudio();
  } catch { /* 忽略 */ }
  try {
    await state.rtc?.exitRoom();
  } catch { /* 忽略 */ }
  try {
    state.rtc?.destroy?.();
  } catch { /* 忽略 */ }
  try {
    state.ws?.close();
  } catch { /* 忽略 */ }
  resetToIdle({ keepChat: true, system: silent ? "" : "已挂断" });
}

function resetToIdle({ keepChat = true, system = "" } = {}) {
  if (system) addMessage("system", system);
  state.session = null;
  state.rtc = null;
  state.ws = null;
  state.wsReady = false;
  state.live = false;
  state.micOn = false;
  state.openingSent = false;
  state.openingBubble = null;
  state.pendingOpeningRoute = false;
  state.voiceTest = null;
  clearTimeout(state.openingFallback);
  state.responseRoute.clear();
  state.pendingItems.clear();
  state.resumes.clear();
  els.avatarVideo.innerHTML = "";
  els.stage.classList.remove("live");
  els.liveWrap.hidden = true;
  els.startWrap.hidden = false;
  els.speakingTip.hidden = true;
  els.enableSound.hidden = true;
  els.callChip.hidden = true;
  els.micBtn.classList.remove("active");
  setCallText(false);
  if (!keepChat) els.messages.innerHTML = "";
  setBrandDot("");
}

function scheduleExpiry(expiresAt) {
  clearTimeout(state.expiryTimer);
  if (!expiresAt) return;
  const delay = new Date(expiresAt).getTime() - Date.now() - 5000;
  if (delay <= 0) return;
  state.expiryTimer = setTimeout(() => {
    toast("本次通话时长已到，会话自动结束", { duration: 6000 });
    hangup({ silent: true });
  }, Math.min(delay, 2 ** 31 - 1));
}

/* ================= 麦克风 / 通话 ================= */
async function toggleMic(forceOn) {
  if (!state.rtc) return;
  const wantOn = forceOn === undefined ? !state.micOn : forceOn;
  if (wantOn && !window.isSecureContext) {
    toast(
      "手机/平板用 http 地址时浏览器不允许开麦克风。请改用启动时提示的 https 地址打开（本机 localhost 不受影响）。",
      { error: true, duration: 9000 }
    );
    return;
  }
  try {
    if (wantOn && !state.micOn) {
      await state.rtc.startLocalAudio();
      state.micOn = true;
    } else if (!wantOn && state.micOn) {
      await state.rtc.stopLocalAudio();
      state.micOn = false;
    }
  } catch (e) {
    toast(`麦克风开启失败：${e.message || e}（请允许麦克风权限，并用 localhost 或 https 打开页面）`, { error: true });
    state.micOn = false;
  }
  els.micBtn.classList.toggle("active", state.micOn);
  els.callChip.hidden = !state.micOn;
  setCallText(state.micOn);
  if (state.live) setBrandDot(state.micOn ? "call" : "live");
}

function setCallText(on) {
  els.callText.textContent = on ? "通话中 · 直接说话就行" : "";
  els.input.placeholder = on ? "也可以打字…" : "和她说点什么…";
}

/* ================= 文字消息 ================= */
function sendText() {
  const text = els.input.value.trim();
  if (!text) return;
  if (!state.wsReady) {
    toast("还没接通，请先点「开始聊天」", { duration: 2500 });
    return;
  }
  els.input.value = "";
  addMessage("user", text);
  const itemId = `user_${++state.seq}`;
  state.pendingItems.add(itemId);
  wsSend({
    type: "conversation.item.create",
    event_id: `message_${state.seq}`,
    item: {
      id: itemId,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  });
}

/* ================= 事件绑定 ================= */
els.startBtn.addEventListener("click", () => startChat());
els.startCallBtn.addEventListener("click", () => startChat({ withMic: true }));
els.hangupBtn.addEventListener("click", () => hangup());
els.micBtn.addEventListener("click", () => toggleMic());
els.sendBtn.addEventListener("click", sendText);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) sendText();
});
els.interruptBtn.addEventListener("click", () => {
  wsSend({ type: "response.cancel" });
  els.speakingTip.hidden = true;
});
els.enableSound.addEventListener("click", async () => {
  try {
    await Promise.all([...state.resumes].map((resume) => resume()));
    state.resumes.clear();
    els.enableSound.hidden = true;
  } catch (e) {
    toast(`音频播放被拦截：${e.message || e}`, { error: true });
  }
});
els.chatCollapse.addEventListener("click", () => {
  els.chat.classList.toggle("collapsed");
  els.chatCollapse.textContent = els.chat.classList.contains("collapsed") ? "展开" : "收起";
});
els.settingsBtn.addEventListener("click", () => {
  els.settingsMask.hidden = false;
  loadConfig().catch(() => {});
  loadVoiceCatalog();
  refreshCharacters();
  loadNetInfo();
});
els.settingsClose.addEventListener("click", () => (els.settingsMask.hidden = true));
els.settingsMask.addEventListener("click", (e) => {
  if (e.target === els.settingsMask) els.settingsMask.hidden = true;
});
els.settingsSave.addEventListener("click", saveConfig);

// 分享浮层
els.shareBtn.addEventListener("click", openShare);
els.shareClose.addEventListener("click", () => (els.shareMask.hidden = true));
els.shareMask.addEventListener("click", (e) => {
  if (e.target === els.shareMask) els.shareMask.hidden = true;
});
els.shareRefresh.addEventListener("click", () => loadNetInfo());
els.shareCopy.addEventListener("click", async () => {
  const url = bestShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast("地址已复制", { duration: 2000 });
  } catch {
    toast(`复制失败，手动抄一下：${url}`, { duration: 8000 });
  }
});

// 角色库
els.charSaveBtn.addEventListener("click", saveCharacter);
els.charExportBtn.addEventListener("click", exportCharacters);
els.charImportBtn.addEventListener("click", () => els.charImportInput.click());
els.charImportInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (f) importCharacters(f);
});

// 形象图
els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
els.uploadInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = ""; // 允许重复选择同一张
  if (file) handlePickFile(file);
});
els.refetchBtn.addEventListener("click", refetchCurrentImage);
els.cropConfirm.addEventListener("click", confirmUpload);
els.cropCancel.addEventListener("click", () => {
  els.cropPanel.hidden = true;
  CROP.source = null;
  CROP.result = null;
  setUploadState("");
});
for (const el of [els.cropAspect, els.cropMode, els.cropFocus]) {
  el.addEventListener("change", renderCropResult);
}
$("#cfg-image-url").addEventListener("input", updateImageHint);
$("#cfg-aspect").addEventListener("change", () => {
  // 切换比例后立刻预览新布局，并提示形象图要不要重新裁
  applyStageRatio($("#cfg-aspect").value);
  state.cfg.output.aspect_ratio = $("#cfg-aspect").value;
  updateRatioOptions();
  if (CROP.source) renderCropResult();
  checkImageRatio();
});

// 声音
els.cfgVoice.addEventListener("change", updateVoiceNote);
els.voiceCustom.addEventListener("input", updateVoiceNote);
$("#cfg-speed").addEventListener("input", (e) => {
  els.speedLabel.textContent = Number(e.target.value).toFixed(1);
});
els.voiceTestBtn.addEventListener("click", () => {
  if (state.session) return toast("已经接通了，先挂断再试听", { error: true });
  const v = resolveVoiceSelection();
  if (!v.id) return toast("先选一个音色", { error: true });
  state.voiceTest = { tts_voice_id: v.id, tts_provider: v.provider, tts_model_id: v.model };
  const isEleven = v.provider === "elevenlabs";
  toast(isEleven && !els.voiceKey.value.trim() ? "ElevenLabs 音色需要先填 Key，可能会失败" : "开始试听…", {
    duration: 3000
  });
  startChat({ testVoice: true });
});

window.addEventListener("resize", () => layoutChat());

window.addEventListener("beforeunload", () => {
  if (state.session) navigator.sendBeacon?.("/close");
});

/* ================= 启动 ================= */
buildVoiceSelect();
loadConfig()
  .then(() => {
    loadVoiceCatalog();
    refreshCharacters();
    loadNetInfo();
    if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      toast("当前是 http 打开的非本机地址，麦克风会被浏览器禁用；换用启动日志里的 https 地址即可开麦。", {
        duration: 9000
      });
    }
  })
  .catch(() => toast("读取本地配置失败，请确认服务已启动", { error: true, sticky: true }));
