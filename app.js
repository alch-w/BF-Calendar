/** @deprecated Removed import UI — cleared on load so bundled schedule wins. */
const LEGACY_SCHEDULE_STORAGE_KEY = "festival-schedule-v2";
const FLAGS_STORAGE_KEY = "festival-flags-v1";

/** @typedef {{ artist: string; start: string; end: string; kind?: string; note?: string }} Set */
/** @typedef {{ id: string; name: string; sets: Set[]; closesAt?: string; closureNote?: string }} Stage */
/** @typedef {{ id: string; label: string; date: string; stages: Stage[]; hidden?: boolean }} Day */
/** @typedef {{ festival: string; timezone?: string; days: Day[] }} Schedule */

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
    if (!dayHasSchedule(day) && !day.hidden) continue;
    if (dayHasSchedule(day)) anyDay = true;
    for (const stage of day.stages) {
      if (!stage.name || !Array.isArray(stage.sets)) return "Invalid stage entry";
      for (const set of stage.sets) {
        if (!set.artist || !set.start || set.end === undefined) return "Invalid set entry";
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

function parseSetTimes(dayDate, set) {
  const start = parseClockOnFestivalDay(dayDate, set.start);
  let end = parseClockOnFestivalDay(dayDate, set.end);
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
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function playableSets(stage) {
  return stage.sets.filter(isPlayableSet);
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

function isFlagged(setId) {
  return flaggedSetIds.has(setId);
}

function toggleFlag(setId) {
  if (flaggedSetIds.has(setId)) flaggedSetIds.delete(setId);
  else flaggedSetIds.add(setId);
  saveFlags();
}

function syncFlagButton(btn, setId) {
  const on = isFlagged(setId);
  btn.classList.toggle("is-flagged", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "Unflag set" : "Flag set");
  btn.textContent = on ? "★" : "☆";
}

function collectFlaggedUpcoming(now = new Date()) {
  if (!schedule) return [];
  const t = now.getTime();
  /** @type {{ day: Day; stage: Stage; set: Set; start: Date; end: Date }[]} */
  const out = [];
  for (const day of schedule.days) {
    if (!dayHasSchedule(day)) continue;
    for (const stage of day.stages) {
      for (const set of playableSets(stage)) {
        const id = makeSetId(day, stage, set);
        if (!isFlagged(id)) continue;
        const { start, end } = parseSetTimes(day.date, set);
        if (end.getTime() <= t) continue;
        out.push({ day, stage, set, start, end });
      }
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

function renderFlaggedUpcoming(now = new Date()) {
  if (!el.flaggedUpcoming) return;
  const items = collectFlaggedUpcoming(now);

  if (items.length === 0) {
    const hasAnyFlag = flaggedSetIds.size > 0;
    el.flaggedUpcoming.innerHTML = `
      <h2 id="flagged-heading" class="flagged-heading">Flagged upcoming</h2>
      <p class="flagged-empty">${hasAnyFlag ? "No flagged sets left today — check Schedule for later days." : "Flag sets on the Schedule grid (☆) to track them here."}</p>
    `;
    return;
  }

  const list = document.createElement("ul");
  list.className = "flagged-list";
  for (const { day, stage, set, start, end } of items) {
    const li = document.createElement("li");
    li.className = "flagged-row";
    const dayHint = schedule.days.length > 1 ? ` · ${day.label}` : "";
    li.innerHTML = `
      <span class="flagged-time">${escapeHtml(formatTime(start))}–${escapeHtml(formatTime(end))}</span>
      <span class="flagged-meta">
        <span class="flagged-stage">${escapeHtml(stage.name)}${escapeHtml(dayHint)}</span>
        <span class="flagged-artist">${escapeHtml(set.artist)}</span>
      </span>
    `;
    list.appendChild(li);
  }

  el.flaggedUpcoming.innerHTML = "";
  const h2 = document.createElement("h2");
  h2.id = "flagged-heading";
  h2.className = "flagged-heading";
  h2.textContent = "Flagged upcoming";
  el.flaggedUpcoming.appendChild(h2);
  el.flaggedUpcoming.appendChild(list);
}

function isRoomClosed(stage, dayDate, now = new Date()) {
  if (!stage.closesAt) return false;
  const closeAt = parseClockOnFestivalDay(dayDate, stage.closesAt);
  return now.getTime() >= closeAt.getTime();
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
      for (const set of playableSets(stage)) {
        const { start, end } = parseSetTimes(day.date, set);
        dayStart = Math.min(dayStart, start.getTime());
        dayEnd = Math.max(dayEnd, end.getTime());
      }
      if (stage.closesAt) {
        const close = parseClockOnFestivalDay(day.date, stage.closesAt).getTime();
        dayEnd = Math.max(dayEnd, close);
      }
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

  for (const set of playableSets(stage)) {
    const { start, end } = parseSetTimes(dayDate, set);
    if (t >= start.getTime() && t < end.getTime()) {
      current = { set, start, end };
    } else if (start.getTime() > t && !next) {
      next = { set, start, end };
    }
  }

  if (!next && !current) {
    for (const set of playableSets(stage)) {
      const { start, end } = parseSetTimes(dayDate, set);
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

    if (stage.closesAt) {
      const meta = document.createElement("p");
      meta.className = "room-meta";
      meta.textContent = `Closes ${stage.closesAt}`;
      card.appendChild(meta);
    }

    const closed = isRoomClosed(stage, active.day.date, now);

    if (closed) {
      const shut = document.createElement("div");
      shut.className = "slot closure";
      const note = stage.closureNote || "Room closed — head to other rooms";
      shut.innerHTML = `<div class="time">${escapeHtml(stage.closesAt || "")}</div><div><span class="badge idle">Closed</span><div class="artist">${escapeHtml(note)}</div></div>`;
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
    } else if (stage.closesAt) {
      const hint = document.createElement("div");
      hint.className = "slot";
      const closeT = parseClockOnFestivalDay(active.day.date, stage.closesAt);
      hint.innerHTML = `<div class="time">${formatTime(closeT)}</div><div class="artist muted-text">${escapeHtml(stage.closureNote || "Room closes")}</div>`;
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
    <div class="time">${formatTime(start)}–${formatTime(end)}</div>
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
    for (const set of stage.sets) {
      const { start, end } = parseSetTimes(dayDate, set);
      min = Math.min(min, start.getTime());
      max = Math.max(max, end.getTime());
    }
    if (stage.closesAt) {
      max = Math.max(max, parseClockOnFestivalDay(dayDate, stage.closesAt).getTime());
    }
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

function appendCalEvent(colBody, day, stage, set, gridStart) {
  const { start, end } = parseSetTimes(day.date, set);
  const topPx = ((start.getTime() - gridStart) / (60 * 60 * 1000)) * CAL_ROW_PX;
  let heightPx = ((end.getTime() - start.getTime()) / (60 * 60 * 1000)) * CAL_ROW_PX;
  if (set.kind === "closure") heightPx = Math.max(CAL_ROW_PX * 0.85, 34);

  const event = document.createElement("div");
  event.className = `cal-event${set.kind === "closure" ? " cal-event-closure" : ""}`;
  event.style.top = `${Math.max(0, topPx)}px`;
  event.style.height = `${Math.max(heightPx, CAL_ROW_PX - 4)}px`;

  const label = set.kind === "closure" ? set.note || set.artist : set.artist;
  const timeLabel = set.kind === "closure" ? set.start : `${formatTime(start)}–${formatTime(end)}`;

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
    if (stage.closesAt) {
      const close = document.createElement("span");
      close.className = "cal-stage-close";
      close.textContent = `til ${stage.closesAt}`;
      head.appendChild(close);
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

    for (const set of stage.sets) {
      appendCalEvent(colBody, day, stage, set, gridStart);
    }

    if (stage.closesAt && !stage.sets.some((x) => x.kind === "closure")) {
      appendCalEvent(
        colBody,
        day,
        stage,
        {
          kind: "closure",
          artist: "Room closed",
          start: stage.closesAt,
          end: stage.closesAt,
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

function wireUi() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });
}

async function init() {
  registerServiceWorker();
  wireUi();
  wireOfflineBanner();
  clearLegacyScheduleStorage();
  try {
    schedule = await loadBundled();
  } catch (e) {
    console.error(e);
    return;
  }

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
}

init();
