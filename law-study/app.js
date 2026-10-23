/* 单页多课程学习系统 —— 应用逻辑（原生 JS，无依赖）
 * 结构：courses.json（清单）→ 按需加载 course.js/content.json → normalize() → hash 路由 → 按课程分区存储
 */
(function () {
  "use strict";

  /* ========== 0. 常量 ========== */
  var LEGACY_PROGRESS_KEY = "xingfa-zonglun:progress:v1";
  var LEGACY_DRILL_KEY = "xingfa-zonglun:drill:v1";
  var SETTINGS_KEY = "app:settings:v1";
  var APP_TITLE = "我的课程";
  var warnings = [];
  var REG = null;          // 课程清单 { defaultCourse, courses:[] }
  var COURSE = null;       // 当前课程 { id, meta, content, bank }
  var settings = { theme: "light", fontScale: 1 };
  var courseCache = {};    // courseId -> { content, bank }

  function progressKey(cid) { return "course:" + cid + ":progress:v1"; }
  function drillKey(cid) { return "course:" + cid + ":drill:v1"; }

  /* ========== 1. 小工具 ========== */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    if (kids != null) {
      if (!Array.isArray(kids)) kids = [kids];
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c == null || c === false) continue;
        el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
      }
    }
    return el;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

  /* 极简 Markdown 渲染（先转义再套格式，安全） */
  /* 正文内联标签（宪法学排版）：`先建直觉：文字` 要渲染成「小标题 + 段落」，
     否则标签会和正文粘成一段。刑法用 `###` 标题，走原分支不受影响。
     只有传 opts.labels 时才启用（目前仅正文调用），题干/解析不会被误拆。*/
  var BODY_LABELS = ["对比一下", "先建直觉", "再上定义", "一条关系线", "术语先解释", "术语解释", "生活例子", "对比"];
  function matchBodyLabel(line) {
    for (var k = 0; k < BODY_LABELS.length; k++) {
      var lab = BODY_LABELS[k];
      if (line === lab || line.indexOf(lab + "：") === 0 || line.indexOf(lab + ":") === 0) {
        return { lab: lab, rest: line.slice(lab.length).replace(/^[：:]\s*/, "").trim() };
      }
    }
    return null;
  }
  function renderMd(src, opts) {
    var lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    var out = [], i = 0, list = null;
    var labels = !!(opts && opts.labels);
    function flushList() { if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; } }
    function inline(t) {
      t = esc(t);
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      return t;
    }
    for (; i < lines.length; i++) {
      var raw = lines[i], line = raw.trim();
      if (!line) { flushList(); continue; }
      var m;
      if ((m = line.match(/^#{2,4}\s+(.*)$/))) { flushList(); var lv = m[1] ? Math.min(m[0].match(/#+/)[0].length + 1, 4) : 3; out.push("<h" + lv + ">" + inline(m[1]) + "</h" + lv + ">"); continue; }
      if (labels) {
        var L = matchBodyLabel(line);
        if (L) { flushList(); out.push("<h4>" + inline(L.lab) + "</h4>"); if (L.rest) out.push("<p>" + inline(L.rest) + "</p>"); continue; }
      }
      if ((m = line.match(/^[-*]\s+(.*)$/))) { if (!list) list = []; list.push("<li>" + inline(m[1]) + "</li>"); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { flushList(); out.push("<blockquote>" + inline(m[1]) + "</blockquote>"); continue; }
      flushList();
      out.push("<p>" + inline(line) + "</p>");
    }
    flushList();
    return out.join("");
  }

  /* ========== 2. 内容归一化 ========== */
  var DATA = null;   // { title, subtitle, chapters:[...], flat:[...] }
  function normalize(raw) {
    var d = { title: APP_TITLE, subtitle: "", version: "", chapters: [], flat: [] };
    if (!raw || typeof raw !== "object") { warnings.push("内容源为空或格式错误"); return d; }
    d.title = raw.title || d.title;
    d.subtitle = raw.subtitle || "";
    d.version = (raw.meta && raw.meta.version) || raw.version || "";
    var chapters = Array.isArray(raw.chapters) ? raw.chapters : [];
    chapters.forEach(function (ch, ci) {
      if (!ch || typeof ch !== "object") { warnings.push("跳过无效章节 #" + ci); return; }
      var c = { id: ch.id || ("ch" + (ci + 1)), title: ch.title || ("第" + (ci + 1) + "章"), summary: ch.summary || "", index: ci, sections: [], quiz: [] };
      var secs = Array.isArray(ch.sections) ? ch.sections : [];
      secs.forEach(function (s, si) {
        if (!s || typeof s !== "object") { warnings.push(c.title + "：跳过无效小节 #" + si); return; }
        var sec = {
          id: s.id || (c.id + "-s" + (si + 1)),
          title: s.title || ("第 " + (si + 1) + " 节"),
          plain: s.plain || "",
          body: s.body || "",
          keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.filter(Boolean) : [],
          pitfalls: Array.isArray(s.pitfalls) ? s.pitfalls.filter(Boolean) : [],
          articles: Array.isArray(s.articles) ? s.articles.filter(Boolean) : [],
          chId: c.id, chTitle: c.title, chIndex: ci, index: si
        };
        c.sections.push(sec);
        d.flat.push(sec);
      });
      var qz = Array.isArray(ch.quiz) ? ch.quiz : [];
      qz.forEach(function (q, qi) {
        if (!q || typeof q !== "object" || !q.q) { warnings.push(c.title + "：跳过无效题目 #" + qi); return; }
        var opts = Array.isArray(q.options) ? q.options.slice() : [];
        if (!opts.length && (q.type === "judge" || q.type === "tf")) opts = ["正确", "错误"];
        c.quiz.push({
          type: q.type || (opts.length === 2 ? "judge" : "single"),
          q: q.q, options: opts,
          answerRaw: q.answer, explain: q.explain || ""
        });
      });
      d.chapters.push(c);
    });
    return d;
  }

  function answerIndex(q) {
    var a = q.answerRaw;
    if (typeof a === "number") return a;
    if (typeof a === "string") {
      var t = a.trim();
      if (/^[A-Za-z]$/.test(t)) return t.toUpperCase().charCodeAt(0) - 65;
      if (/^\d+$/.test(t)) return parseInt(t, 10);
      for (var i = 0; i < q.options.length; i++) if (q.options[i] === t) return i;
      if (t.indexOf("对") === 0 || t === "正确" || t === "true" || t === "T") return 0;
      if (t.indexOf("错") === 0 || t === "错误" || t === "false" || t === "F") return 1;
    }
    return -1;
  }

  /* ========== 3. 进度存储（按课程分区） ========== */
  var store = { ok: true };
  function emptyState() {
    // readClearedAt / wipedAt 是删除墓碑：并集合并会把删除抹平，必须靠时间戳声明“此前的都不算”
    return { version: 1, contentVersion: (DATA && DATA.version) || "", read: {}, quiz: {}, lastSid: "", updatedAt: 0, readClearedAt: 0, wipedAt: 0 };
  }
  var state = null;
  function loadState(cid) {
    var fresh = emptyState();
    var raw;
    try { raw = localStorage.getItem(progressKey(cid)); }
    catch (e) {   // 存储真正不可用：禁用本会话保存并提示
      store.ok = false;
      showBanner("进度无法保存（浏览器存储不可用），学习仍可继续，但关闭后本次进度不保留。");
      return fresh;
    }
    if (!raw) return fresh;
    try {
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object" || s.version !== 1) return fresh;
      s.read = s.read || {}; s.quiz = s.quiz || {};
      return s;
    } catch (e) {   // 仅该键损坏：清掉坏键返回 fresh，不影响后续保存
      try { localStorage.removeItem(progressKey(cid)); } catch (e2) {}
      return fresh;
    }
  }
  function saveState() {
    if (!store.ok || !COURSE) return;
    try {
      state.updatedAt = Date.now();
      localStorage.setItem(progressKey(COURSE.id), JSON.stringify(state));
    } catch (e) {
      store.ok = false;
      showBanner("进度无法保存（浏览器存储不可用），学习仍可继续，但关闭后本次进度不保留。");
    }
    scheduleSync("progress");
  }
  function resetState() {
    state = emptyState();
    state.wipedAt = Date.now();                          // 墓碑：让服务端并集丢弃重置前的已读与自测
    quizRun = null;                                   // 防止残留作答态把成绩写回新进度
    try { if (COURSE) localStorage.removeItem(progressKey(COURSE.id)); } catch (e) {}
    saveState();
  }

  /* 全局阅读设置（不随课程变） */
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (s && typeof s === "object") return { theme: s.theme || "light", fontScale: Number(s.fontScale) || 1 };
    } catch (e) {}
    try {
      var p = JSON.parse(localStorage.getItem(LEGACY_PROGRESS_KEY) || "null");
      if (p && p.settings) return { theme: p.settings.theme || "light", fontScale: Number(p.settings.fontScale) || 1 };
    } catch (e) {}
    return { theme: "light", fontScale: 1 };
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    scheduleSync("settings");
  }

  /* ========== 3.5 账号与服务端同步 ========== */
  var AUTH = { user: null, checked: false, online: true, offlineGrant: false };
  var SESSION_CACHE_KEY = "app:sessionCache:v1";
  var SESSION_CACHE_TTL = 30 * 24 * 3600 * 1000;   // 与后端会话同为 30 天

  /* 断网可用：只缓存"会话曾有效"的标记与展示名，绝不缓存密码或令牌 */
  function cacheSession(user) {
    try {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
        username: user.username,
        displayName: user.displayName,
        isAdmin: !!user.isAdmin,
        at: Date.now()
      }));
    } catch (e) {}
  }
  function readCachedSession() {
    try {
      var c = JSON.parse(localStorage.getItem(SESSION_CACHE_KEY) || "null");
      if (!c || !c.username) return null;
      if (Date.now() - (c.at || 0) > SESSION_CACHE_TTL) return null;
      return c;
    } catch (e) { return null; }
  }
  function clearCachedSession() {
    try { localStorage.removeItem(SESSION_CACHE_KEY); } catch (e) {}
  }
  var syncTimers = {};
  var SYNC_DELAY = 900;

  function api(path, opts) {
    opts = opts || {};
    if (typeof fetch !== "function") {
      AUTH.online = false;
      var noNet = new Error("离线模式");
      noNet.offline = true;
      return Promise.reject(noNet);
    }
    var init = {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (r) {
      AUTH.online = true;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var err = new Error(j.detail || ("HTTP " + r.status));
          err.status = r.status;
          if (r.status === 401) { AUTH.user = null; clearCachedSession(); updateUserChip(); }
          throw err;
        }
        return j;
      });
    }).catch(function (e) {
      if (e && e.status) throw e;          // 业务错误照常抛出
      AUTH.online = false;                 // 网络层失败
      throw e;
    });
  }

  function syncKind(kind) {
    if (!AUTH.user || !COURSE) return Promise.resolve();
    var courseId = COURSE.id;
    var payload = kind === "settings" ? settings : (kind === "drill" ? drill : state);
    var path = kind === "settings" ? "/api/settings" : "/api/data/" + kind + "/" + courseId;
    return api(path, { method: "PUT", body: { data: payload, clientUpdatedAt: (payload && payload.updatedAt) || 0 } })
      .then(function (res) {
        if (!res || !res.data) return;
        if (kind === "settings") {
          settings = Object.assign({ theme: "light", fontScale: 1 }, res.data);
          applyTheme(settings.theme); applyFont(settings.fontScale);
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
        } else if (kind === "drill") {
          drill = Object.assign(drill || {}, res.data);
          try { localStorage.setItem(drillKey(courseId), JSON.stringify(drill)); } catch (e) {}
        } else {
          state = Object.assign(state || {}, res.data);
          try { localStorage.setItem(progressKey(courseId), JSON.stringify(state)); } catch (e) {}
        }
      })
      .catch(function () { /* 离线时静默，本地已保存 */ });
  }

  function scheduleSync(kind) {
    if (!AUTH.user) return;
    clearTimeout(syncTimers[kind]);
    syncTimers[kind] = setTimeout(function () { syncKind(kind); }, SYNC_DELAY);
  }

  function pullCourse(courseId) {
    if (!AUTH.user) return Promise.resolve();
    return Promise.all([
      api("/api/data/progress/" + courseId).catch(function () { return null; }),
      api("/api/data/drill/" + courseId).catch(function () { return null; })
    ]).then(function (arr) {
      var sp = arr[0], sd = arr[1];
      if (sp && sp.data && Object.keys(sp.data).length) {
        // 仅在服务端更新时才覆盖本地，避免把本地更新的 lastSid 顶回去
        var serverUp = Number(sp.updatedAt || sp.data.updatedAt || 0);
        var localUp = Number((state && state.updatedAt) || 0);
        if (serverUp >= localUp || !localUp) {
          state = Object.assign({}, sp.data);
          try { localStorage.setItem(progressKey(courseId), JSON.stringify(state)); } catch (e) {}
        }
      }
      if (sd && sd.data && Object.keys(sd.data).length) {
        drill = Object.assign({}, sd.data);
        try { localStorage.setItem(drillKey(courseId), JSON.stringify(drill)); } catch (e) {}
      }
    });
  }

  /* ========== 4. 横幅 / 主题 / 字号 ========== */
  function showBanner(msg) {
    var b = $("#banner");
    if (!b) return;
    clear(b);
    b.appendChild(document.createTextNode(msg));
    var btn = h("button", { class: "close", type: "button", "aria-label": "关闭", onclick: function () { b.hidden = true; } }, "✕");
    b.appendChild(btn);
    b.hidden = false;
  }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    var tc = { light: "#1f5d92", sepia: "#8a5a2b", dark: "#12161b" }[t] || "#1f5d92";
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", tc);
    var menu = $("#thememenu");
    if (menu) for (var i = 0; i < menu.children.length; i++) {
      var b = menu.children[i];
      if (b.getAttribute) b.setAttribute("aria-current", b.getAttribute("data-theme") === t ? "true" : "false");
    }
  }
  function applyFont(f) {
    f = clamp(Number(f) || 1, 0.85, 1.5);
    document.documentElement.style.setProperty("--font-scale", String(f));
  }

  /* ========== 5. 进度派生 ========== */
  function chapterStats(ch) {
    var total = ch.sections.length, done = 0;
    ch.sections.forEach(function (s) { if (state.read[s.id]) done++; });
    var q = state.quiz[ch.id];
    return { total: total, done: done, quiz: q || null, quizTotal: ch.quiz.length };
  }
  function overallStats() {
    var total = DATA.flat.length, done = 0;
    DATA.flat.forEach(function (s) { if (state.read[s.id]) done++; });
    var qDone = 0, qRight = 0, qTotalAll = 0;
    DATA.chapters.forEach(function (ch) {
      qTotalAll += ch.quiz.length;
      var r = state.quiz[ch.id];
      if (r) { qDone += r.total; qRight += r.best; }
    });
    return { total: total, done: done, qDone: qDone, qRight: qRight, qTotalAll: qTotalAll };
  }

  /* ========== 6. 路由 ========== */
  var routes = {};
  var LEGACY_ROUTES = { ch: 1, read: 1, quiz: 1, drill: 1, me: 1, continue: 1 };

  function parseHash() {
    var hash = location.hash.replace(/^#/, "");
    if (!hash || hash === "/") return { name: "hall", parts: [] };
    var parts = hash.replace(/^\//, "").split("/").map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    var name = parts[0] || "";
    if (name === "c") {
      return { name: parts[2] || "toc", parts: parts.slice(3), courseId: parts[1] };
    }
    /* 旧链接兼容：#/read/x → #/c/<default>/read/x */
    if (LEGACY_ROUTES[name] && REG && REG.defaultCourse) {
      var rest = hash.replace(/^\//, "");
      var target = "#/c/" + REG.defaultCourse + "/" + rest;
      if (location.replace) location.replace(target); else location.hash = target;
      return { name: "redirect", parts: [] };
    }
    return { name: name, parts: parts.slice(1) };
  }

  function go(path) {
    if (COURSE && path.charAt(0) === "#" && path.indexOf("#/c/") !== 0) {
      path = "#/c/" + COURSE.id + path.slice(1);
    }
    location.hash = path;
  }
  function goHome() {
    COURSE = null; DATA = null; BANK = null; state = null; drill = null;
    location.hash = "#/";
  }

  function currentTab() {
    var r = parseHash();
    if (r.name === "me") return "me";
    if (r.name === "drill") return "drill";
    if (r.name === "quiz") return "quiz";
    if (r.name === "continue") return "continue";
    return "toc";
  }
  function setTopbar(title, sub, showBack) {
    $("#topbar-title").textContent = title;
    $("#topbar-sub").textContent = sub || "";
    $("#backbtn").hidden = !showBack;
  }
  function setTab() {
    var tab = currentTab();
    var els = document.querySelectorAll(".tabbar .tab");
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute("data-tab") === tab) els[i].setAttribute("aria-current", "page");
      else els[i].removeAttribute("aria-current");
    }
  }
  function updateTabs() {
    if (!COURSE) return;
    var map = { toc: "", continue: "/continue", quiz: "/quiz", drill: "/drill", me: "/me" };
    var els = document.querySelectorAll(".tabbar .tab");
    for (var i = 0; i < els.length; i++) {
      var t = els[i].getAttribute("data-tab");
      if (t in map) els[i].setAttribute("href", "#/c/" + COURSE.id + map[t]);
    }
  }
  function setBottom(nodes) {
    var bb = $("#bottombar");
    clear(bb);
    if (!nodes || !nodes.length) { bb.hidden = true; return; }
    nodes.forEach(function (n) { bb.appendChild(n); });
    bb.hidden = false;
  }

  /* ========== 6.1 课程清单与加载器 ========== */
  function normalizeRegistry(raw) {
    var r = raw && typeof raw === "object" ? raw : {};
    var list = Array.isArray(r.courses) ? r.courses.filter(function (c) { return c && c.id; }) : [];
    return { version: r.version || "", defaultCourse: r.defaultCourse || (list[0] && list[0].id) || "", courses: list };
  }
  function loadRegistry() {
    return new Promise(function (resolve) {
      if (REG) return resolve(REG);
      var useFetch = location.protocol.indexOf("http") === 0 && typeof fetch === "function";
      if (!useFetch) return resolve(normalizeRegistry(window.__COURSES_META__));
      fetch("courses.json").then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { resolve(normalizeRegistry(j || window.__COURSES_META__)); })
        .catch(function () { resolve(normalizeRegistry(window.__COURSES_META__)); });
    });
  }
  function loadCourseScript(cid) {
    return new Promise(function (resolve, reject) {
      if (window.__COURSES__ && window.__COURSES__[cid]) return resolve(window.__COURSES__[cid]);
      var s = document.createElement("script");
      s.src = "courses/" + cid + "/course.js";
      s.onload = function () {
        if (window.__COURSES__ && window.__COURSES__[cid]) resolve(window.__COURSES__[cid]);
        else reject(new Error("课程包为空"));
      };
      s.onerror = function () { reject(new Error("课程包加载失败")); };
      var host = document.head || document.body;
      if (!host) return reject(new Error("无法注入脚本"));
      host.appendChild(s);
    });
  }
  function loadCourse(cid) {
    return new Promise(function (resolve, reject) {
      if (courseCache[cid]) return resolve(courseCache[cid]);
      var meta = ((REG && REG.courses) || []).filter(function (c) { return c.id === cid; })[0];
      if (!meta) return reject(new Error("课程不存在"));
      var useFetch = location.protocol.indexOf("http") === 0 && typeof fetch === "function";
      if (!useFetch) return loadCourseScript(cid).then(resolve, reject);
      Promise.all([
        fetch("courses/" + cid + "/content.json").then(function (r) { if (!r.ok) throw new Error("内容包 404"); return r.json(); }),
        fetch("courses/" + cid + "/bank.json").then(function (r) { if (!r.ok) throw new Error("题库 404"); return r.json(); })
      ]).then(function (arr) {
        courseCache[cid] = { content: arr[0], bank: arr[1] };
        resolve(courseCache[cid]);
      }).catch(function () { loadCourseScript(cid).then(resolve, reject); });
    });
  }
  function migrateLegacy(cid) {
    try {
      if (cid !== "criminal-law-general") return;
      if (localStorage.getItem("app:migrated:v1")) return;
      var pairs = [[LEGACY_PROGRESS_KEY, progressKey(cid)], [LEGACY_DRILL_KEY, drillKey(cid)]];
      pairs.forEach(function (p) {
        if (!localStorage.getItem(p[1]) && localStorage.getItem(p[0])) localStorage.setItem(p[1], localStorage.getItem(p[0]));
      });
      try {
        var old = JSON.parse(localStorage.getItem(LEGACY_PROGRESS_KEY) || "null");
        if (old && old.settings && !localStorage.getItem(SETTINGS_KEY)) localStorage.setItem(SETTINGS_KEY, JSON.stringify(old.settings));
      } catch (e) {}
      localStorage.setItem("app:migrated:v1", "1");
    } catch (e) {}
  }

  var courseReq = 0;
  function ensureCourse(cid, done) {
    var req = ++courseReq;                             // 代际计数：过期请求（用户已切走）直接丢弃，防止滞留错误页
    renderLoading(cid);
    loadCourse(cid).then(function (pack) {
      if (req !== courseReq) return;
      var meta = (REG.courses || []).filter(function (c) { return c.id === cid; })[0] || { id: cid, title: cid };
      COURSE = { id: cid, meta: meta, content: pack.content, bank: pack.bank, articles: pack.articles || {} };
      warnings.length = 0;
      DATA = normalize(pack.content);
      BANK = normalizeBank(pack.bank);
      ARTICLES = (pack.articles && typeof pack.articles === "object") ? pack.articles : {};
      if (warnings.length) {                           // 内容损坏时明示，不再静默
        try { console.warn("[内容校验] 已跳过 " + warnings.length + " 条无效数据", warnings.slice()); } catch (e) {}
        showBanner("教材数据有 " + warnings.length + " 处异常，已自动跳过，不影响使用。");
      }
      quizRun = null;                                  // 切课程时丢弃上一课的作答状态
      randomPick = { count: 20, chapters: null };
      migrateLegacy(cid);
      state = loadState(cid);
      drill = loadDrill(cid);
      applyTheme(settings.theme);
      applyFont(settings.fontScale);
      COURSE_ID_HINT = cid;
      // 已登录：先拉服务端数据覆盖本地，再渲染
      if (AUTH.user) {
        pullCourse(cid).then(function () { done(); }, function () { done(); });
      } else {
        done();
      }
    }).catch(function (e) { if (req !== courseReq) return; renderCourseError(cid, e); });
  }
  function renderLoading(cid) {
    var app = $("#app");
    clear(app);
    setBottom(null);
    var tb = $("#tabbar"); if (tb) tb.hidden = true;
    var meta = ((REG && REG.courses) || []).filter(function (c) { return c.id === cid; })[0];
    setTopbar("正在加载…", meta ? meta.title : cid, false);
    app.appendChild(h("div", { class: "empty" }, [
      h("div", { class: "big" }, "📖"),
      h("p", null, "正在加载" + (meta ? "《" + meta.title + "》" : "课程") + "…")
    ]));
  }
  function renderCourseError(cid, err) {
    var app = $("#app");
    clear(app);
    setBottom(null);
    setTopbar("加载失败", cid, false);
    app.appendChild(h("div", { class: "empty" }, [
      h("div", { class: "big" }, "⚠️"),
      h("p", null, "课程加载失败" + (err && err.message ? "：" + err.message : "")),
      h("button", { class: "btn primary", type: "button", onclick: function () { render(); } }, "重试"),
      h("button", { class: "btn", type: "button", style: "margin-top:8px", onclick: goHome }, "返回课程列表")
    ]));
  }

  /* ========== 6.2 课程大厅 ========== */
  function courseProgress(cid) {
    var done = 0;
    try {
      var s = JSON.parse(localStorage.getItem(progressKey(cid)) || "null");
      if (s && s.read) done = Object.keys(s.read).length;
    } catch (e) {}
    return { done: done };
  }
  function renderHall() {
    COURSE = null; DATA = null; BANK = null; state = null; drill = null;
    var tb = $("#tabbar"); if (tb) tb.hidden = true;
    setTopbar("我的课程", "选择一门开始学习", false);
    var app = $("#app");
    app.appendChild(h("div", { class: "hero" }, [
      h("div", { class: "htitle" }, "📚 我的课程"),
      h("div", { class: "hsub" }, "选一门课，按自己的节奏学"),
      h("div", { class: "hmeta" }, "共 " + REG.courses.length + " 门课程")
    ]));
    var list = h("div", { class: "section-block", style: "margin-top:16px" });
    REG.courses.forEach(function (c) {
      var prog = courseProgress(c.id);
      var p = Math.min(pct(prog.done, c.sections || 0), 100);
      list.appendChild(h("div", { class: "card tap course-card", onclick: function () { go("#/c/" + c.id); } }, [
        h("div", { class: "course-head" }, [
          h("div", { class: "course-icon", style: "background:" + (c.color || "#1f5d92") }, c.icon || "📘"),
          h("div", { class: "course-main" }, [
            h("div", { class: "course-title" }, c.title),
            h("div", { class: "course-sub" }, c.subtitle || ""),
            h("div", { class: "course-meta" }, [
              c.category ? h("span", { class: "pill" }, c.category) : null,
              h("span", { class: "pill" }, (c.chapters || 0) + " 章"),
              h("span", { class: "pill" }, (c.sections || 0) + " 节"),
              h("span", { class: "pill" }, (c.questions || 0) + " 题")
            ])
          ])
        ]),
        h("div", { style: "margin-top:12px" }, [
          h("div", { class: "pbar-label" }, [
            h("span", null, c.status === "ready" ? "学习进度" : "准备中"),
            h("span", null, p + "%")
          ]),
          h("div", { class: "pbar" + (p === 100 && prog.done ? " ok" : "") }, [h("i", { style: "width:" + p + "%" })])
        ]),
        h("div", { class: "course-foot" }, [
          h("span", { class: "small muted" }, prog.done ? "已学 " + prog.done + " 节" : "还没开始"),
          h("span", { class: "btn small primary" }, prog.done ? "继续学习 ›" : "开始学习 ›")
        ])
      ]));
    });
    app.appendChild(list);
    app.appendChild(h("div", { class: "small muted center", style: "margin-top:18px" }, "课程内容由学科导师生成，进度保存在本机"));
  }

  function render() {
    var app = $("#app");
    clear(app);
    setBottom(null);
    var tm = $("#thememenu"); if (tm) tm.hidden = true;   // 切页时收起主题菜单
    var r = parseHash();
    if (r.name === "redirect") return;
    // 强制登录：未登录不得进入任何学习页面
    if (!AUTH.user) { renderLogin(r); return; }
    if (r.name === "login") { routes.login(); return; }
    if (r.name === "hall") { renderHall(); return; }
    if (!r.courseId) { goHome(); return; }
    if (!COURSE || COURSE.id !== r.courseId) {
      ensureCourse(r.courseId, function () { render(); });
      return;
    }
    var tb = $("#tabbar"); if (tb) tb.hidden = false;
    updateTabs();
    var fn = routes[r.name] || routes.toc;
    fn(r.parts);
    setTab();
    window.scrollTo(0, 0);
  }

  /* 登录墙：未登录时替换任何视图 */
  function renderLogin(r) {
    var tb = $("#tabbar"); if (tb) tb.hidden = true;
    setTopbar("请先登录", "登录后才能开始学习", false);
    var app = $("#app");
    var u = h("input", { type: "text", placeholder: "用户名", autocomplete: "username", "aria-label": "用户名" });
    var p = h("input", { type: "password", placeholder: "密码", autocomplete: "current-password", "aria-label": "密码" });
    var err = h("div", { class: "small", style: "color:var(--err);min-height:1.4em;margin-top:8px" }, AUTH.online ? "" : "无法连接服务器，请检查网络后重试。");
    function submit() {
      err.textContent = "";
      if (!u.value.trim() || !p.value) { err.textContent = "请输入用户名和密码"; return; }
      api("/api/auth/login", { method: "POST", body: { username: u.value.trim(), password: p.value } })
        .then(function () { return api("/api/auth/me"); })
        .then(function (me) {
          AUTH.user = me.user; AUTH.checked = true; AUTH.offlineGrant = false;
          cacheSession(me.user);
          settings = loadSettings();
          updateUserChip();
          showBanner("已登录：" + me.user.displayName);
          // 登录后回到原本想去的页面
          var target = (r && r.courseId) ? ("#/c/" + r.courseId + (r.name && r.name !== "toc" ? "/" + r.name + (r.parts && r.parts.length ? "/" + r.parts.join("/") : "") : "")) : "#/";
          location.hash = target;
          render();
        })
        .catch(function (e) {
          err.textContent = e.status === 401 ? "用户名或密码错误"
            : e.status === 429 ? "尝试过于频繁，请稍后再试"
            : "登录失败：" + (e.message || "网络错误");
        });
    }
    app.appendChild(h("div", { class: "card" }, [
      h("div", { class: "course-title", style: "margin-bottom:6px" }, "登录"),
      h("div", { class: "small muted" }, "账号由管理员创建；登录后学习进度会跨设备同步。"),
      h("div", { class: "field" }, [h("label", { class: "small muted" }, "用户名"), u]),
      h("div", { class: "field" }, [h("label", { class: "small muted" }, "密码"), p]),
      err,
      h("button", { class: "btn primary block", type: "button", style: "margin-top:10px", onclick: submit }, "登录")
    ]));
    p.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    setTimeout(function () { try { u.focus(); } catch (e) {} }, 50);
  }

  /* ========== 7. 视图：目录 ========== */
  routes.toc = function () {
    var o = overallStats();
    setTopbar(DATA.title, DATA.subtitle || "零基础精讲", true);
    var app = $("#app");

    var hero = h("div", { class: "hero" }, [
      h("div", { class: "htitle" }, "⚖️ " + DATA.title),
      h("div", { class: "hsub" }, (DATA.subtitle || "零基础精讲") + " · 随时随地学一点"),
      h("div", { class: "hmeta" }, DATA.chapters.length + " 章 · " + o.total + " 个小节 · " + o.qTotalAll + " 道自测题")
    ]);
    var stats = h("div", { class: "herostats" }, [
      h("div", { class: "hstat" }, [h("b", null, o.done + "/" + o.total), "已学小节"]),
      h("div", { class: "hstat" }, [h("b", null, pct(o.done, o.total) + "%"), "阅读进度"]),
      h("div", { class: "hstat" }, [h("b", null, o.qDone ? o.qRight + "/" + o.qDone : "0"), "自测得分"])
    ]);
    hero.appendChild(stats);
    app.appendChild(hero);

    // 继续学习
    var lastSid = state.lastSid && DATA.flat.some(function (s) { return s.id === state.lastSid; }) ? state.lastSid : "";
    var nextSec = lastSid ? findSec(lastSid) : firstUnread();
    if (nextSec) {
      app.appendChild(h("div", { class: "section-block", style: "margin-top:14px" }, [
        h("button", { class: "btn primary block", type: "button", onclick: function () { go("#/read/" + nextSec.id); } },
          (lastSid ? "▶️ 继续学习：" : "🚀 开始学习：") + nextSec.chTitle.replace(/^第.+?章\s*/, "") + " · " + nextSec.title)
      ]));
    }

    // 搜索入口
    app.appendChild(h("div", { class: "searchbox" }, [
      h("input", { id: "searchinput", type: "search", placeholder: "搜索知识点 / 法条 / 关键词…", "aria-label": "搜索" }),
      h("button", { class: "btn", type: "button", onclick: function () { doSearch($("#searchinput").value); } }, "🔍")
    ]));
    var sres = h("div", { id: "searchres" });
    app.appendChild(sres);

    // 章节列表
    var list = h("div", { class: "section-block" });
    list.appendChild(h("h3", { style: "margin:8px 0 10px;font-size:1.02em" }, "章节目录"));
    DATA.chapters.forEach(function (ch, i) {
      var st = chapterStats(ch);
      var card = h("div", { class: "card tap", onclick: function () { go("#/ch/" + ch.id); } }, [
        h("div", { class: "chap-head" }, [
          h("div", { class: "chap-no" }, String(i + 1)),
          h("div", { class: "chap-main" }, [
            h("div", { class: "chap-title" }, ch.title),
            h("div", { class: "chap-sum" }, ch.summary || "")
          ])
        ]),
        h("div", { class: "chap-foot" }, [
          h("span", { class: "pill" }, "📖 " + st.done + "/" + st.total),
          st.quiz ? h("span", { class: "pill " + (st.quiz.best >= Math.ceil(st.quiz.total * 0.8) ? "ok" : "") }, "📝 最好 " + st.quiz.best + "/" + st.quiz.total) : (st.quizTotal ? h("span", { class: "pill" }, "📝 未测") : null)
        ])
      ]);
      list.appendChild(card);
    });
    app.appendChild(list);
  };

  function findSec(sid) { for (var i = 0; i < DATA.flat.length; i++) if (DATA.flat[i].id === sid) return DATA.flat[i]; return null; }
  function firstUnread() { for (var i = 0; i < DATA.flat.length; i++) if (!state.read[DATA.flat[i].id]) return DATA.flat[i]; return DATA.flat[0] || null; }

  function doSearch(q) {
    var res = $("#searchres");
    if (!res) return;
    clear(res);
    q = (q || "").trim();
    if (!q) return;
    var lower = q.toLowerCase(), hits = [];
    DATA.flat.forEach(function (s) {
      var hay = (s.title + " " + s.plain + " " + s.body + " " + s.keyPoints.join(" ") + " " + s.pitfalls.join(" ") + " " + s.articles.join(" ")).toLowerCase();
      if (hay.indexOf(lower) >= 0) hits.push(s);
    });
    if (!hits.length) { res.appendChild(h("div", { class: "empty small", text: "没有找到「" + q + "」相关内容" })); return; }
    var box = h("div", { class: "card" });
    box.appendChild(h("div", { class: "small muted", style: "margin-bottom:6px" }, "找到 " + hits.length + " 个小节"));
    hits.slice(0, 30).forEach(function (s) {
      var snip = s.plain || s.body.replace(/[#*>]/g, "").slice(0, 60);
      box.appendChild(h("div", { class: "hit tap", style: "cursor:pointer", onclick: function () { go("#/read/" + s.id); } }, [
        h("div", { class: "hk" }, s.chTitle),
        h("div", { class: "ht" }, s.title),
        h("div", { class: "small muted" }, snip)
      ]));
    });
    res.appendChild(box);
  }

  /* ========== 8. 视图：章节 ========== */
  routes.ch = function (parts) {
    var ch = DATA.chapters.filter(function (c) { return c.id === parts[0]; })[0];
    if (!ch) { go("#/"); return; }
    setTopbar(ch.title, DATA.title, true);
    var app = $("#app"), st = chapterStats(ch);
    app.appendChild(h("div", { class: "read-head" }, [
      h("div", { class: "crumbs" }, DATA.title + " › " + ch.title),
      h("h1", null, ch.title)
    ]));
    if (ch.summary) app.appendChild(h("div", { class: "plain-box" }, [h("div", { class: "lab" }, "本章导读"), h("div", null, ch.summary)]));

    app.appendChild(h("div", { class: "pbar-label" }, [h("span", null, "阅读进度"), h("span", null, st.done + "/" + st.total)]));
    app.appendChild(h("div", { class: "pbar" + (st.done === st.total && st.total ? " ok" : "") }, [h("i", { style: "width:" + pct(st.done, st.total) + "%" })]));

    var box = h("div", { class: "card", style: "margin-top:14px" });
    ch.sections.forEach(function (s, i) {
      var done = !!state.read[s.id];
      box.appendChild(h("div", { class: "row tap" + (done ? " done" : ""), style: "cursor:pointer", onclick: function () { go("#/read/" + s.id); } }, [
        h("div", { class: "rno" }, done ? "✓" : String(i + 1)),
        h("div", { class: "rmain" }, [
          h("div", { class: "rtitle" }, s.title),
          h("div", { class: "rsub" }, s.plain ? s.plain.slice(0, 40) : "")
        ]),
        h("div", { class: "muted" }, "›")
      ]));
    });
    app.appendChild(box);

    if (ch.quiz.length) {
      app.appendChild(h("div", { class: "section-block" }, [
        h("button", { class: "btn primary block", type: "button", onclick: function () { go("#/quiz/" + ch.id); } },
          "📝 本章自测（" + ch.quiz.length + " 题）" + (st.quiz ? " · 上次 " + st.quiz.best + "/" + st.quiz.total : ""))
      ]));
    } else {
      app.appendChild(h("div", { class: "small muted center", style: "margin-top:12px" }, "本章暂无自测题"));
    }
  };

  /* ========== 9. 视图：阅读 ========== */
  routes.read = function (parts) {
    var sid = parts[0];
    var s = findSec(sid);
    if (!s) { go("#/"); return; }
    var ch = DATA.chapters[s.chIndex];
    setTopbar(s.title, ch.title, true);
    var app = $("#app");
    app.appendChild(h("div", { class: "read-head" }, [
      h("div", { class: "crumbs" }, ch.title + " · 第 " + (s.index + 1) + " 节"),
      h("h1", null, s.title)
    ]));

    if (s.plain) app.appendChild(h("div", { class: "plain-box" }, [h("div", { class: "lab" }, "💡 一句话搞懂"), h("div", null, s.plain)]));

    if (s.body) {
      var md = h("div", { class: "body-md" });
      md.innerHTML = renderMd(s.body, { labels: true });
      app.appendChild(md);
    }

    if (s.keyPoints.length) {
      app.appendChild(h("div", { class: "callout key" }, [
        h("div", { class: "lab" }, "✅ 记住这几点"),
        h("ul", null, s.keyPoints.map(function (k) { return h("li", null, k); }))
      ]));
    }
    if (s.pitfalls.length) {
      app.appendChild(h("div", { class: "callout pit" }, [
        h("div", { class: "lab" }, "⚠️ 容易搞混"),
        h("ul", null, s.pitfalls.map(function (k) { return h("li", null, k); }))
      ]));
    }
    if (s.articles.length) {
      app.appendChild(renderLawSection(s.articles));
    }

    // 标记已读 + 上一节/下一节
    var isRead = !!state.read[s.id];
    var fi = flatIndex(s);
    var prev = DATA.flat[fi === 0 ? 0 : fi - 1];
    var next = DATA.flat[flatIndex(s) + 1];
    var prevBtn = h("button", { class: "btn ghost", type: "button", disabled: !prev || prev.id === s.id, onclick: function () { if (prev && prev.id !== s.id) go("#/read/" + prev.id); } }, "‹ 上一节");
    // 翻页只记位置，不标记已学会；已读必须由用户显式点击「标记已学会」
    var nextBtn = next
      ? h("button", { class: "btn", type: "button", onclick: function () { go("#/read/" + next.id); } }, "下一节 ›")
      : h("button", { class: "btn", type: "button", onclick: function () { go("#/quiz/" + ch.id); } }, "去自测 →");
    setBottom([
      h("button", { class: "btn " + (isRead ? "ghost" : "primary"), type: "button", onclick: function () { markRead(s.id, true); render(); } }, isRead ? "✓ 已学会" : "标记已学会"),
      prevBtn, nextBtn
    ]);
    // 自动记录上次位置（不标已读）
    if (state.lastSid !== s.id) { state.lastSid = s.id; saveState(); }
  };
  /* 相关法条：PC 端全部展开，移动端折叠展开 */
  function renderLawSection(list) {
    // 无正文数据时退回标签样式，避免展示“暂未收录”占位
    var hasAny = list.some(function (a) { return ARTICLES[a]; });
    if (!hasAny) {
      return h("div", { class: "tagrow" }, list.map(function (a) { return h("span", { class: "tag law" }, a); }));
    }
    var wrap = h("div", { class: "lawsec" });
    wrap.appendChild(h("div", { class: "lawsec-title" }, "相关法条（" + list.length + "）"));
    list.forEach(function (label) {
      var text = ARTICLES[label] || "";
      var card = h("div", { class: "lawcard" });
      var body = h("div", { class: "lawbody" });

      if (text) {
        body.appendChild(h("div", { class: "lawtext" }, text));
      } else {
        body.appendChild(h("div", { class: "lawmissing" }, "条文原文暂未收录，可点击标签在法源库查询。"));
      }

      var head = h("div", { class: "lawhead" }, [
        h("span", { class: "lawlabel" }, label),
        h("button", { class: "lawtoggle", type: "button", "aria-expanded": "false", onclick: function (e) {
          e.stopPropagation();
          var open = card.classList.contains("open");
          if (open) card.classList.remove("open"); else card.classList.add("open");
          open = !open;
          this.setAttribute("aria-expanded", open ? "true" : "false");
          this.textContent = open ? "收起" : "展开";
        } }, "展开")
      ]);
      card.appendChild(head);
      card.appendChild(body);
      wrap.appendChild(card);
    });
    return wrap;
  }

  function flatIndex(s) { for (var i = 0; i < DATA.flat.length; i++) if (DATA.flat[i].id === s.id) return i; return -1; }
  function markRead(sid, toggle) {
    if (toggle && state.read[sid]) delete state.read[sid];
    else state.read[sid] = Date.now();
    saveState();
  }

  /* ========== 10. 视图：自测 ========== */
  var quizRun = null; // { chId, idx, answers:[], picked:bool }
  routes.quiz = function (parts) {
    if (!parts[0]) {
      // 自测首页：章节列表
      setTopbar("自测", "检验一下学会了多少", false);
      var app = $("#app");
      var o = overallStats();
      app.appendChild(h("div", { class: "card" }, [
        h("div", { class: "small muted" }, "总题量 " + o.qTotalAll + " 题 · 已答 " + o.qDone + " 题 · 答对 " + o.qRight + " 题"),
        h("div", { class: "pbar", style: "margin-top:8px" }, [h("i", { style: "width:" + pct(o.qRight, o.qDone || 0) + "%" })])
      ]));
      var box = h("div", { class: "card" });
      DATA.chapters.forEach(function (ch, i) {
        if (!ch.quiz.length) return;
        var r = state.quiz[ch.id];
        box.appendChild(h("div", { class: "row tap", style: "cursor:pointer", onclick: function () { go("#/quiz/" + ch.id); } }, [
          h("div", { class: "rno" }, String(i + 1)),
          h("div", { class: "rmain" }, [
            h("div", { class: "rtitle" }, ch.title),
            h("div", { class: "rsub" }, ch.quiz.length + " 题" + (r ? " · 最好成绩 " + r.best + "/" + r.total : ""))
          ]),
          h("div", { class: "muted" }, "›")
        ]));
      });
      app.appendChild(box);
      return;
    }
    var ch = DATA.chapters.filter(function (c) { return c.id === parts[0]; })[0];
    if (!ch || !ch.quiz.length) { go("#/quiz"); return; }
    // 续做或新开
    if (!quizRun || quizRun.chId !== ch.id || parts[1] === "new") {
      quizRun = { chId: ch.id, idx: 0, answers: [], picked: -1 };
    }
    renderQuiz(ch);
  };

  function renderQuiz(ch) {
    var app = $("#app");
    clear(app);          // 🔴 必须清空：本函数会在作答/下一题时重复调用，不清会叠出多份题目
    setBottom(null);
    var q = ch.quiz[quizRun.idx];
    var total = ch.quiz.length;
    setTopbar("自测 · " + ch.title.replace(/^第.+?章\s*/, ""), "第 " + (quizRun.idx + 1) + "/" + total + " 题", true);

    app.appendChild(h("div", { class: "pbar-label" }, [h("span", null, "答题进度"), h("span", null, quizRun.idx + "/" + total)]));
    app.appendChild(h("div", { class: "pbar" }, [h("i", { style: "width:" + pct(quizRun.idx, total) + "%" })]));

    var card = h("div", { class: "qcard", style: "margin-top:14px" });
    card.appendChild(h("div", { class: "qmeta" }, [
      h("span", { class: "qtype" }, q.type === "judge" || q.type === "tf" ? "判断题" : "单选题"),
      h("span", null, "第 " + (quizRun.idx + 1) + " / " + total + " 题")
    ]));
    card.appendChild(h("div", { class: "qstem" }, q.q));

    var ai = answerIndex(q);
    var keys = "ABCDEFGH";
    q.options.forEach(function (opt, oi) {
      var cls = "opt";
      if (quizRun.picked >= 0) {
        if (oi === ai) cls += " right";
        else if (oi === quizRun.answers[quizRun.idx]) cls += " wrong";
      }
      var btn = h("button", { class: cls, type: "button", disabled: quizRun.picked >= 0, onclick: function () { pickAnswer(oi, ai, ch); } }, [
        h("span", { class: "okey" }, keys[oi] || String(oi + 1)),
        h("span", null, opt)
      ]);
      card.appendChild(btn);
    });

    if (quizRun.picked >= 0) {
      var good = quizRun.picked === ai;
      card.appendChild(h("div", { class: "explain " + (good ? "good" : "bad") }, [
        h("div", { class: "lab" }, good ? "✅ 回答正确" : "❌ 回答错误" + (ai >= 0 ? "，正确答案：" + (keys[ai] || (ai + 1)) : "")),
        h("div", null, q.explain || "（暂无解析）")
      ]));
    }
    app.appendChild(card);

    // 底部：下一题/提交
    if (quizRun.picked < 0) {
      setBottom([h("button", { class: "btn primary", type: "button", disabled: true }, "请选择答案")]);
    } else {
      var last = quizRun.idx >= total - 1;
      setBottom([h("button", { class: "btn primary", type: "button", onclick: function () { last ? finishQuiz(ch) : (quizRun.idx++, quizRun.picked = -1, renderQuiz(ch)); } }, last ? "查看成绩" : "下一题 ›")]);
    }
  }

  function pickAnswer(oi, ai, ch) {
    if (quizRun.picked >= 0) return;
    quizRun.picked = oi;
    quizRun.answers[quizRun.idx] = oi;
    renderQuiz(ch);
  }

  function finishQuiz(ch) {
    var right = 0;
    ch.quiz.forEach(function (q, i) { if (quizRun.answers[i] === answerIndex(q)) right++; });
    var total = ch.quiz.length;
    var prev = state.quiz[ch.id];
    if (!prev || right > prev.best) state.quiz[ch.id] = { best: right, total: total, at: Date.now() };
    saveState();

    var app = $("#app");
    clear(app);
    setBottom(null);
    setTopbar("自测成绩", ch.title, true);
    var p = pct(right, total);
    var ring = h("div", { class: "score-ring", style: "--p:" + p }, [h("div", { class: "val" }, [String(right), h("small", null, "/" + total)])]);
    app.appendChild(h("div", { class: "card center" }, [
      h("div", { class: "muted" }, ch.title),
      ring,
      h("div", { style: "font-weight:700;margin-top:6px" }, p >= 80 ? "🎉 掌握得不错！" : p >= 60 ? "👍 继续加油" : "📖 建议回去再读一遍"),
      h("div", { class: "small muted" }, "正确率 " + p + "%")
    ]));

    // 错题回顾
    var wrongs = [];
    ch.quiz.forEach(function (q, i) { if (quizRun.answers[i] !== answerIndex(q)) wrongs.push({ q: q, i: i }); });
    if (wrongs.length) {
      var wb = h("div", { class: "card" });
      wb.appendChild(h("h3", { style: "font-size:1em" }, "错题回顾（" + wrongs.length + "）"));
      wrongs.forEach(function (w) {
        var ai = answerIndex(w.q);
        wb.appendChild(h("div", { style: "padding:8px 0;border-bottom:1px solid var(--line)" }, [
          h("div", { style: "font-weight:600;font-size:.94em" }, (w.i + 1) + ". " + w.q.q),
          h("div", { class: "small", style: "color:var(--ok);margin-top:4px" }, "正确答案：" + ((w.q.options[ai] != null) ? ("ABCDEFGH"[ai] + ". " + w.q.options[ai]) : "—")),
          h("div", { class: "small muted", style: "margin-top:2px" }, w.q.explain || "")
        ]));
      });
      app.appendChild(wb);
    }

    setBottom([
      h("button", { class: "btn", type: "button", onclick: function () { go("#/quiz/" + ch.id + "/new"); } }, "重做一遍"),
      h("button", { class: "btn primary", type: "button", onclick: function () { go("#/ch/" + ch.id); } }, "返回本章")
    ]);
    quizRun = null;   // 已交卷：再次进入该章自测应重新开卷，而不是停在已作答态
  }

  /* ========== 11. 视图：我的 ========== */
  routes.me = function () {
    setTopbar("我的学习", DATA.title, false);
    var app = $("#app");
    var o = overallStats();
    app.appendChild(h("div", { class: "stat-grid" }, [
      h("div", { class: "stat-box" }, [h("b", null, o.done + "/" + o.total), h("span", null, "已学小节")]),
      h("div", { class: "stat-box" }, [h("b", null, pct(o.done, o.total) + "%"), h("span", null, "阅读进度")]),
      h("div", { class: "stat-box" }, [h("b", null, o.qRight), h("span", null, "自测答对")]),
      h("div", { class: "stat-box" }, [h("b", null, o.qTotalAll), h("span", null, "题库总量")])
    ]));

    var ds = drillStats();
    var dr = h("div", { class: "card", style: "margin-top:14px" });
    dr.appendChild(h("h3", { style: "font-size:1em" }, "刷题统计"));
    dr.appendChild(h("div", { class: "stat-grid", style: "margin-top:8px" }, [
      h("div", { class: "stat-box" }, [h("b", null, String(ds.attempts)), h("span", null, "累计答题")]),
      h("div", { class: "stat-box" }, [h("b", null, ds.accuracy + "%"), h("span", null, "正确率")]),
      h("div", { class: "stat-box" }, [h("b", null, String(ds.today)), h("span", null, "今日刷题")]),
      h("div", { class: "stat-box" }, [h("b", null, String(ds.wrong)), h("span", null, "错题本")])
    ]));
    if (ds.attempts) {
      var recent = (drill.history || []).slice(0, 5);
      if (recent.length) {
        dr.appendChild(h("div", { style: "margin-top:12px" }, recent.map(function (r) {
          var d = new Date(r.ts);
          var mm = (d.getMonth() + 1) + "-" + d.getDate();
          return h("div", { class: "row", style: "min-height:auto;padding:8px 2px" }, [
            h("div", { class: "rmain" }, [h("div", { class: "rtitle", style: "font-size:.9em" }, r.label)]),
            h("div", { class: "small muted" }, mm + " · " + r.right + "/" + r.total)
          ]);
        })));
      }
    }
    app.appendChild(dr);

    var cb = h("div", { class: "card", style: "margin-top:14px" });
    cb.appendChild(h("h3", { style: "font-size:1em" }, "各章进度"));
    DATA.chapters.forEach(function (ch, i) {
      var st = chapterStats(ch);
      cb.appendChild(h("div", { class: "chapbar" }, [
        h("div", { class: "cb-top" }, [h("span", null, (i + 1) + ". " + ch.title.replace(/^第.+?章\s*/, "")), h("span", { class: "muted" }, st.done + "/" + st.total + (st.quiz ? " · 测 " + st.quiz.best + "/" + st.quiz.total : ""))]),
        h("div", { class: "pbar" + (st.done === st.total && st.total ? " ok" : "") }, [h("i", { style: "width:" + pct(st.done, st.total) + "%" })])
      ]));
    });
    app.appendChild(cb);

    var set = h("div", { class: "card" });
    set.appendChild(h("h3", { style: "font-size:1em" }, "阅读设置"));
    set.appendChild(h("div", { class: "setting" }, [
      h("span", null, "字体大小"),
      (function () {
        var seg = h("div", { class: "seg" });
        [["小", 0.9], ["标准", 1], ["大", 1.15], ["特大", 1.3]].forEach(function (p) {
          seg.appendChild(h("button", { type: "button", "aria-pressed": String(settings.fontScale === p[1]), onclick: function () { settings.fontScale = p[1]; applyFont(p[1]); saveSettings(); render(); } }, p[0]));
        });
        return seg;
      })()
    ]));
    set.appendChild(h("div", { class: "setting" }, [
      h("span", null, "主题"),
      (function () {
        var seg = h("div", { class: "seg" });
        [["日间", "light"], ["护眼", "sepia"], ["夜间", "dark"]].forEach(function (p) {
          seg.appendChild(h("button", { type: "button", "aria-pressed": String(settings.theme === p[1]), onclick: function () { settings.theme = p[1]; applyTheme(p[1]); saveSettings(); render(); } }, p[0]));
        });
        return seg;
      })()
    ]));
    app.appendChild(set);

    app.appendChild(h("div", { class: "section-block" }, [
      h("button", { class: "btn block", type: "button", onclick: goHome }, "📚 切换课程"),
      h("button", { class: "btn block", type: "button", style: "margin-top:10px", onclick: function () {
        var n = Object.keys(state.read || {}).length;
        if (!n) { showBanner("当前课程还没有已掌握的章节。"); return; }
        if (window.confirm("将清除本课程全部 " + n + " 个「已学会」标记（阅读进度归零），自测与刷题记录保留。确定吗？")) {
          // 墓碑必须先于清空写入：否则服务端并集会把旧标记合并回来，删除等于没做
          state.readClearedAt = Date.now();
          state.read = {};
          saveState();
          render();
          showBanner("已清理 " + n + " 个已掌握标记。");
        }
      } }, "🧹 清理全部已掌握"),
      h("button", { class: "btn block", type: "button", style: "margin-top:10px", onclick: function () {
        if (window.confirm("确定要清空《" + (COURSE && COURSE.meta.title || DATA.title) + "》的所有学习进度与刷题记录吗？此操作不可撤销。")) { resetState(); drill = emptyDrill(); drill.wipedAt = Date.now(); saveDrill(); render(); showBanner("进度已重置。"); }
      } }, "🗑 重置本课程进度")
    ]));
    app.appendChild(h("div", { class: "card" }, [
      h("h3", { style: "font-size:1em" }, "账号"),
      h("div", { class: "setting" }, [
        h("span", null, "当前用户"),
        h("span", { class: "small muted" }, AUTH.user ? (AUTH.user.displayName + "（@" + AUTH.user.username + "）") : "未登录")
      ]),
      h("div", { class: "btnrow" }, [
        h("button", { class: "btn", type: "button", style: "flex:1", onclick: function () {
          api("/api/auth/logout", { method: "POST" }).catch(function () {}).then(function () {
            AUTH.user = null; clearCachedSession(); COURSE = null; DATA = null; BANK = null; state = null; drill = null;
            updateUserChip(); showBanner("已退出登录。"); render();
          });
        } }, "退出登录")
      ])
    ]));
    app.appendChild(h("div", { class: "small muted center" }, "课程：" + ((COURSE && COURSE.meta.title) || DATA.title) + " · 内容版本 " + (DATA.version || "—") + " · 进度已同步到账号"));
  };

  /* ========== 12. 视图：继续 ========== */
  routes.continue = function () {
    var s = state.lastSid && findSec(state.lastSid) ? findSec(state.lastSid) : firstUnread();
    if (s) go("#/read/" + s.id);
    else go("#/");
  };

  /* ========== 11.5 刷题 ========== */
  var BANK = null;
  var ARTICLES = {};                 // 当前课程的法条正文映射：{"《刑法》第2条": "……"}
  var drill = null;
  var randomPick = { count: 20, chapters: null };

  function normalizeBank(raw) {
    var b = { version: "", questions: [], byId: {}, byChapter: {}, total: 0 };
    function push(q) {
      if (!q || !q.stem || !q.options || q.options.length < 2) return false;
      if (!q.id) q.id = "q-auto-" + b.questions.length;
      if (b.byId[q.id]) return false;
      b.questions.push(q);
      b.byId[q.id] = q;
      if (!b.byChapter[q.chapterId]) b.byChapter[q.chapterId] = [];
      b.byChapter[q.chapterId].push(q);
      return true;
    }
    if (raw && Array.isArray(raw.questions)) {
      b.version = (raw.meta && raw.meta.version) || "unknown";
      raw.questions.forEach(function (q) {
        if (!q || !q.options) return;
        push({
          id: q.id,
          chapterId: q.chapterId || "",
          chapterTitle: q.chapterTitle || "",
          type: q.type || (q.options.length === 2 ? "judge" : "single"),
          difficulty: clamp(Number(q.difficulty) || 1, 1, 3),
          stem: q.stem || q.q || "",
          options: q.options.slice(),
          answerRaw: q.answer,
          explain: q.explain || "",
          articles: q.articles || [],
          tags: q.tags || []
        });
      });
    }
    /* 兜底：题库未就绪时，用教材自带的 quiz 构建，保证刷题不白屏 */
    if (!b.questions.length && DATA && DATA.chapters) {
      b.version = "from-content";
      DATA.chapters.forEach(function (ch) {
        ch.quiz.forEach(function (q, i) {
          push({
            id: ch.id + "-q" + (i + 1),
            chapterId: ch.id,
            chapterTitle: ch.title,
            type: q.type,
            difficulty: 1,
            stem: q.q,
            options: q.options.slice(),
            answerRaw: q.answerRaw,
            explain: q.explain,
            articles: [],
            tags: []
          });
        });
      });
    }
    b.total = b.questions.length;
    return b;
  }

  function emptyDrill() {
    return { version: 1, bankVersion: "", qstats: {}, wrong: {}, history: [], session: null, updatedAt: 0, wipedAt: 0 };
  }
  function loadDrill(cid) {
    var fresh = emptyDrill();
    try {
      var raw = localStorage.getItem(drillKey(cid));
      if (!raw) return fresh;
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object" || s.version !== 1) return fresh;
      s.qstats = s.qstats || {};
      s.wrong = s.wrong || {};
      s.history = Array.isArray(s.history) ? s.history : [];
      return s;
    } catch (e) { return fresh; }
  }
  function saveDrill() {
    if (!store.ok || !COURSE) return;
    try {
      drill.updatedAt = Date.now();
      localStorage.setItem(drillKey(COURSE.id), JSON.stringify(drill));
    } catch (e) {
      store.ok = false;
      showBanner("进度无法保存（浏览器存储不可用），刷题仍可继续。");
    }
    scheduleSync("drill");
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n) {
    var s = shuffle(arr);
    return n >= s.length ? s : s.slice(0, n);
  }
  function drillStats() {
    var attempts = 0, right = 0;
    for (var k in drill.qstats) {
      var st = drill.qstats[k];
      attempts += (st.r || 0) + (st.w || 0);
      right += (st.r || 0);
    }
    var t0 = new Date(); t0.setHours(0, 0, 0, 0);
    var today = 0;
    (drill.history || []).forEach(function (hh) { if (hh.ts >= t0.getTime()) today += hh.total || 0; });
    return {
      attempts: attempts,
      right: right,
      accuracy: attempts ? Math.round((right / attempts) * 100) : 0,
      today: today,
      wrong: Object.keys(drill.wrong).length
    };
  }
  function chapterStatsDrill(chId) {
    var a = 0, r = 0;
    (BANK.byChapter[chId] || []).forEach(function (q) {
      var st = drill.qstats[q.id];
      if (st) { a += (st.r || 0) + (st.w || 0); r += (st.r || 0); }
    });
    return { attempts: a, right: r, accuracy: a ? Math.round((r / a) * 100) : 0 };
  }

  function startDrill(mode, opts) {
    opts = opts || {};
    var pool = [];
    if (opts.ids) {
      pool = opts.ids.map(function (id) { return BANK.byId[id]; }).filter(Boolean);
    } else if (mode === "chapter") {
      pool = (BANK.byChapter[opts.chapterId] || []).slice();
    } else if (mode === "wrong") {
      pool = BANK.questions.filter(function (q) { return !!drill.wrong[q.id]; });
    } else {
      pool = BANK.questions.filter(function (q) { return !opts.chapters || opts.chapters.indexOf(q.chapterId) >= 0; });
    }
    if (!pool.length) { showBanner("没有可刷的题目，先去目录读几节吧。"); return; }
    var n = opts.count && opts.count > 0 ? Math.min(opts.count, pool.length) : pool.length;
    var picked = sample(pool, n);
    drill.session = {
      mode: mode,
      label: opts.label || (mode === "chapter" ? "章节刷题" : mode === "wrong" ? "错题重刷" : "随机刷题"),
      ids: picked.map(function (q) { return q.id; }),
      idx: 0,
      answers: [],
      picked: -1,
      streak: 0,
      startedAt: Date.now()
    };
    saveDrill();
    go("#/drill/run");
  }

  routes.drill = function (parts) {
    var sub = parts[0] || "home";
    if (sub === "ch") {
      if (parts[1]) renderChapterSetup(parts[1]); else renderChapterPick();
      return;
    }
    if (sub === "random") { renderRandomSetup(); return; }
    if (sub === "run") { renderDrillRun(); return; }
    if (sub === "result") { renderDrillResult(); return; }
    if (sub === "wrong") { renderWrongBook(); return; }
    renderDrillHome();
  };

  function renderDrillHome() {
    setTopbar("刷题", "题库 " + BANK.total + " 题", false);
    var app = $("#app");
    var ds = drillStats();

    app.appendChild(h("div", { class: "hero" }, [
      h("div", { class: "htitle" }, "✍️ 刷题"),
      h("div", { class: "hsub" }, "章节练习 · 随机抽题 · 错题重刷"),
      h("div", { class: "herostats" }, [
        h("div", { class: "hstat" }, [h("b", null, String(BANK.total)), "题库总量"]),
        h("div", { class: "hstat" }, [h("b", null, String(ds.attempts)), "累计答题"]),
        h("div", { class: "hstat" }, [h("b", null, ds.accuracy + "%"), "正确率"])
      ])
    ]));

    if (drill.session && drill.session.ids && drill.session.ids.length) {
      var s = drill.session;
      app.appendChild(h("div", { class: "section-block", style: "margin-top:14px" }, [
        h("button", { class: "btn primary block", type: "button", onclick: function () { go("#/drill/run"); } },
          "▶️ 继续上次刷题：" + s.label + "（" + (Math.min(s.idx + 1, s.ids.length)) + "/" + s.ids.length + "）")
      ]));
    }

    app.appendChild(h("div", { class: "section-block", style: "margin-top:14px" }, [
      h("div", { class: "card tap", onclick: function () { go("#/drill/ch"); } }, [
        h("div", { class: "mode-title" }, "📚 按章节刷题"),
        h("div", { class: "mode-desc" }, "选一章，从本章题库里抽题，顺序打乱"),
        h("div", { class: "mode-foot" }, DATA.chapters.length + " 章可选")
      ]),
      h("div", { class: "card tap", onclick: function () { go("#/drill/random"); } }, [
        h("div", { class: "mode-title" }, "🎲 随机刷题"),
        h("div", { class: "mode-desc" }, "跨章节抽题，可选题量和范围"),
        h("div", { class: "mode-foot" }, "适合考前突击、随时来一组")
      ]),
      h("div", { class: "card tap", onclick: function () { go("#/drill/wrong"); } }, [
        h("div", { class: "mode-title" }, "🔁 错题本"),
        h("div", { class: "mode-desc" }, "答错的题自动收进来，连续答对 2 次自动移出"),
        h("div", { class: "mode-foot" }, ds.wrong ? ds.wrong + " 道待攻克" : "暂无错题")
      ])
    ]));
  }

  function renderChapterPick() {
    setTopbar("按章节刷题", "选择一章", true);
    var app = $("#app");
    var box = h("div", { class: "card" });
    DATA.chapters.forEach(function (ch, i) {
      var n = (BANK.byChapter[ch.id] || []).length;
      var ca = chapterStatsDrill(ch.id);
      box.appendChild(h("div", { class: "row tap", style: "cursor:pointer", onclick: function () { go("#/drill/ch/" + ch.id); } }, [
        h("div", { class: "rno" }, String(i + 1)),
        h("div", { class: "rmain" }, [
          h("div", { class: "rtitle" }, ch.title.replace(/^第.+?章\s*/, "")),
          h("div", { class: "rsub" }, n + " 题" + (ca.attempts ? " · 已刷 " + ca.attempts + " · 正确率 " + ca.accuracy + "%" : " · 未刷"))
        ]),
        h("div", { class: "muted" }, "›")
      ]));
    });
    app.appendChild(box);
  }

  function renderChapterSetup(chId) {
    var ch = DATA.chapters.filter(function (c) { return c.id === chId; })[0];
    if (!ch) { go("#/drill/ch"); return; }
    var pool = BANK.byChapter[chId] || [];
    setTopbar("按章节刷题", ch.title, true);
    var app = $("#app");
    app.appendChild(h("div", { class: "read-head" }, [h("h1", null, ch.title)]));
    app.appendChild(h("div", { class: "plain-box" }, [
      h("div", { class: "lab" }, "本章题库"),
      h("div", null, "共 " + pool.length + " 题，开始后顺序打乱")
    ]));
    var box = h("div", { class: "section-block" });
    box.appendChild(h("h3", { style: "font-size:1em" }, "选择题量"));
    var wrap = h("div", { class: "chips" });
    [10, 20, 0].forEach(function (n) {
      var cnt = n === 0 ? pool.length : Math.min(n, pool.length);
      if (cnt <= 0) return;
      wrap.appendChild(h("button", {
        class: "chip", type: "button", disabled: pool.length === 0,
        onclick: function () { startDrill("chapter", { chapterId: chId, count: cnt, label: ch.title.replace(/^第.+?章\s*/, "") }); }
      }, n === 0 ? "全部（" + pool.length + "）" : n + " 题"));
    });
    box.appendChild(wrap);
    app.appendChild(box);
  }

  function renderRandomSetup() {
    setTopbar("随机刷题", "跨章节抽题", true);
    var app = $("#app");
    if (!randomPick.chapters) randomPick.chapters = DATA.chapters.map(function (c) { return c.id; });

    app.appendChild(h("div", { class: "section-block" }, [
      h("h3", { style: "font-size:1em" }, "题量"),
      (function () {
        var wrap = h("div", { class: "chips" });
        [10, 20, 30, 50].forEach(function (n) {
          wrap.appendChild(h("button", {
            class: "chip" + (randomPick.count === n ? " on" : ""), type: "button",
            "aria-pressed": String(randomPick.count === n),
            onclick: function () { randomPick.count = n; render(); }
          }, n + " 题"));
        });
        return wrap;
      })()
    ]));

    app.appendChild(h("div", { class: "section-block" }, [
      h("h3", { style: "font-size:1em" }, "范围（可多选）"),
      (function () {
        var wrap = h("div", { class: "chips" });
        var all = randomPick.chapters.length === DATA.chapters.length;
        wrap.appendChild(h("button", {
          class: "chip" + (all ? " on" : ""), type: "button",
          onclick: function () {
            randomPick.chapters = all ? [] : DATA.chapters.map(function (c) { return c.id; });
            render();
          }
        }, all ? "全部章节" : "选择全部"));
        DATA.chapters.forEach(function (ch, i) {
          var on = randomPick.chapters.indexOf(ch.id) >= 0;
          wrap.appendChild(h("button", {
            class: "chip" + (on ? " on" : ""), type: "button", "aria-pressed": String(on),
            onclick: function () {
              var k = randomPick.chapters.indexOf(ch.id);
              if (k >= 0) randomPick.chapters.splice(k, 1); else randomPick.chapters.push(ch.id);
              render();
            }
          }, String(i + 1)));
        });
        return wrap;
      })()
    ]));

    var pool = BANK.questions.filter(function (q) { return randomPick.chapters.indexOf(q.chapterId) >= 0; });
    app.appendChild(h("div", { class: "small muted center", style: "margin:10px 0" }, "当前范围共 " + pool.length + " 题，本次抽 " + Math.min(randomPick.count, pool.length) + " 题"));
    setBottom([
      h("button", {
        class: "btn primary", type: "button", disabled: pool.length === 0,
        onclick: function () { startDrill("random", { chapters: randomPick.chapters.slice(), count: randomPick.count }); }
      }, "开始随机刷题")
    ]);
  }

  function renderDrillRun() {
    var app = $("#app");
    clear(app);
    setBottom(null);
    var s = drill.session;
    if (!s || !s.ids || !s.ids.length) { go("#/drill"); return; }
    if (s.idx >= s.ids.length) { go("#/drill/result"); return; }
    var q = BANK.byId[s.ids[s.idx]];
    if (!q) { s.idx++; saveDrill(); renderDrillRun(); return; }

    var total = s.ids.length;
    setTopbar("刷题 · " + s.label, "第 " + (s.idx + 1) + "/" + total + " 题", true);

    app.appendChild(h("div", { class: "pbar-label" }, [
      h("span", null, s.streak > 1 ? "🔥 连对 " + s.streak : "答题进度"),
      h("span", null, s.idx + "/" + total)
    ]));
    app.appendChild(h("div", { class: "pbar" }, [h("i", { style: "width:" + pct(s.idx, total) + "%" })]));

    var card = h("div", { class: "qcard", style: "margin-top:14px" });
    card.appendChild(h("div", { class: "qmeta" }, [
      h("span", { class: "qtype" }, q.type === "judge" ? "判断题" : "单选题"),
      h("span", { class: "diff" }, "★".repeat(q.difficulty) + "☆".repeat(3 - q.difficulty))
    ]));
    if (q.chapterTitle) card.appendChild(h("div", { class: "qchap" }, q.chapterTitle));
    card.appendChild(h("div", { class: "qstem" }, q.stem));

    var ai = answerIndex(q);
    var keys = "ABCDEFGH";
    q.options.forEach(function (opt, oi) {
      var cls = "opt";
      if (s.picked >= 0) {
        if (oi === ai) cls += " right";
        else if (oi === s.answers[s.idx]) cls += " wrong";
      }
      card.appendChild(h("button", { class: cls, type: "button", disabled: s.picked >= 0, onclick: function () { pickDrillAnswer(oi); } }, [
        h("span", { class: "okey" }, keys[oi] || String(oi + 1)),
        h("span", null, opt)
      ]));
    });

    if (s.picked >= 0) {
      var good = s.picked === ai;
      card.appendChild(h("div", { class: "explain " + (good ? "good" : "bad") }, [
        h("div", { class: "lab" }, good ? "✅ 回答正确" : "❌ 回答错误" + (ai >= 0 ? "，正确答案：" + (keys[ai] || (ai + 1)) : "")),
        h("div", null, q.explain || "（暂无解析）")
      ]));
      if (q.articles && q.articles.length) {
        card.appendChild(h("div", { class: "tagrow" }, q.articles.map(function (a) { return h("span", { class: "tag law" }, a); })));
      }
    }
    app.appendChild(card);

    if (s.picked < 0) {
      setBottom([h("button", { class: "btn primary", type: "button", disabled: true }, "请选择答案")]);
    } else {
      var last = s.idx >= total - 1;
      setBottom([h("button", { class: "btn primary", type: "button", onclick: function () { drillNext(); } }, last ? "查看成绩" : "下一题 ›")]);
    }
  }

  function pickDrillAnswer(oi) {
    var s = drill.session;
    if (!s || s.picked >= 0) return;
    s.picked = oi;
    s.answers[s.idx] = oi;
    var q = BANK.byId[s.ids[s.idx]];
    if (!q) return;
    var ai = answerIndex(q);
    var st = drill.qstats[q.id] || (drill.qstats[q.id] = { r: 0, w: 0, last: 0 });
    if (oi === ai) {
      st.r++;
      s.streak++;
      var w = drill.wrong[q.id];
      if (w) {
        w.ok = (w.ok || 0) + 1;
        if (w.ok >= 2) delete drill.wrong[q.id];
      }
    } else {
      st.w++;
      s.streak = 0;
      var rec = drill.wrong[q.id] || { n: 0 };
      rec.n++;
      rec.ok = 0;
      rec.ts = Date.now();
      drill.wrong[q.id] = rec;
    }
    st.last = Date.now();
    saveDrill();
    renderDrillRun();
  }

  function drillNext() {
    var s = drill.session;
    if (!s) { go("#/drill"); return; }
    if (s.idx >= s.ids.length - 1) { go("#/drill/result"); return; }
    s.idx++;
    s.picked = -1;
    saveDrill();
    renderDrillRun();
  }

  function renderDrillResult() {
    var s = drill.session;
    var app = $("#app");
    clear(app);
    setBottom(null);
    if (!s) { go("#/drill"); return; }

    var total = s.ids.length, right = 0, wrongs = [];
    s.ids.forEach(function (id, i) {
      var q = BANK.byId[id];
      if (!q) return;
      if (s.answers[i] === answerIndex(q)) right++;
      else wrongs.push({ q: q, i: i });
    });
    var dur = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
    drill.history.unshift({ ts: Date.now(), mode: s.mode, label: s.label, total: total, right: right, duration: dur });
    if (drill.history.length > 50) drill.history.length = 50;
    drill.session = null;
    saveDrill();

    setTopbar("刷题成绩", s.label, true);
    var p = pct(right, total);
    app.appendChild(h("div", { class: "card center" }, [
      h("div", { class: "muted" }, s.label),
      h("div", { class: "score-ring", style: "--p:" + p }, [h("div", { class: "val" }, [String(right), h("small", null, "/" + total)])]),
      h("div", { style: "font-weight:700;margin-top:6px" }, p >= 80 ? "🎉 掌握得不错！" : p >= 60 ? "👍 继续加油" : "📖 建议回去再读一遍"),
      h("div", { class: "small muted" }, "正确率 " + p + "% · 用时 " + Math.floor(dur / 60) + " 分 " + (dur % 60) + " 秒")
    ]));

    if (wrongs.length) {
      var wb = h("div", { class: "card" });
      wb.appendChild(h("h3", { style: "font-size:1em" }, "错题回顾（" + wrongs.length + "）"));
      wrongs.forEach(function (w) {
        var ai = answerIndex(w.q);
        wb.appendChild(h("div", { class: "wrong-item" }, [
          h("div", { style: "font-weight:600;font-size:.94em" }, (w.i + 1) + ". " + w.q.stem),
          h("div", { class: "small", style: "color:var(--ok);margin-top:4px" }, "正确答案：" + ((w.q.options[ai] != null) ? ((ai < 8 ? "ABCDEFGH"[ai] : ai + 1) + ". " + w.q.options[ai]) : "—")),
          h("div", { class: "small muted", style: "margin-top:2px" }, w.q.explain || "")
        ]));
      });
      app.appendChild(wb);
    }

    setBottom([
      h("button", { class: "btn", type: "button", onclick: function () { go("#/drill"); } }, "返回刷题"),
      h("button", { class: "btn primary", type: "button", onclick: function () { go("#/drill/random"); } }, "再来一组")
    ]);
  }

  function renderWrongBook() {
    setTopbar("错题本", "连续答对 2 次自动移出", true);
    var app = $("#app");
    var ids = Object.keys(drill.wrong);
    if (!ids.length) {
      app.appendChild(h("div", { class: "empty" }, [
        h("div", { class: "big" }, "🎉"),
        h("p", null, "还没有错题，继续保持！"),
        h("button", { class: "btn primary", type: "button", onclick: function () { go("#/drill/random"); } }, "去刷一组")
      ]));
      return;
    }
    var qs = ids.map(function (id) { return BANK.byId[id]; }).filter(Boolean);
    app.appendChild(h("div", { class: "card" }, [
      h("div", { class: "small muted" }, "共 " + qs.length + " 道错题，按错误次数排序复习"),
      h("div", { class: "small muted", style: "margin-top:4px" }, "答错即收录；连续答对 2 次自动移出，也可手动移除")
    ]));
    var box = h("div", { class: "card" });
    qs.forEach(function (q) {
      var w = drill.wrong[q.id] || {};
      box.appendChild(h("div", { class: "wrong-item" }, [
        h("div", { class: "wrong-head" }, [
          h("span", { class: "pill warn" }, "错 " + (w.n || 1) + " 次"),
          h("span", { class: "small muted" }, q.chapterTitle || "")
        ]),
        h("div", { style: "font-weight:600;font-size:.94em;margin-top:4px" }, q.stem),
        h("div", { class: "btnrow", style: "margin-top:8px" }, [
          h("button", { class: "btn small", type: "button", onclick: function () { delete drill.wrong[q.id]; saveDrill(); render(); } }, "移除"),
          h("button", { class: "btn primary small", type: "button", onclick: function () { startDrill("wrong", { label: "单题重刷", ids: [q.id] }); } }, "只刷这题")
        ])
      ]));
    });
    app.appendChild(box);
    setBottom([h("button", { class: "btn primary", type: "button", onclick: function () { startDrill("wrong", { label: "错题重刷" }); } }, "开始刷错题（" + qs.length + "）")]);
  }

  /* ========== 12.5 视图：登录 ========== */
  routes.login = function () {
    COURSE = null; DATA = null; BANK = null; state = null; drill = null;
    var tb = $("#tabbar"); if (tb) tb.hidden = true;
    setTopbar("登录", AUTH.user ? ("当前：" + AUTH.user.displayName) : "登录后进度可跨设备同步", false);
    var app = $("#app");
    var err = h("div", { class: "small", style: "color:var(--err);min-height:1.4em;margin-top:8px" }, "");

    if (AUTH.user) {
      app.appendChild(h("div", { class: "card" }, [
        h("div", { class: "course-title" }, AUTH.user.displayName),
        h("div", { class: "small muted", style: "margin-top:4px" }, "@" + AUTH.user.username + (AUTH.user.isAdmin ? " · 管理员" : "")),
        h("div", { class: "btnrow" }, [
          h("button", { class: "btn", type: "button", onclick: goHome }, "返回课程"),
          h("button", { class: "btn", type: "button", onclick: function () {
            api("/api/auth/logout", { method: "POST" }).then(function () {
              AUTH.user = null; clearCachedSession(); showBanner("已退出登录，学习进度保留在本机。"); render();
            }).catch(function (e) { err.textContent = "退出失败：" + e.message; });
          } }, "退出登录")
        ])
      ]));
      app.appendChild(h("div", { class: "small muted center" }, "退出后仍可继续学习，进度暂存本机，下次登录自动合并。"));
      return;
    }

    var u = h("input", { type: "text", placeholder: "用户名", autocomplete: "username", "aria-label": "用户名" });
    var p = h("input", { type: "password", placeholder: "密码", autocomplete: "current-password", "aria-label": "密码" });
    function submit() {
      err.textContent = "";
      if (!u.value.trim() || !p.value) { err.textContent = "请输入用户名和密码"; return; }
      api("/api/auth/login", { method: "POST", body: { username: u.value.trim(), password: p.value } })
        .then(function () { return api("/api/auth/me"); })
        .then(function (me) {
          AUTH.user = me.user; AUTH.checked = true;
          showBanner("已登录：" + me.user.displayName + "，正在同步进度…");
          pullCourse(COURSE_ID_HINT || "").catch(function(){}).then(function(){ goHome(); });
        })
        .catch(function (e) {
          err.textContent = e.status === 401 ? "用户名或密码错误" : (e.status === 429 ? "尝试过于频繁，请稍后再试" : "登录失败：" + e.message);
        });
    }

    app.appendChild(h("div", { class: "card" }, [
      h("div", { class: "course-title", style: "margin-bottom:12px" }, "登录"),
      h("div", { class: "field" }, [h("label", { class: "small muted" }, "用户名"), u]),
      h("div", { class: "field" }, [h("label", { class: "small muted" }, "密码"), p]),
      err,
      h("button", { class: "btn primary block", type: "button", style: "margin-top:10px", onclick: submit }, "登录"),
      h("div", { class: "small muted", style: "margin-top:10px" }, "账号由管理员创建。不登录也可继续使用，进度保存本机。")
    ]));
    p.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
  };

  var COURSE_ID_HINT = "";

  /* ========== 13. 启动 ========== */
  function checkStyles() {
    if (!document.body || !window.getComputedStyle) return;
    try {
      var probe = h("div", { style: "border-top-left-radius:7px;border-top-width:7px;border-top-style:solid" });
      document.body.appendChild(probe);
      var cs = window.getComputedStyle(probe);
      var ok = cs && cs.borderTopLeftRadius !== "" && parseFloat(cs.borderTopLeftRadius) >= 6;
      document.body.removeChild(probe);
      if (!ok) showBanner("样式表可能未加载（styles.css），建议强制刷新（Ctrl/Cmd+Shift+R）。");
    } catch (e) {}
  }

  function bindUI() {
    var ub = $("#userbtn");
    if (ub) {
      ub.addEventListener("click", function () { go("#/login"); });
      ub.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("#/login"); } });
    }
    $("#backbtn").addEventListener("click", function () {
      var r = parseHash();
      if (!r.courseId || r.name === "toc") { goHome(); return; }
      if (r.name === "read" && r.parts[0]) { var s = findSec(r.parts[0]); go(s ? "#/ch/" + s.chId : "#/"); return; }
      if (r.name === "ch") { go("#/"); return; }
      if (r.name === "quiz" && r.parts[0]) { go("#/quiz"); return; }
      if (r.name === "drill") { go("#/drill"); return; }
      go("#/");
    });
    $("#fontbtn").addEventListener("click", function () {
      var f = settings.fontScale || 1;
      f = f >= 1.3 ? 0.9 : Math.round((f + 0.1) * 10) / 10;
      settings.fontScale = f; applyFont(f); saveSettings();
      showBanner("字体大小：" + f.toFixed(1) + "×");
    });
    var tm = $("#themebtn");
    function toggleThemeMenu(e) { var m = $("#thememenu"); m.hidden = !m.hidden; if (e) e.stopPropagation(); }
    tm.addEventListener("click", toggleThemeMenu);
    tm.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleThemeMenu(e); } });
    var menu = $("#thememenu");
    for (var i = 0; i < menu.children.length; i++) {
      (function (b) { b.addEventListener("click", function () { var t = b.getAttribute("data-theme"); settings.theme = t; applyTheme(t); saveSettings(); menu.hidden = true; }); })(menu.children[i]);
    }
    document.addEventListener("click", function () { $("#thememenu").hidden = true; });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("#thememenu").hidden = true; } });
    window.addEventListener("hashchange", render);
    checkStyles();
  }

  function boot() {
    loadRegistry().then(function (reg) {
      // 宿主可注入已登录用户（账号服务可用时）；浏览器环境不存在该对象
      if (!AUTH.user && typeof window !== "undefined" && window.__session__) {
        AUTH.user = window.__session__.user || null;
        AUTH.checked = !!AUTH.user;
      }
      REG = reg;
      if (!REG.courses.length) {
        $("#tabbar").hidden = true;
        var app = $("#app"); clear(app);
        app.appendChild(h("div", { class: "empty" }, [
          h("div", { class: "big" }, "📚"),
          h("p", null, "没有找到课程。请确认 courses.json 与页面在同一目录。"),
          h("button", { class: "btn primary", type: "button", onclick: function () { location.reload(); } }, "重试")
        ]));
        return;
      }
      settings = loadSettings();
      applyTheme(settings.theme);
      applyFont(settings.fontScale);
      bindUI();
      if (!store.ok) showBanner("进度无法保存（浏览器存储不可用），学习仍可继续。");
      // 会话检查：401 才算未登录；网络不可用时回落到本机缓存的会话（断网可学）
      api("/api/auth/me")
        .then(function (me) {
          AUTH.user = me.user; AUTH.checked = true; AUTH.offlineGrant = false;
          cacheSession(me.user);
        })
        .catch(function (e) {
          if (e && e.status === 401) {
            AUTH.user = null; clearCachedSession();      // 服务端明确失效
          } else if (!AUTH.user) {
            var cached = readCachedSession();            // 断网：用本机缓存进入
            if (cached) {
              AUTH.user = { username: cached.username, displayName: cached.displayName, isAdmin: cached.isAdmin };
              AUTH.offlineGrant = true;
            }
          }
          AUTH.checked = true;
        })
        .then(function () {
          updateUserChip();
          if (AUTH.offlineGrant) showBanner("离线模式：使用本机会话进入，联网后自动校验并同步。");
          render();
        });
    }).catch(function () {
      var app = $("#app"); clear(app);
      app.appendChild(h("div", { class: "empty" }, [h("div", { class: "big" }, "⚠️"), h("p", null, "课程清单加载失败") ]));
    });
  }

  function updateUserChip() {
    var ub = $("#userbtn");
    if (!ub) return;
    var label = AUTH.user ? AUTH.user.displayName : "未登录";
    ub.textContent = AUTH.user ? ("👤 " + label) : "👤 登录";
    ub.setAttribute("aria-label", AUTH.user ? ("账号：" + label) : "登录");
    ub.setAttribute("title", AUTH.user ? ("账号：" + label) : "登录");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
