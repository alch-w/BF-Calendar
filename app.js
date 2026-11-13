/** @deprecated Removed import UI — cleared on load so bundled schedule wins. */
const LEGACY_SCHEDULE_STORAGE_KEY = "festival-schedule-v2";
const FLAGS_STORAGE_KEY = "festival-flags-v1";
const FLAGS_TODAY_ONLY_STORAGE_KEY = "festival-flags-today-only-v1";
const FLAGS_VIEW_STORAGE_KEY = "festival-flags-view-v1";
/** Device-only display preference. Not part of the #f= share token. */
const CLOCK_12H_STORAGE_KEY = "festival-clock-12h-v1";

/** @typedef {{ artist: string; start: string; end: string | null; kind?: string; note?: string }} Set */
/** @typedef {{ id: string; name: string; sets: Set[]; closesAt?: string; closureNote?: string; notes?: string }} Stage */
/** @typedef {{ id: string; label: string; date: string; stages: Stage[]; hidden?: boolean; extras?: unknown[] }} Day */
/** @typedef {{ festival: string; timezone?: string; notes?: string; days: Day[] }} Schedule */

/** @type {Schedule | null} */
let schedule = null;
let selectedDayIndex = 0;
let tickTimer = null;

/** @type {number} */
const CAL_ROW_PX = 44;

const el = {
  festivalName: document.getElementById("festival-name"),
  contextLine: document.getElementById("context-line"),
  nowBanner: document.getElementById("now-banner"),
  nowList: document.getElementById("now-list"),
  scheduleGrid: document.getElementById("schedule-grid"),
  dayPicker: document.getElementById("day-picker"),
  flaggedUpcoming: document.getElementById("flagged-upcoming"),
};

/** @type {Set<string>} */
let flaggedSetIds = loadFlags();

/** When true, Flagged upcoming hides sets on days other than Now's active festival day. */
let flagsTodayOnly = loadFlagsTodayOnly();

/** "cards" is the richer Flagged rows; "compact" is the one-line view. */
let flagsView = loadFlagsView();

/** Displayed clock times. Schedule data stays 24-hour. Default off. */
let clock12 = loadClock12();
syncClockSwitch();

/** Shown under Flagged upcoming after a share or a soft-failed link. */
let shareNotice = "";

/** Full share URL revealed after Share, so it can be copied by hand. */
let shareNoticeUrl = "";

function isPlayableSet(set) {
  return set.kind !== "closure";
}

function dayHasSchedule(day) {
  if (day.hidden) return false;
  return day.stages.some((stage) => stage.sets.some(isPlayableSet));
}

function visibleDayIndices() {
  if (!schedule) return [];
  return schedule.days.map((day, i) => (dayHasSchedule(day) ? i : -1)).filter((i) => i >= 0);
}

function validateSchedule(data) {
  if (!data || typeof data !== "object") return "Not an object";
  if (typeof data.festival !== "string" || !data.festival.trim()) return "Missing festival name";
  if (!Array.isArray(data.days) || data.days.length === 0) return "Missing days array";
  let anyDay = false;
  for (const day of data.days) {
    if (!day.date || !day.label || !Array.isArray(day.stages)) return "Invalid day entry";
    if (day.extras !== undefined && !Array.isArray(day.extras)) return "Invalid day extras";
    if (!dayHasSchedule(day) && !day.hidden) continue;
    if (dayHasSchedule(day)) anyDay = true;
    for (const stage of day.stages) {
      if (!stage.name || !Array.isArray(stage.sets)) return "Invalid stage entry";
      for (const set of stage.sets) {
        if (!set.artist || !set.start) return "Invalid set entry";
        if (set.end !== null && (set.end === undefined || typeof set.end !== "string")) return "Invalid set entry";
      }
    }
  }
  if (!anyDay) return "No days with scheduled sets";
  return null;
}

function parseClockOnFestivalDay(dayDate, timeStr) {
  const [y, m, d] = dayDate.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  const dayOffset = h < 6 ? 1 : 0;
  return new Date(y, m - 1, d + dayOffset, h, min, 0, 0);
}

/**
 * @param {string} dayDate
 * @param {Set} set
 * @param {Stage | null} [stage]
 * @param {number} [playableIndex] index within playableSets(stage), or -1 to resolve
 */
