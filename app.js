/*
 * timetable-kiosk — touch-friendly school timetable terminal.
 * Vanilla JS, no build step. Data: JSON per campus (see data/README.md).
 * Offline: last known good schedule is kept in IndexedDB (+ localStorage fallback).
 */
(() => {
  "use strict";

  const DAYS = [["monday", "Понедельник"], ["tuesday", "Вторник"], ["wednesday", "Среда"], ["thursday", "Четверг"], ["friday", "Пятница"], ["weekend", "Сб и Вс"]];
  const CONFIG = window.KIOSK_CONFIG || {};
  const FALLBACK_CAMPUSES = CONFIG.campuses || [{ id: "main", name: "Главный корпус", dataUrl: "data/main.json" }];
  const CACHE_DB = "timetable-kiosk";
  const CACHE_STORE = "snapshots";
  const root = document.getElementById("terminal-app");
  const params = new URLSearchParams(location.search);
  const scrollBehavior = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const state = {
    data: null, campuses: FALLBACK_CAMPUSES, campusId: params.get("campusId") || "",
    defaultCampusId: CONFIG.defaultCampusId || FALLBACK_CAMPUSES[0].id, view: params.get("view") === "teachers" ? "teachers" : "classes", viewTouched: params.has("view"),
    grade: null, classId: params.get("classId"), teacherId: params.get("teacherId"), day: params.get("day") || todayKey(), stale: false
  };

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]); }
  function todayKey() { const day = new Date().getDay(); return day === 0 || day === 6 ? "weekend" : DAYS[day - 1]?.[0] || "monday"; }
  function isoWeekNumber(date = new Date()) { const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7)); return Math.ceil((((value - new Date(Date.UTC(value.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7); }
  function activeWeekIndex() { return isoWeekNumber() % 2 === 0 ? 0 : 1; }
  function activeWeekValue() { return activeWeekIndex() === 0 ? "even" : "odd"; }
  function activeWeekLabel() { return activeWeekIndex() === 0 ? "Чётная неделя" : "Нечётная неделя"; }
  function dateLabel(value) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date); }
  function updatedDateLabel(value) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
  function normalise(payload) {
    const source = payload?.schedule || payload?.timetable || payload || {};
    const raw = source.classes || source.classSchedules || source.scheduleByClass || {};
    const classes = Array.isArray(raw) ? raw.reduce((out, item) => { const id = item.class || item.classId || item.name; if (id) out[id] = item; return out; }, {}) : raw;
    return { ...source, classes, teachers: source.teachers || {}, title: source.weekLabel || source.title || "Расписание занятий", updatedAt: source.updatedAt || source.createdAt || "", dates: source.dates || {}, campusId: source.campusId || payload?.campus?.id || state.campusId };
  }
  function campusName() { return state.campuses.find(item => item.id === state.campusId)?.name || state.data?.campus?.name || "Корпус"; }
  function classLabel(id) { return String(state.data?.classes?.[id]?.displayName || id); }
  function classIds() { return Object.keys(state.data?.classes || {}).sort((a, b) => classLabel(a).localeCompare(classLabel(b), "ru", { numeric: true })); }
  function gradeOf(id) { return classLabel(id).match(/^\d+/)?.[0] || ""; }
  function gradeList() { return [...new Set(classIds().map(gradeOf).filter(Boolean))].sort((a, b) => Number(a) - Number(b)); }
  function gradeClasses(grade) { return classIds().filter(id => gradeOf(id) === String(grade)); }
  function getClass(id = state.classId) { return state.data?.classes?.[id] || {}; }
  function getDays(item) { return item?.days || item?.schedule || item?.week || {}; }
  function rows(item, day) { const raw = getDays(item)[day] || []; return Array.isArray(raw) ? raw : raw.lessons || raw.items || []; }
  function activeLessons(item, day) {
    return rows(item, day).filter(lesson => {
      if (lesson.week === "even" || lesson.week === "odd") return lesson.week === activeWeekValue();
      const mask = String(lesson.weekMask || "11");
      return !/^[01]+$/.test(mask) || mask[activeWeekIndex()] !== "0";
    });
  }
  function teachers() {
    const map = new Map();
    const supplied = state.data?.teachers || {};
    (Array.isArray(supplied) ? supplied : Object.entries(supplied).map(([id, value]) => typeof value === "string" ? { id, name: value } : { id, ...value })).forEach(item => { if (item?.id) map.set(String(item.id), item.name || item.displayName || item.fullName || item.id); });
    classIds().forEach(classId => DAYS.forEach(([day]) => rows(getClass(classId), day).forEach(lesson => {
      const ids = Array.isArray(lesson.teacherIds) ? lesson.teacherIds : [];
      ids.forEach((id, index) => map.set(String(id), map.get(String(id)) || (Array.isArray(lesson.teacher) ? lesson.teacher[index] : lesson.teacher) || id));
    })));
    return [...map].map(([id, name]) => ({ id, name: String(name) })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
  function teacherLessons(teacherId, day) {
    const result = [];
    classIds().forEach(classId => activeLessons(getClass(classId), day).forEach(lesson => {
      if ((lesson.teacherIds || []).map(String).includes(String(teacherId))) result.push({ ...lesson, classLabel: classLabel(classId) });
    }));
    return result.sort((a, b) => String(a.time || "").localeCompare(String(b.time || ""), "ru", { numeric: true }));
  }
  function currentLessons(day = state.day) { return state.view === "teachers" ? teacherLessons(state.teacherId, day) : activeLessons(getClass(), day); }
  function availableDays() { return DAYS.filter(([day]) => currentLessons(day).length); }
  function hasWeekend() { return currentLessons("weekend").length > 0; }
  function syncUrl() {
    const next = new URL(location.href); ["campusId", "view", "classId", "teacherId", "day"].forEach(key => next.searchParams.delete(key));
    next.searchParams.set("campusId", state.campusId); next.searchParams.set("view", state.view); next.searchParams.set("day", state.day);
    if (state.classId) next.searchParams.set("classId", state.classId); if (state.teacherId) next.searchParams.set("teacherId", state.teacherId);
    history.replaceState(null, "", next);
  }
  function logo() {
    const href = `?campusId=${encodeURIComponent(state.campusId)}`;
    return `<a class="kiosk-logo" href="${escapeHtml(href)}" aria-label="${escapeHtml(CONFIG.title || "Расписание")} — на главный экран"><strong>${escapeHtml(CONFIG.title || "Расписание")}</strong><span>${escapeHtml(CONFIG.subtitle || "интерактивное расписание")}</span></a>`;
  }
  function campusLinks() {
    if (state.campuses.length < 2) return "";
    return `<nav class="campus-links" aria-label="Расписание по корпусам">${state.campuses.map(item => `<a href="?campusId=${encodeURIComponent(item.id)}" ${item.id === state.campusId ? 'aria-current="page"' : ""}>${escapeHtml(item.name)}</a>`).join("")}</nav>`;
  }
  function viewSwitch() { return `<div class="view-switch" role="group" aria-label="Вид расписания"><button data-view="classes" class="${state.view === "classes" ? "is-active" : ""}">Классы</button><button data-view="teachers" class="${state.view === "teachers" ? "is-active" : ""}">Учителя</button></div>`; }
  function header() { return `<header class="terminal__header">${logo()}<div class="header-meta"><strong>${escapeHtml(campusName())}</strong><span>${escapeHtml(activeWeekLabel())}${state.data?.updatedAt ? ` · обновлено ${escapeHtml(updatedDateLabel(state.data.updatedAt))}` : ""}</span>${state.stale ? '<em class="offline-badge">Сохранённая версия · сеть недоступна</em>' : ""}${viewSwitch()}</div></header>${campusLinks()}`; }
  function mountLogos() {
    /* the logo is plain markup now; kept as a hook for custom branding */
  }
  function bindChrome() {
    mountLogos();
    root.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => { state.view = button.dataset.view; state.viewTouched = true; state.grade = null; state.classId = null; state.teacherId = state.view === "teachers" ? preferredTeacherId() : null; renderStart(); }));
  }
  function shell(content, footer = "Расписание отображается по последней опубликованной версии") { root.innerHTML = `<div class="waves waves--one" aria-hidden="true"></div><div class="waves waves--two" aria-hidden="true"></div><div class="terminal">${header()}${content}<footer class="terminal__footer">${footer}</footer></div>`; bindChrome(); }
  function preferredTeacherId() {
    const explicit = params.get("teacherId"); if (explicit && teachers().some(item => item.id === explicit)) return explicit;
    return null;
  }
  function renderStart() {
    if (state.view === "teachers") { renderTeachers(); return; }
    const grades = gradeList();
    shell(`<section class="welcome"><p class="eyebrow">Интерактивное расписание</p><h1>Выберите свой класс</h1><p>Корпус «${escapeHtml(campusName())}»: уроки на сегодня и всю неделю.</p></section><section class="class-grid" aria-label="Выбор класса">${grades.map(grade => `<button class="class-card" data-grade="${escapeHtml(grade)}"><span>${escapeHtml(grade)}</span><small>класс</small></button>`).join("")}</section>`);
    root.querySelectorAll("[data-grade]").forEach(button => button.addEventListener("click", () => { state.grade = button.dataset.grade; renderSubclasses(); }));
  }
  function renderSubclasses() {
    const ids = gradeClasses(state.grade); if (ids.length === 1) { state.classId = ids[0]; renderSchedule(); return; }
    shell(`<section class="selection-panel"><div class="selection-top"><div><p class="eyebrow">${escapeHtml(state.grade)} класс</p><h2>Выберите подгруппу</h2></div><button class="back-button" data-action="back">← Все классы</button></div><div class="subclass-grid">${ids.map(id => `<button class="subclass-card" data-class="${escapeHtml(id)}">${escapeHtml(classLabel(id))}</button>`).join("")}</div></section>`);
    root.querySelector("[data-action=back]").addEventListener("click", renderStart); root.querySelectorAll("[data-class]").forEach(button => button.addEventListener("click", () => { state.classId = button.dataset.class; renderSchedule(); }));
  }
  function renderTeachers() {
    if (state.teacherId && teachers().some(item => item.id === state.teacherId)) { renderSchedule(); return; }
    shell(`<section class="welcome"><p class="eyebrow">Расписание преподавателей</p><h1>Выберите учителя</h1></section><section class="teacher-grid">${teachers().map(item => `<button class="teacher-card" data-teacher="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong></button>`).join("")}</section>`);
    root.querySelectorAll("[data-teacher]").forEach(button => button.addEventListener("click", () => { state.teacherId = button.dataset.teacher; renderSchedule(); }));
  }
  function lessonRow(lesson, index) {
    const teacher = lesson.teacher ?? lesson.teachers ?? "—";
    const teacherText = Array.isArray(teacher) ? teacher.join(", ") : teacher;
    const replaced = Boolean(lesson.actualTeacher && String(lesson.actualTeacher).trim() && String(lesson.actualTeacher) !== teacherText);
    const shownTeacher = replaced ? String(lesson.actualTeacher) : teacherText;
    const groups = Array.isArray(lesson.groups) ? lesson.groups.join(", ") : lesson.group;
    const context = [state.view === "teachers" ? lesson.classLabel : groups, lesson.week === "even" ? "Чётная неделя" : lesson.week === "odd" ? "Нечётная неделя" : "", state.day === "weekend" ? (lesson.weekendDay === "sunday" ? "Вс" : "Сб") : ""].filter(Boolean).join(" · ");
    const badge = replaced ? `<span class="lesson-badge">замена</span>` : "";
    const note = replaced ? `<small class="lesson-replace-note">вместо ${escapeHtml(teacherText)}</small>` : "";
    return `<tr${replaced ? ' class="is-replaced"' : ""}><td><span class="lesson-no">${escapeHtml(lesson.lesson ?? lesson.number ?? index + 1)}</span></td><td><span class="lesson-time">${escapeHtml(lesson.time || "—")}</span></td><td><span class="lesson-subject">${escapeHtml(lesson.subject || lesson.name || "—")}</span>${context ? `<small class="lesson-context">${escapeHtml(context)}</small>` : ""}</td><td><span class="lesson-teacher">${escapeHtml(shownTeacher)}</span>${badge}${note}</td><td><span class="lesson-room">${escapeHtml(lesson.room || lesson.classroom || "—")}</span></td></tr>`;
  }
  function renderSchedule() {
    if (state.view === "classes" && !getClass(state.classId)?.days && !getClass(state.classId)?.schedule && !getClass(state.classId)?.week) { state.classId = null; renderStart(); return; }
    const available = availableDays(); if (available.length && !available.some(([day]) => day === state.day)) state.day = available[0][0];
    const item = teachers().find(value => value.id === state.teacherId); const title = state.view === "teachers" ? item?.name || "Учитель" : `${classLabel(state.classId)} класс`;
    const visibleDays = DAYS.filter(([day]) => day !== "weekend" || hasWeekend()); const lessons = currentLessons(); const dayName = DAYS.find(([day]) => day === state.day)?.[1] || "Расписание";
    shell(`<section class="schedule-view"><div class="schedule-heading"><div><p class="eyebrow">${escapeHtml(campusName())}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(dayName)}</p></div><button class="nav-action" data-action="choose">${state.view === "teachers" ? "Выбрать учителя" : "Выбрать класс"}</button></div><nav class="day-tabs">${visibleDays.map(([day, label]) => `<button class="day-tab ${day === state.day ? "is-active" : ""}" data-day="${day}" ${currentLessons(day).length ? "" : "disabled"}>${label}<span class="day-tab__date">${escapeHtml(state.data.dates?.[day] ? dateLabel(state.data.dates[day]) : "")}</span></button>`).join("")}</nav><div class="schedule-card">${lessons.length ? `<table class="schedule-table"><thead><tr><th>№</th><th>Время</th><th>Предмет</th><th>Преподаватель</th><th>Каб.</th></tr></thead><tbody>${lessons.map(lessonRow).join("")}</tbody></table>` : '<div class="empty-day">На этот день занятий в расписании нет.</div>'}</div><button class="scroll-hint" type="button" aria-label="Прокрутить расписание вниз" hidden><svg class="scroll-hint__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v14"/><path d="m6.5 12.5 5.5 5.5 5.5-5.5"/></svg></button></section>`, "Ссылку на это расписание можно сохранить: класс и день записаны в адресе страницы");
    syncUrl(); root.querySelector("[data-action=choose]").addEventListener("click", () => { state.grade = null; state.classId = null; state.teacherId = null; renderStart(); }); root.querySelectorAll("[data-day]").forEach(button => button.addEventListener("click", () => { state.day = button.dataset.day; renderSchedule(); })); requestAnimationFrame(updateScrollHint);
  }
  function cacheKey() { return `latest-v2:${state.campusId}`; }
  function localCacheKey() { return `timetable-kiosk:last-known-good:v2:${state.campusId}`; }
  function openCacheDatabase() { return new Promise((resolve, reject) => { if (!indexedDB) return reject(new Error("IndexedDB недоступна")); const request = indexedDB.open(CACHE_DB, 1); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(CACHE_STORE)) request.result.createObjectStore(CACHE_STORE); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async function writeCache(data) { const value = { savedAt: new Date().toISOString(), data }; try { const db = await openCacheDatabase(); await new Promise((resolve, reject) => { const tx = db.transaction(CACHE_STORE, "readwrite"); tx.objectStore(CACHE_STORE).put(value, cacheKey()); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); } catch {} try { localStorage.setItem(localCacheKey(), JSON.stringify(value)); } catch {} }
  async function readCache() { try { const db = await openCacheDatabase(); const value = await new Promise((resolve, reject) => { const request = db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(cacheKey()); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close(); if (value?.data) return normalise(value.data); } catch {} try { const value = JSON.parse(localStorage.getItem(localCacheKey()) || "null"); return value?.data ? normalise(value.data) : null; } catch { return null; } }
  async function fetchJson(url) { const response = await fetch(url, { cache: "no-store", credentials: "omit" }); const payload = await response.json().catch(() => ({})); if (!response.ok || payload.ok === false) { const error = new Error(payload.error || "Сервер не ответил"); error.status = response.status; throw error; } return payload; }
  async function bootstrap() {
    if (CONFIG.campusesUrl) {
      const campuses = await fetchJson(CONFIG.campusesUrl).catch(() => null);
      if (campuses?.campuses?.length) state.campuses = campuses.campuses;
      if (campuses?.defaultCampusId) state.defaultCampusId = campuses.defaultCampusId;
    }
    if (!state.campuses.some(item => item.id === state.campusId)) state.campusId = state.defaultCampusId; await loadSchedule();
  }
  function scheduleUrl() {
    const campus = state.campuses.find(item => item.id === state.campusId);
    if (campus?.dataUrl) return campus.dataUrl;
    if (CONFIG.scheduleUrl) return CONFIG.scheduleUrl.replace("{campusId}", encodeURIComponent(state.campusId));
    return `data/${encodeURIComponent(state.campusId)}.json`;
  }
  async function fetchSchedule() { return normalise(await fetchJson(scheduleUrl())); }
  function renderCurrent() { if (state.view === "teachers" && state.teacherId) renderSchedule(); else if (state.classId) renderSchedule(); else if (state.grade) renderSubclasses(); else renderStart(); }
  function renderError(message) { root.innerHTML = `<div class="waves waves--one"></div><section class="empty-state"><div class="empty-state__top">${logo()}</div><div><p>Расписание пока недоступно.</p><small>${escapeHtml(message)}</small><br><button class="retry">Повторить</button></div></section>`; mountLogos(); root.querySelector(".retry").addEventListener("click", loadSchedule); }
  async function loadSchedule() {
    root.innerHTML = '<div class="waves waves--one"></div><section class="loading"><span class="loading__dot"></span><p>Загружаем расписание</p></section>';
    try { state.data = await fetchSchedule(); if (!Object.keys(state.data.classes).length) throw new Error("Расписание ещё не опубликовано"); state.stale = false; await writeCache(state.data); const ownTeacher = preferredTeacherId(); if (!state.viewTouched && !params.has("classId") && ownTeacher) { state.view = "teachers"; state.teacherId = ownTeacher; state.day = params.get("day") || todayKey(); } else if (state.view === "teachers" && !state.teacherId) state.teacherId = ownTeacher; renderCurrent(); }
    catch (error) { const cached = await readCache(); if (cached && Object.keys(cached.classes).length) { state.data = cached; state.stale = true; renderCurrent(); } else renderError(error.message); }
  }
  function updateScrollHint() {
    const hint = root.querySelector(".scroll-hint");
    if (!hint) return;
    const documentHeight = document.documentElement.scrollHeight;
    const hasMore = documentHeight > window.innerHeight + 80 && window.scrollY + window.innerHeight < documentHeight - 48;
    hint.hidden = !hasMore;
  }
  root.addEventListener("click", (event) => {
    if (!event.target.closest(".scroll-hint")) return;
    window.scrollBy({ top: Math.max(320, window.innerHeight * .72), behavior: scrollBehavior() });
  });
  window.addEventListener("scroll", updateScrollHint, { passive: true });
  window.addEventListener("resize", updateScrollHint);
  bootstrap();
  setInterval(async () => { try { const next = await fetchSchedule(); const changed = next.revision !== state.data?.revision || next.updatedAt !== state.data?.updatedAt || state.stale; state.data = next; state.stale = false; await writeCache(next); if (changed) renderCurrent(); } catch {} }, 60_000);
})();