function parseSetTimes(dayDate, set, stage = null, playableIndex = -1) {
  const start = parseClockOnFestivalDay(dayDate, set.start);
  let end;
  if (set.end != null && set.end !== "") {
    end = parseClockOnFestivalDay(dayDate, set.end);
  } else if (stage) {
    const playable = playableSets(stage);
    const idx = playableIndex >= 0 ? playableIndex : playable.indexOf(set);
    if (idx >= 0 && idx < playable.length - 1) {
      end = parseClockOnFestivalDay(dayDate, playable[idx + 1].start);
    } else {
      const [h, min] = set.start.split(":").map(Number);
      const startAfterFour = h > 4 || (h === 4 && min > 0);
      if (startAfterFour) {
        end = new Date(start.getTime() + 60 * 60 * 1000);
      } else if (stage.closesAt) {
        end = parseClockOnFestivalDay(dayDate, stage.closesAt);
      } else {
        end = new Date(start.getTime() + 60 * 60 * 1000);
      }
    }
  } else {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  if (set.kind === "closure" || end <= start) {
    end = new Date(start.getTime() + (set.kind === "closure" ? 0 : 60 * 60 * 1000));
  }
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(date) {
  if (clock12) {
    const h24 = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const suffix = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${minutes}\u00a0${suffix}`;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 24-hour HH:MM for values that get parsed again. Not for display. */
function formatTime24(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Start–end for display. 12-hour ranges may wrap after the dash. */
function formatClockRange(start, end) {
  const startLabel = formatTime(start);
  const endLabel = formatTime(end);
  if (!clock12) return `${startLabel}–${endLabel}`;
  return `${startLabel}–\u200b${endLabel}`;
}

/** Whole minutes for human countdown copy (e.g. 45m, 2h 15m). */
function formatHumanCountdownMinutes(totalMinutes) {
  const mins = Math.max(1, totalMinutes);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

const FLAGGED_ENDS_SOON_MS = 30 * 60 * 1000;

/**
 * @param {Date} now
 * @param {Date} start
 * @param {Date} end
 * @returns {{ text: string; kind: "upcoming" | "live" | "ending" } | null}
 */
function formatFlaggedCountdown(now, start, end) {
  const t = now.getTime();
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (t < startMs) {
    const mins = Math.ceil((startMs - t) / 60_000);
    return { text: `Starts in ${formatHumanCountdownMinutes(mins)}`, kind: "upcoming" };
  }
  if (t < endMs) {
    const remaining = endMs - t;
    if (remaining > FLAGGED_ENDS_SOON_MS) {
      return { text: "On now", kind: "live" };
    }
    const mins = Math.ceil(remaining / 60_000);
    return { text: `Ends in ${formatHumanCountdownMinutes(mins)}`, kind: "ending" };
  }
  return null;
}

function playableSets(stage) {
  return stage.sets.filter(isPlayableSet);
}

/**
 * When the room has no more sets (ms on festival day). Last playable set end, closure rows,
 * and explicit stage.closesAt (room may stay open after the final DJ).
 * @param {string} dayDate
 * @param {Stage} stage
 * @returns {number} 0 when unknown
 */
function stageCloseTimeMs(dayDate, stage) {
  let closeMs = 0;
  const playable = playableSets(stage);
  for (let pi = 0; pi < playable.length; pi += 1) {
    const set = playable[pi];
    const { end } = parseSetTimes(dayDate, set, stage, pi);
    closeMs = Math.max(closeMs, end.getTime());
  }
  for (const set of stage.sets) {
    if (set.kind === "closure") {
      const { start } = parseSetTimes(dayDate, set, stage);
      closeMs = Math.max(closeMs, start.getTime());
    }
  }
  if (stage.closesAt) {
    closeMs = Math.max(closeMs, parseClockOnFestivalDay(dayDate, stage.closesAt).getTime());
  }
  return closeMs;
}

/** @returns {string | null} 24h HH:MM for positioning, not the display setting */
function getStageClosesAtClock(dayDate, stage) {
  const closeMs = stageCloseTimeMs(dayDate, stage);
  if (!closeMs) return null;
  return formatTime24(new Date(closeMs));
}

/** @returns {string | null} close time in the active display clock */
function formatStageCloseClock(dayDate, stage) {
  const closeMs = stageCloseTimeMs(dayDate, stage);
  if (!closeMs) return null;
  return formatTime(new Date(closeMs));
}

function formatStageClosesLabel(dayDate, stage) {
  const clock = formatStageCloseClock(dayDate, stage);
  return clock ? `Closes ${clock}` : null;
}

function stageHasClosureNote(stage) {
  return Boolean(stage.closureNote || stage.sets.some((s) => s.kind === "closure"));
}

function makeSetId(day, stage, set) {
  const dayKey = day.id || day.date;
  const stageKey = stage.id || stage.name;
  return `${dayKey}|${stageKey}|${set.start}|${set.artist}`;
}

function loadFlags() {
  try {
    const raw = localStorage.getItem(FLAGS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x) => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveFlags() {
  localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify([...flaggedSetIds]));
}

function loadFlagsTodayOnly() {
  try {
    const raw = localStorage.getItem(FLAGS_TODAY_ONLY_STORAGE_KEY);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    return false;
  } catch {
    return false;
  }
}

function saveFlagsTodayOnly() {
  localStorage.setItem(FLAGS_TODAY_ONLY_STORAGE_KEY, flagsTodayOnly ? "1" : "0");
}

function loadFlagsView() {
  try {
    const raw = localStorage.getItem(FLAGS_VIEW_STORAGE_KEY);
    if (raw === "compact" || raw === "cards") return raw;
    return "cards";
  } catch {
    return "cards";
  }
}

function saveFlagsView() {
  localStorage.setItem(FLAGS_VIEW_STORAGE_KEY, flagsView);
}

function loadClock12() {
  try {
    const raw = localStorage.getItem(CLOCK_12H_STORAGE_KEY);
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function saveClock12() {
  localStorage.setItem(CLOCK_12H_STORAGE_KEY, clock12 ? "1" : "0");
}

function syncClockSwitch() {
  document.body.classList.toggle("clock-12", clock12);
  document.querySelectorAll(".clock-switch-btn").forEach((btn) => {
    const on = (btn.dataset.clock === "12") === clock12;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

function setClock12(next) {
  if (clock12 === next) return;
  clock12 = next;
  saveClock12();
  syncClockSwitch();
  if (!schedule) return;
  const scroller = document.querySelector(".cal-scroll-wrap");
  const left = scroller ? scroller.scrollLeft : 0;
  const top = scroller ? scroller.scrollTop : 0;
  renderNow();
  renderSchedule();
  if (scroller) {
    scroller.scrollLeft = left;
    scroller.scrollTop = top;
  }
}

function wireClockSwitch() {
  syncClockSwitch();
  document.querySelectorAll(".clock-switch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setClock12(btn.dataset.clock === "12");
    });
  });
}

function showFlaggedTodayOnlyToggle() {
  return schedule && visibleDayIndices().length > 1;
}

function createFlaggedViewSwitch() {
  const group = document.createElement("div");
  group.className = "flagged-view-switch";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Flagged list layout");

  const options = [
    { id: "cards", label: "Cards" },
    { id: "compact", label: "Compact" },
  ];
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flagged-view-btn";
    btn.dataset.flagsView = opt.id;
    btn.textContent = opt.label;
    const on = flagsView === opt.id;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.addEventListener("click", () => {
      if (flagsView === opt.id) return;
      flagsView = opt.id;
      saveFlagsView();
      renderFlaggedUpcoming(new Date(), opt.id);
    });
    group.appendChild(btn);
  }
  return group;
}

function createFlaggedSectionHeader() {
  const header = document.createElement("div");
  header.className = "flagged-header";

  const h2 = document.createElement("h2");
  h2.id = "flagged-heading";
  h2.className = "flagged-heading";
  h2.textContent = "Flagged upcoming";
  header.appendChild(h2);

  const controls = document.createElement("div");
  controls.className = "flagged-header-controls";
  controls.appendChild(createFlaggedViewSwitch());
  controls.appendChild(createFlaggedShareButton());

  if (showFlaggedTodayOnlyToggle()) {
    const label = document.createElement("label");
    label.className = "flagged-today-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "flagged-today-toggle-input";
    input.checked = flagsTodayOnly;
    input.setAttribute("role", "switch");
    input.setAttribute("aria-checked", String(flagsTodayOnly));

    const text = document.createElement("span");
    text.className = "flagged-today-toggle-label";
    text.textContent = "Today only";

    input.addEventListener("change", () => {
      flagsTodayOnly = input.checked;
      input.setAttribute("aria-checked", String(flagsTodayOnly));
      saveFlagsTodayOnly();
      renderFlaggedUpcoming(new Date());
    });

    label.appendChild(input);
    label.appendChild(text);
    controls.appendChild(label);
  }

  header.appendChild(controls);
  return header;
}

function isFlagged(setId) {
  return flaggedSetIds.has(setId);
}

function toggleFlag(setId) {
  if (flaggedSetIds.has(setId)) flaggedSetIds.delete(setId);
  else flaggedSetIds.add(setId);
  saveFlags();
  shareNotice = "";
  shareNoticeUrl = "";
}

function syncFlagButton(btn, setId) {
  const on = isFlagged(setId);
  btn.classList.toggle("is-flagged", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "Unflag set" : "Flag set");
  btn.textContent = on ? "★" : "☆";
}

/**
 * Share links carry flagged sets only, as a short reversible token in the URL hash
 * (`#f=`). Query `?f=` is accepted too. Opening a valid link replaces local flags.
 *
 * Payload (then base64url, no padding):
 *   u8 version = 1
 *   u16 schedule fingerprint (FNV-1a over day/stage/set index + start + artist)
 *   u8 count
 *   count × u16 big-endian coordinates
 *     bits 15–13 day index (0–7), bits 12–9 stage index (0–15), bits 8–0 set index (0–511)
 *   u8 CRC-8 over the preceding bytes
 * A bad checksum, unknown version, or fingerprint that doesn't match this schedule
 * leaves the current flags alone.
 */
const SHARE_TOKEN_VERSION = 1;
const SHARE_PARAM = "f";

function fnv1a32Update(hash, str) {
  let h = hash;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function scheduleShareFingerprint() {
  if (!schedule) return 0;
  let h = 0x811c9dc5;
  for (let di = 0; di < schedule.days.length; di += 1) {
    const day = schedule.days[di];
    const stages = day.stages || [];
    for (let si = 0; si < stages.length; si += 1) {
      const playable = playableSets(stages[si]);
      for (let pi = 0; pi < playable.length; pi += 1) {
        const set = playable[pi];
        h = fnv1a32Update(h, `${di}.${si}.${pi}.${set.start}.${set.artist}\n`);
      }
    }
  }
  return h & 0xffff;
}

function locatePlayableSet(setId) {
  if (!schedule) return null;
  for (let di = 0; di < schedule.days.length; di += 1) {
    const day = schedule.days[di];
    for (let si = 0; si < day.stages.length; si += 1) {
      const stage = day.stages[si];
      const playable = playableSets(stage);
      for (let pi = 0; pi < playable.length; pi += 1) {
        if (makeSetId(day, stage, playable[pi]) === setId) {
          return { di, si, pi };
        }
      }
    }
  }
  return null;
}

function packSetCoord(di, si, pi) {
  if (di < 0 || di > 7 || si < 0 || si > 15 || pi < 0 || pi > 511) return null;
  return ((di & 7) << 13) | ((si & 15) << 9) | (pi & 511);
}

function unpackSetCoord(word) {
  return {
    di: (word >> 13) & 7,
    si: (word >> 9) & 15,
    pi: word & 511,
  };
}

function crc8(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x80) crc = ((crc << 1) ^ 0x07) & 0xff;
      else crc = (crc << 1) & 0xff;
    }
  }
  return crc;
}

function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(token) {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const padLen = (4 - (token.length % 4)) % 4;
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function shareableFlagWords() {
  if (!schedule) return null;
  const words = [];
  for (const id of flaggedSetIds) {
    const loc = locatePlayableSet(id);
    if (!loc) continue;
    const word = packSetCoord(loc.di, loc.si, loc.pi);
    if (word == null) return null;
    words.push(word);
  }
  words.sort((a, b) => a - b);
  return words;
}

function encodeFlagsToken() {
  const words = shareableFlagWords();
  if (!words || words.length === 0 || words.length > 255) return null;
  const fp = scheduleShareFingerprint();
  const bytes = new Uint8Array(4 + words.length * 2 + 1);
  let o = 0;
  bytes[o] = SHARE_TOKEN_VERSION;
  o += 1;
  bytes[o] = (fp >> 8) & 0xff;
  o += 1;
  bytes[o] = fp & 0xff;
  o += 1;
  bytes[o] = words.length;
  o += 1;
  for (const word of words) {
    bytes[o] = (word >> 8) & 0xff;
    o += 1;
    bytes[o] = word & 0xff;
    o += 1;
  }
  bytes[o] = crc8(bytes.subarray(0, o));
  return bytesToBase64Url(bytes);
}

function decodeFlagsToken(token) {
  if (!schedule || typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  const bytes = base64UrlToBytes(trimmed);
  if (!bytes || bytes.length < 5 || bytes[0] !== SHARE_TOKEN_VERSION) return null;
  const fp = (bytes[1] << 8) | bytes[2];
  if (fp !== scheduleShareFingerprint()) return null;
  const count = bytes[3];
  if (count < 1 || bytes.length !== 4 + count * 2 + 1) return null;
  if (crc8(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) return null;
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const word = (bytes[4 + i * 2] << 8) | bytes[4 + i * 2 + 1];
    const { di, si, pi } = unpackSetCoord(word);
    const day = schedule.days[di];
    const stage = day && day.stages[si];
    const set = stage && playableSets(stage)[pi];
    if (!day || !stage || !set) return null;
    ids.push(makeSetId(day, stage, set));
  }
  return ids;
}

function readShareToken() {
  try {
    const url = new URL(location.href);
    const hash = url.hash.replace(/^#/, "");
    if (hash) {
      const fromHash = new URLSearchParams(hash).get(SHARE_PARAM);
      if (fromHash && fromHash.trim()) return fromHash.trim();
    }
    const fromQuery = url.searchParams.get(SHARE_PARAM);
    return fromQuery && fromQuery.trim() ? fromQuery.trim() : null;
  } catch {
    return null;
  }
}

function buildShareUrl(token) {
  const url = new URL(location.href);
  url.searchParams.delete(SHARE_PARAM);
  url.hash = `${SHARE_PARAM}=${token}`;
  return url.href;
}

function stripShareTokenFromUrl() {
  try {
    const url = new URL(location.href);
    url.searchParams.delete(SHARE_PARAM);
    const rawHash = url.hash.replace(/^#/, "");
    if (rawHash) {
      const params = new URLSearchParams(rawHash);
      if (params.has(SHARE_PARAM)) {
        params.delete(SHARE_PARAM);
        url.hash = params.toString();
      }
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) {
      history.replaceState(null, "", next || "/");
    }
  } catch {
    /* leave the address bar alone */
  }
}

function applySharedFlagsFromUrl() {
  try {
    const token = readShareToken();
    if (!token) return false;
    const ids = decodeFlagsToken(token);
    if (!ids) {
      shareNotice = "That share link didn’t match this schedule. Your flags are unchanged.";
      return false;
    }
    flaggedSetIds = new Set(ids);
    saveFlags();
    stripShareTokenFromUrl();
    shareNotice = "Flags replaced from the shared link.";
    shareNoticeUrl = "";
    return true;
  } catch {
    shareNotice = "That share link didn’t match this schedule. Your flags are unchanged.";
    return false;
  }
}

function renderAfterSharedFlags() {
  if (!schedule) return;
  const nowHidden = document.getElementById("view-now")?.hidden;
  if (!nowHidden) renderNow();
  else renderFlaggedUpcoming(new Date());
  const scheduleView = document.getElementById("view-schedule");
  if (scheduleView && !scheduleView.hidden) renderSchedule();
}

function onShareUrlChanged() {
  if (!schedule || !readShareToken()) return;
  applySharedFlagsFromUrl();
  renderAfterSharedFlags();
}

function copyTextFallback(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function shareFlaggedSets() {
  const token = encodeFlagsToken();
  if (!token) {
    shareNotice = "Flag a set to share.";
    shareNoticeUrl = "";
    renderFlaggedUpcoming(new Date(), "share");
    return;
  }
  const url = buildShareUrl(token);
  const show = (copied) => {
    shareNotice = copied
      ? "Link copied. Opening it replaces flags."
      : "Copy this link. Opening it replaces flags.";
    shareNoticeUrl = url;
    renderFlaggedUpcoming(new Date(), copied ? "share" : "share-url");
  };
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(url).then(() => show(true)).catch(() => show(copyTextFallback(url)));
  } else {
    show(copyTextFallback(url));
  }
}

function createFlaggedShareButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "flagged-share-btn";
  btn.textContent = "Share";
  const words = shareableFlagWords();
  const canShare = Boolean(words && words.length > 0);
  btn.disabled = !canShare;
  btn.setAttribute("aria-label", canShare ? "Share flagged sets" : "Flag a set to share");
  if (!canShare) btn.title = "Flag a set to share";
  btn.addEventListener("click", () => shareFlaggedSets());
  return btn;
}

function collectFlaggedUpcoming(now = new Date()) {
  if (!schedule) return [];
  const t = now.getTime();
  /** @type {{ day: Day; stage: Stage; set: Set; start: Date; end: Date }[]} */
  const out = [];
  for (const day of schedule.days) {
    if (!dayHasSchedule(day)) continue;
    for (const stage of day.stages) {
      const playable = playableSets(stage);
      for (let pi = 0; pi < playable.length; pi += 1) {
        const set = playable[pi];
        const id = makeSetId(day, stage, set);
        if (!isFlagged(id)) continue;
        const { start, end } = parseSetTimes(day.date, set, stage, pi);
        if (end.getTime() <= t) continue;
        out.push({ day, stage, set, start, end });
      }
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

/** True when two parsed set intervals overlap (same rule as schedule timing). */
function flaggedIntervalsOverlap(a, b) {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** Set IDs among upcoming flagged sets that overlap at least one other flagged set. */
function findClashingFlaggedIds(items) {
  /** @type {Set<string>} */
  const clashing = new Set();
  for (let i = 0; i < items.length; i++) {
    const idA = makeSetId(items[i].day, items[i].stage, items[i].set);
    for (let j = i + 1; j < items.length; j++) {
      if (flaggedIntervalsOverlap(items[i], items[j])) {
        clashing.add(idA);
        clashing.add(makeSetId(items[j].day, items[j].stage, items[j].set));
      }
    }
  }
  return clashing;
}

function filterFlaggedForTodayOnly(items, now = new Date()) {
  if (!flagsTodayOnly) return items;
  const active = findActiveDay(now);
  const activeDate = active?.day?.date;
  if (!activeDate) return items;
  return items.filter(({ day }) => day.date === activeDate);
}

/** Start–end, or start alone when the set has no end. */
function formatFlaggedClockRange(set, start, end) {
  if (set.end == null || set.end === "") return formatTime(start);
  return formatClockRange(start, end);
}

function createFlaggedCardRow({ day, stage, set, start, end }, now, clashingIds) {
  const setId = makeSetId(day, stage, set);
  const isClash = clashingIds.has(setId);
  const li = document.createElement("li");
  li.className = `flagged-row${isClash ? " flagged-row-clash" : ""}`;
  const dayHint =
    schedule.days.length > 1
      ? `<span class="flagged-playing-in-day">${escapeHtml(day.label)}</span>`
      : "";
  const clashBadge = isClash ? `<span class="badge clash">Clash</span>` : "";
  const countdown = formatFlaggedCountdown(now, start, end);
  const countdownHtml = countdown
    ? `<span class="flagged-playing-in-sep" aria-hidden="true">·</span><span class="flagged-time-until is-${countdown.kind}">${escapeHtml(countdown.text)}</span>`
    : "";
  li.innerHTML = `
    <span class="flagged-time">${escapeHtml(formatClockRange(start, end))}</span>
    <span class="flagged-meta">
      <span class="flagged-playing-in">
        <span class="flagged-playing-in-label">Playing in</span>
        <span class="flagged-playing-in-sep" aria-hidden="true">·</span>
        <span class="flagged-playing-in-room">${escapeHtml(stage.name)}</span>
        ${dayHint}
        ${countdownHtml}
      </span>
      <span class="flagged-artist-row">
        <span class="flagged-artist">${escapeHtml(set.artist)}</span>
        ${clashBadge}
      </span>
    </span>
  `;
  return li;
}

function createFlaggedCompactRow({ day, stage, set, start, end }, now, clashingIds) {
  const setId = makeSetId(day, stage, set);
  const isClash = clashingIds.has(setId);
  const li = document.createElement("li");
  li.className = `flagged-row flagged-row-compact${isClash ? " flagged-row-clash" : ""}`;

  const time = document.createElement("span");
  time.className = "flagged-time flagged-compact-time";
  time.textContent = formatFlaggedClockRange(set, start, end);

  const artist = document.createElement("span");
  artist.className = "flagged-artist flagged-compact-artist";
  artist.textContent = set.artist;

  const room = document.createElement("span");
  room.className = "flagged-playing-in-room flagged-compact-room";
  room.textContent = stage.name;

  li.append(time, artist, room);

  const countdown = formatFlaggedCountdown(now, start, end);
  if (countdown) {
    const until = document.createElement("span");
    until.className = `flagged-time-until flagged-compact-until is-${countdown.kind}`;
    until.textContent = countdown.text;
    li.appendChild(until);
  }

  if (isClash) {
    const mark = document.createElement("span");
    mark.className = "flagged-compact-clash";
    mark.title = "Clash";
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "Clash");
    mark.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="0.6" y="0.6" width="10" height="10" rx="1.4" fill="currentColor"/><rect x="5.4" y="5.4" width="10" height="10" rx="1.4" fill="#e10600" stroke="currentColor" stroke-width="1.6"/></svg>`;
    li.appendChild(mark);
  }

  return li;
}

function renderFlaggedUpcoming(now = new Date(), focusView = null) {
  if (!el.flaggedUpcoming) return;
  const allUpcoming = collectFlaggedUpcoming(now);
  const items = filterFlaggedForTodayOnly(allUpcoming, now);
  el.flaggedUpcoming.dataset.flagsView = flagsView;

  el.flaggedUpcoming.replaceChildren();
  el.flaggedUpcoming.appendChild(createFlaggedSectionHeader());

  if (shareNotice) {
    const note = document.createElement("p");
    note.id = "flagged-share-status";
    note.className = "flagged-share-status";
    note.setAttribute("role", "status");
    note.textContent = shareNotice;
    el.flaggedUpcoming.appendChild(note);
  }
  if (shareNoticeUrl) {
    const field = document.createElement("input");
    field.className = "flagged-share-url";
    field.type = "text";
    field.readOnly = true;
    field.value = shareNoticeUrl;
    field.setAttribute("aria-label", "Share link");
    field.spellcheck = false;
    field.addEventListener("focus", () => field.select());
    el.flaggedUpcoming.appendChild(field);
  }

  if (items.length === 0) {
    const hasAnyFlag = flaggedSetIds.size > 0;
    const hasLaterWhenTodayOnly =
      flagsTodayOnly && hasAnyFlag && allUpcoming.length > 0;
    let emptyMsg;
    if (!hasAnyFlag) {
      emptyMsg = "Flag sets on the Schedule grid (☆) to track them here.";
    } else if (hasLaterWhenTodayOnly) {
      emptyMsg =
        "No flagged sets on this festival day. Turn off Today only to see later days.";
    } else {
      emptyMsg = "No flagged sets left today — check Schedule for later days.";
    }
    const p = document.createElement("p");
    p.className = "flagged-empty";
    p.textContent = emptyMsg;
    el.flaggedUpcoming.appendChild(p);
  } else {
    const clashingIds = findClashingFlaggedIds(items);
    const list = document.createElement("ul");
    list.className = flagsView === "compact" ? "flagged-list flagged-list-compact" : "flagged-list";
    const buildRow = flagsView === "compact" ? createFlaggedCompactRow : createFlaggedCardRow;
    for (const item of items) {
      list.appendChild(buildRow(item, now, clashingIds));
    }
    el.flaggedUpcoming.appendChild(list);
  }

  if (focusView === "cards" || focusView === "compact") {
    const btn = el.flaggedUpcoming.querySelector(`[data-flags-view="${focusView}"]`);
    if (btn instanceof HTMLElement) btn.focus();
  } else if (focusView === "share") {
    const btn = el.flaggedUpcoming.querySelector(".flagged-share-btn");
    if (btn instanceof HTMLElement) btn.focus();
  } else if (focusView === "share-url") {
    const field = el.flaggedUpcoming.querySelector(".flagged-share-url");
    if (field instanceof HTMLInputElement) {
      field.focus();
      field.select();
    }
  }
}

function isRoomClosed(stage, dayDate, now = new Date()) {
  const closeMs = stageCloseTimeMs(dayDate, stage);
  if (!closeMs) return false;
  return now.getTime() >= closeMs;
}

function findActiveDay(now = new Date()) {
  if (!schedule) return null;
  const scheduled = visibleDayIndices().map((i) => ({ index: i, day: schedule.days[i] }));
  if (scheduled.length === 0) return null;

  const today = localDateString(now);
  const exact = scheduled.find((x) => x.day.date === today);
  if (exact) return { index: exact.index, day: exact.day, mode: "live" };

  const t = now.getTime();
  const withEnds = scheduled.map(({ index, day }) => {
    let dayEnd = 0;
    let dayStart = Infinity;
    for (const stage of day.stages) {
      const playable = playableSets(stage);
      for (let pi = 0; pi < playable.length; pi += 1) {
        const set = playable[pi];
        const { start, end } = parseSetTimes(day.date, set, stage, pi);
        dayStart = Math.min(dayStart, start.getTime());
        dayEnd = Math.max(dayEnd, end.getTime());
      }
      dayEnd = Math.max(dayEnd, stageCloseTimeMs(day.date, stage));
    }
    return { index, day, dayStart, dayEnd };
  });

  const inProgress = withEnds.find((x) => t >= x.dayStart && t <= x.dayEnd);
  if (inProgress) return { index: inProgress.index, day: inProgress.day, mode: "live" };

  const upcoming = withEnds.filter((x) => x.dayStart > t).sort((a, b) => a.dayStart - b.dayStart)[0];
  if (upcoming) return { index: upcoming.index, day: upcoming.day, mode: "upcoming" };

  const past = withEnds.filter((x) => x.dayEnd < t).sort((a, b) => b.dayEnd - a.dayEnd)[0];
  if (past) return { index: past.index, day: past.day, mode: "past" };

  return { index: scheduled[0].index, day: scheduled[0].day, mode: "upcoming" };
}

function getNowAndNext(stage, dayDate, now = new Date()) {
  const t = now.getTime();
  let current = null;
  let next = null;

  const playable = playableSets(stage);
  for (let pi = 0; pi < playable.length; pi += 1) {
    const set = playable[pi];
    const { start, end } = parseSetTimes(dayDate, set, stage, pi);
    if (t >= start.getTime() && t < end.getTime()) {
      current = { set, start, end };
    } else if (start.getTime() > t && !next) {
      next = { set, start, end };
    }
  }

  if (!next && !current) {
    for (let pi = 0; pi < playable.length; pi += 1) {
      const set = playable[pi];
      const { start, end } = parseSetTimes(dayDate, set, stage, pi);
      if (start.getTime() > t) {
        next = { set, start, end };
        break;
      }
    }
  }

  return { current, next };
}

function renderNow() {
  if (!schedule) return;

  el.festivalName.textContent = schedule.festival;
  const tz = schedule.timezone ? ` · ${schedule.timezone}` : "";
  const active = findActiveDay();
  if (!active) return;

  const now = new Date();
  const dayLabel = active.day.label;
  if (active.mode === "live" && localDateString(now) === active.day.date) {
    el.contextLine.textContent = `${dayLabel} · ${active.day.date} · live${tz}`;
    el.nowBanner.classList.add("hidden");
  } else if (active.mode === "upcoming") {
    el.contextLine.textContent = `Next up: ${dayLabel} (${active.day.date})${tz}`;
    el.nowBanner.textContent = `Today isn’t a festival day. Showing ${dayLabel} so you can see what’s coming.`;
    el.nowBanner.classList.remove("hidden");
  } else if (active.mode === "past") {
    el.contextLine.textContent = `Festival ended · last day ${dayLabel}${tz}`;
    el.nowBanner.textContent = `The schedule has ended. Showing the final day for reference.`;
    el.nowBanner.classList.remove("hidden");
  } else {
    el.contextLine.textContent = `${dayLabel} · schedule${tz}`;
    el.nowBanner.classList.add("hidden");
  }

  renderFlaggedUpcoming(now);

  el.nowList.innerHTML = "";
  for (const stage of active.day.stages) {
    if (playableSets(stage).length === 0) continue;

    const card = document.createElement("article");
    card.className = "stage-card";
    const title = document.createElement("h3");
    title.textContent = stage.name;
    card.appendChild(title);

    const closesLabel = formatStageClosesLabel(active.day.date, stage);
    if (closesLabel) {
      const meta = document.createElement("p");
      meta.className = "room-meta";
      meta.textContent = closesLabel;
      card.appendChild(meta);
    }

    const closed = isRoomClosed(stage, active.day.date, now);

    if (closed) {
      const shut = document.createElement("div");
      shut.className = "slot closure";
      const note = stage.closureNote || "Room closed — head to other rooms";
      const closedClock = formatStageCloseClock(active.day.date, stage) || "";
      shut.innerHTML = `<div class="time">${escapeHtml(closedClock)}</div><div><span class="badge idle">Closed</span><div class="artist">${escapeHtml(note)}</div></div>`;
      card.appendChild(shut);
      el.nowList.appendChild(card);
      continue;
    }

    const { current, next } = getNowAndNext(stage, active.day.date, now);
    const showLive = current && active.mode === "live";

    if (showLive) {
      card.appendChild(slotEl(current, "now", "Live now"));
    } else {
      const idle = document.createElement("div");
      idle.className = "slot";
      idle.innerHTML = `<div class="time">—</div><div><span class="badge idle">Between sets</span><div class="artist">Nothing on right now</div></div>`;
      card.appendChild(idle);
    }

    if (next) {
      card.appendChild(slotEl(next, "next", "Up next"));
    } else if (closesLabel || stageHasClosureNote(stage)) {
      const hint = document.createElement("div");
      hint.className = "slot";
      const closeClock = formatStageCloseClock(active.day.date, stage) || "—";
      hint.innerHTML = `<div class="time">${escapeHtml(closeClock)}</div><div class="artist muted-text">${escapeHtml(stage.closureNote || "Room closes")}</div>`;
      card.appendChild(hint);
    } else {
      const done = document.createElement("div");
      done.className = "slot";
      done.innerHTML = `<div class="time">—</div><div class="artist muted-text">No more sets today</div>`;
      card.appendChild(done);
    }

    el.nowList.appendChild(card);
  }

  selectedDayIndex = active.index;
  renderDayPicker();
}

function slotEl({ set, start, end }, kind, badgeLabel) {
  const row = document.createElement("div");
  row.className = `slot ${kind}`;
  row.innerHTML = `
    <div class="time">${formatClockRange(start, end)}</div>
    <div>
      <span class="badge ${kind === "now" ? "live" : "upnext"}">${badgeLabel}</span>
      <div class="artist">${escapeHtml(set.artist)}</div>
    </div>
  `;
  return row;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function scheduleStagesForDay(day) {
  return day.stages.filter(
    (stage) => playableSets(stage).length > 0 || stage.sets.some((s) => s.kind === "closure"),
  );
}

function buildHourGrid(dayDate, stages) {
  let min = Infinity;
  let max = -Infinity;
  for (const stage of stages) {
    const playable = playableSets(stage);
    for (const set of stage.sets) {
      const pi = playable.indexOf(set);
      const { start, end } = parseSetTimes(dayDate, set, stage, pi);
      min = Math.min(min, start.getTime());
      max = Math.max(max, end.getTime());
    }
    max = Math.max(max, stageCloseTimeMs(dayDate, stage));
  }
  if (!Number.isFinite(min)) return { hours: [], gridStart: 0, gridEnd: 0 };

  const gridStart = new Date(min);
  gridStart.setMinutes(0, 0, 0);
  const gridEnd = new Date(max);
  if (gridEnd.getMinutes() > 0 || gridEnd.getSeconds() > 0) {
    gridEnd.setHours(gridEnd.getHours() + 1, 0, 0, 0);
  }

  const hours = [];
  for (let t = gridStart.getTime(); t < gridEnd.getTime(); t += 60 * 60 * 1000) {
    hours.push(new Date(t));
  }
  if (hours.length === 0) hours.push(gridStart);
  return { hours, gridStart: gridStart.getTime(), gridEnd: gridEnd.getTime() };
}

function currentTimeRowIndex(hours, now) {
  const t = now.getTime();
  for (let i = 0; i < hours.length; i++) {
    const rowStart = hours[i].getTime();
    const rowEnd = i + 1 < hours.length ? hours[i + 1].getTime() : rowStart + 60 * 60 * 1000;
    if (t >= rowStart && t < rowEnd) return i;
  }
  return -1;
}

function appendCalEvent(colBody, day, stage, set, gridStart, playableIndex = -1) {
  const { start, end } = parseSetTimes(day.date, set, stage, playableIndex);
  const topPx = ((start.getTime() - gridStart) / (60 * 60 * 1000)) * CAL_ROW_PX;
  let heightPx = ((end.getTime() - start.getTime()) / (60 * 60 * 1000)) * CAL_ROW_PX;
  if (set.kind === "closure") heightPx = Math.max(CAL_ROW_PX - 4, 34);

  const event = document.createElement("div");
  event.className = `cal-event${set.kind === "closure" ? " cal-event-closure" : ""}`;
  event.style.top = `${Math.max(0, topPx)}px`;
  event.style.height = `${heightPx}px`;
  if (set.kind !== "closure" && heightPx < CAL_ROW_PX) {
    event.classList.add("cal-event-compact");
  }

  const label = set.kind === "closure" ? set.note || set.artist : set.artist;
  const timeLabel = set.kind === "closure" ? formatTime(start) : formatClockRange(start, end);

  const timeSpan = document.createElement("span");
  timeSpan.className = "cal-event-time";
  timeSpan.textContent = timeLabel;

  const artistSpan = document.createElement("span");
  artistSpan.className = "cal-event-artist";
  artistSpan.textContent = label;

  event.appendChild(timeSpan);
  event.appendChild(artistSpan);

  if (isPlayableSet(set)) {
    const setId = makeSetId(day, stage, set);
    const flagBtn = document.createElement("button");
    flagBtn.type = "button";
    flagBtn.className = "cal-flag";
    syncFlagButton(flagBtn, setId);
    flagBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFlag(setId);
      syncFlagButton(flagBtn, setId);
      event.classList.toggle("cal-event-flagged", isFlagged(setId));
      if (!document.getElementById("view-now").hidden) {
        renderFlaggedUpcoming(new Date());
      }
    });
    event.appendChild(flagBtn);
    if (isFlagged(setId)) event.classList.add("cal-event-flagged");
  }

  colBody.appendChild(event);
}

function renderSchedule() {
  if (!schedule) return;
  const day = schedule.days[selectedDayIndex];
  if (!day || !dayHasSchedule(day)) return;

  const stages = scheduleStagesForDay(day);
  const { hours, gridStart } = buildHourGrid(day.date, stages);
  const bodyHeight = hours.length * CAL_ROW_PX;
  const active = findActiveDay();
  const now = new Date();
  const highlightNow = active && selectedDayIndex === active.index && active.mode === "live";
  const nowRow = highlightNow ? currentTimeRowIndex(hours, now) : -1;

  el.scheduleGrid.innerHTML = "";
  el.scheduleGrid.className = "schedule-grid cal-grid-host";
  el.scheduleGrid.style.setProperty("--cal-rows", String(hours.length));

  const table = document.createElement("div");
  table.className = "cal-table";

  const headRow = document.createElement("div");
  headRow.className = "cal-head-row";
  const gutterHead = document.createElement("div");
  gutterHead.className = "cal-gutter";
  headRow.appendChild(gutterHead);

  const headCols = document.createElement("div");
  headCols.className = "cal-head-cols";
  for (const stage of stages) {
    const head = document.createElement("div");
    head.className = "cal-stage-head";
    head.setAttribute("role", "columnheader");
    head.textContent = stage.name;
    const headCloses = formatStageClosesLabel(day.date, stage);
    if (headCloses) {
      const close = document.createElement("span");
      close.className = "cal-stage-close";
      close.textContent = headCloses;
      head.appendChild(close);
    }
    if (stage.notes) {
      const note = document.createElement("span");
      note.className = "cal-stage-note";
      note.textContent = stage.notes;
      head.appendChild(note);
    }
    headCols.appendChild(head);
  }
  headRow.appendChild(headCols);
  table.appendChild(headRow);

  const bodyRow = document.createElement("div");
  bodyRow.className = "cal-body-row";

  const timesCol = document.createElement("div");
  timesCol.className = "cal-times-col";
  for (let i = 0; i < hours.length; i++) {
    const timeCell = document.createElement("div");
    timeCell.className = "cal-time";
    timeCell.style.height = `${CAL_ROW_PX}px`;
    timeCell.setAttribute("role", "rowheader");
    timeCell.textContent = formatTime(hours[i]);
    if (i === nowRow) timeCell.classList.add("cal-time-now");
    timesCol.appendChild(timeCell);
  }
  bodyRow.appendChild(timesCol);

  const colsWrap = document.createElement("div");
  colsWrap.className = "cal-cols-wrap";

  for (const stage of stages) {
    const col = document.createElement("div");
    col.className = "cal-stage-col";

    const colBody = document.createElement("div");
    colBody.className = "cal-col-body";
    colBody.style.height = `${bodyHeight}px`;

    for (let i = 0; i < hours.length; i++) {
      const line = document.createElement("div");
      line.className = `cal-row-line${i === nowRow ? " cal-row-line-now" : ""}`;
      line.style.height = `${CAL_ROW_PX}px`;
      colBody.appendChild(line);
    }

    const playable = playableSets(stage);
    for (const set of stage.sets) {
      const pi = playable.indexOf(set);
      appendCalEvent(colBody, day, stage, set, gridStart, pi);
    }

    const closeClock = getStageClosesAtClock(day.date, stage);
    if (stage.closesAt && closeClock && !stage.sets.some((x) => x.kind === "closure")) {
      appendCalEvent(
        colBody,
        day,
        stage,
        {
          kind: "closure",
          artist: "Room closed",
          start: closeClock,
          end: closeClock,
          note: stage.closureNote || "Room closed",
        },
        gridStart,
      );
    }

    col.appendChild(colBody);
    colsWrap.appendChild(col);
  }

  bodyRow.appendChild(colsWrap);
  table.appendChild(bodyRow);

  if (highlightNow && nowRow >= 0) {
    const markerTop =
      nowRow * CAL_ROW_PX +
      ((now.getTime() - hours[nowRow].getTime()) / (60 * 60 * 1000)) * CAL_ROW_PX;
    const marker = document.createElement("div");
    marker.className = "cal-now-marker";
    marker.style.top = `${markerTop}px`;
    marker.setAttribute("aria-hidden", "true");
    colsWrap.appendChild(marker);
  }

  el.scheduleGrid.appendChild(table);
}

function renderDayPicker() {
  if (!el.dayPicker || !schedule) return;
  const indices = visibleDayIndices();
  el.dayPicker.innerHTML = "";

  if (indices.length <= 1) {
    el.dayPicker.classList.add("hidden");
    return;
  }

  el.dayPicker.classList.remove("hidden");
  for (const idx of indices) {
    const day = schedule.days[idx];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-btn";
    btn.dataset.dayIndex = String(idx);
    btn.textContent = day.label.slice(0, 3);
    btn.classList.toggle("active", idx === selectedDayIndex);
    btn.setAttribute("aria-pressed", String(idx === selectedDayIndex));
    btn.addEventListener("click", () => {
      selectedDayIndex = idx;
      renderDayPicker();
      renderSchedule();
    });
    el.dayPicker.appendChild(btn);
  }
}

function setView(name) {
  document.querySelectorAll(".view").forEach((v) => {
    const on = v.id === `view-${name}`;
    v.classList.toggle("hidden", !on);
    v.hidden = !on;
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", String(on));
  });
  if (name === "schedule") renderSchedule();
  if (name === "now") renderNow();
}

function setOfflineBanner(visible) {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;
  banner.classList.toggle("hidden", !visible);
  banner.hidden = !visible;
}

function formatLoadErrorMessage(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.trim() || "Unknown error";
}

function showLoadError(err) {
  const banner = document.getElementById("load-error");
  const text = document.getElementById("load-error-text");
  if (!banner || !text) return;
  text.textContent = `Could not load schedule: ${formatLoadErrorMessage(err)}`;
  banner.classList.remove("hidden");
  banner.hidden = false;
}

function hideLoadError() {
  const banner = document.getElementById("load-error");
  if (!banner) return;
  banner.classList.add("hidden");
  banner.hidden = true;
}

function wireLoadErrorRetry() {
  const btn = document.getElementById("load-error-retry");
  if (!btn) return;
  btn.addEventListener("click", () => {
    hideLoadError();
    init();
  });
}

function wireOfflineBanner() {
  const update = () => setOfflineBanner(!navigator.onLine);
  window.addEventListener("offline", update);
  window.addEventListener("online", update);
  update();
}

async function loadBundledFromCache() {
  if (!("caches" in window)) return null;
  const urls = ["./schedule.json", new URL("schedule.json", location.href).href];
  for (const url of urls) {
    const res = await caches.match(url);
    if (!res || !res.ok) continue;
    const data = /** @type {Schedule} */ (await res.json());
    const err = validateSchedule(data);
    if (!err) return { data, fromCache: true };
  }
  return null;
}

async function loadBundled() {
  let fromCacheFallback = false;
  /** @type {Schedule} */
  let data;

  try {
    const res = await fetch("./schedule.json");
    if (!res.ok) throw new Error("Could not load schedule.json");
    data = /** @type {Schedule} */ (await res.json());
  } catch {
    const cached = await loadBundledFromCache();
    if (!cached) throw new Error("Could not load schedule.json");
    data = cached.data;
    fromCacheFallback = cached.fromCache;
  }

  const err = validateSchedule(data);
  if (err) throw new Error(err);

  if (fromCacheFallback || !navigator.onLine) {
    setOfflineBanner(true);
  }

  return data;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (window.__swRefreshing) return;
    window.__swRefreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register("./sw.js")
    .then((registration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    })
    .catch((e) => {
      console.warn("Service worker registration failed", e);
    });
}

function clearLegacyScheduleStorage() {
  try {
    localStorage.removeItem(LEGACY_SCHEDULE_STORAGE_KEY);
    localStorage.removeItem("festival-schedule-v1");
  } catch {
    /* ignore */
  }
}

function startClockTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const nowHidden = document.getElementById("view-now").hidden;
    if (!nowHidden) renderNow();
  }, 30_000);
}

/** @type {boolean} */
let rabbitRainRunning = false;

/** @type {number | null} */
let rabbitRainRaf = null;

/** @type {ReturnType<typeof setInterval> | null} */
let rabbitRainSpawnTimer = null;

function stopRabbitRainLayer(layer) {
  if (rabbitRainSpawnTimer !== null) {
    clearInterval(rabbitRainSpawnTimer);
    rabbitRainSpawnTimer = null;
  }
  if (rabbitRainRaf !== null) {
    cancelAnimationFrame(rabbitRainRaf);
    rabbitRainRaf = null;
  }
  layer.remove();
  rabbitRainRunning = false;
}

function startRabbitRain() {
  if (rabbitRainRunning) return;
  rabbitRainRunning = true;

  const layer = document.createElement("div");
  layer.className = "rabbit-rain-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);

  const durationMs = 3500;
  const spawnUntil = performance.now() + durationMs;
  /** @type {{ el: HTMLElement; x: number; y: number; vy: number; drift: number }[]} */
  const drops = [];

  const spawnDrop = () => {
    const el = document.createElement("span");
    el.className = "rabbit-rain-drop";
    el.textContent = "🐰";
    const maxX = Math.max(0, window.innerWidth - 28);
    const x = Math.random() * maxX;
    drops.push({
      el,
      x,
      y: -24 - Math.random() * 40,
      vy: 2.2 + Math.random() * 2.8,
      drift: (Math.random() - 0.5) * 1.1,
    });
    layer.appendChild(el);
  };

  rabbitRainSpawnTimer = setInterval(() => {
    if (performance.now() >= spawnUntil) {
      if (rabbitRainSpawnTimer !== null) clearInterval(rabbitRainSpawnTimer);
      rabbitRainSpawnTimer = null;
      return;
    }
    spawnDrop();
    if (Math.random() < 0.35) spawnDrop();
  }, 95);

  const startedAt = performance.now();

  const tick = () => {
    const vh = window.innerHeight;
    for (let i = drops.length - 1; i >= 0; i -= 1) {
      const drop = drops[i];
      drop.y += drop.vy;
      drop.x += drop.drift;
      drop.el.style.transform = `translate3d(${drop.x}px, ${drop.y}px, 0)`;
      if (drop.y > vh - 64) {
        const fade = Math.max(0, 1 - (drop.y - (vh - 64)) / 64);
        drop.el.style.opacity = String(fade);
      }
      if (drop.y > vh + 32) {
        drop.el.remove();
        drops.splice(i, 1);
      }
    }

    const spawnDone = performance.now() >= spawnUntil;
    const elapsed = performance.now() - startedAt;
    if ((spawnDone && drops.length === 0) || elapsed > durationMs + 4500) {
      stopRabbitRainLayer(layer);
      return;
    }
    rabbitRainRaf = requestAnimationFrame(tick);
  };

  spawnDrop();
  rabbitRainRaf = requestAnimationFrame(tick);
}

function wireRabbitEgg() {
  const btn = document.getElementById("rabbit-egg-btn");
  if (!btn) return;
  btn.addEventListener("click", () => startRabbitRain());
}

function wireUi() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });
  window.addEventListener("hashchange", () => onShareUrlChanged());
  wireRabbitEgg();
  wireClockSwitch();
}

let initStarted = false;

async function init() {
  if (!initStarted) {
    initStarted = true;
    registerServiceWorker();
    wireUi();
    wireOfflineBanner();
    wireLoadErrorRetry();
    clearLegacyScheduleStorage();
  }

  hideLoadError();

  try {
    schedule = await loadBundled();
  } catch (e) {
    console.error(e);
    showLoadError(e);
    return;
  }

  applySharedFlagsFromUrl();

  try {
    const active = findActiveDay();
    if (active) selectedDayIndex = active.index;
    else {
      const vis = visibleDayIndices();
      if (vis.length) selectedDayIndex = vis[0];
    }
    renderDayPicker();
    renderNow();
    renderSchedule();
    startClockTick();
  } catch (e) {
    console.error(e);
    schedule = null;
    showLoadError(e);
  }
}

init();
