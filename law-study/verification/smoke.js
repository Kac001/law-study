/* law-study 冒烟测试（node，无浏览器）—— 多课程版
 * 覆盖：课程大厅 / 进入课程 / 阅读自测刷题 / 双课程存储隔离 / 旧链接重定向 / 旧数据迁移
 * 运行：node verification/smoke.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const SHIM = '/home/openclaw/.openclaw/agents/fullstack-dev/agent/workshop-skills/static-spa-delivery/scripts/dom-shim.js';
const { makeEnv, El } = require(SHIM);

const ROOT = path.resolve(__dirname, '..');
const IDS = ['app', 'banner', 'topbar', 'backbtn', 'topbar-title', 'topbar-sub', 'fontbtn', 'themebtn', 'bottombar', 'tabbar', 'thememenu'];

const C = 'criminal-law-general';
const FIX = 'fixture-course-b';
const KEY = 'course:' + C + ':progress:v1';
const DRILL_KEY = 'course:' + C + ':drill:v1';
const FIX_KEY = 'course:' + FIX + ':progress:v1';
const LEGACY_KEY = 'xingfa-zonglun:progress:v1';
const LEGACY_DRILL_KEY = 'xingfa-zonglun:drill:v1';
const SETTINGS_KEY = 'app:settings:v1';

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) { if (cond) pass++; else { fail++; fails.push({ name, extra }); } }

/* ---------- 静态课程数据 ---------- */
function readJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }
const PROD_CONTENT = readJson('courses/' + C + '/content.json');
const PROD_BANK = readJson('courses/' + C + '/bank.json');
const FIX_CONTENT = readJson('verification/fixtures/course-b/content.json');
const FIX_BANK = readJson('verification/fixtures/course-b/bank.json');
const PROD_META = readJson('courses.json').courses.filter(c => c.id === C)[0];
const FIX_META = { id: FIX, title: '测试课程B', subtitle: '仅用于自动化测试', category: '测试', icon: '🧪', color: '#2f8a52', chapters: 2, sections: 4, questions: 6, updatedAt: '2026-10-21', status: 'ready' };
const TEST_REG = { version: 'test', defaultCourse: C, courses: [PROD_META, FIX_META] };
const FILES = {};
FILES['courses.json'] = TEST_REG;
FILES['courses/' + C + '/content.json'] = PROD_CONTENT;
FILES['courses/' + C + '/bank.json'] = PROD_BANK;
FILES['courses/' + FIX + '/content.json'] = FIX_CONTENT;
FILES['courses/' + FIX + '/bank.json'] = FIX_BANK;

/* ---------- 选择器小工具 ---------- */
function matchSimple(el, sel) {
  if (el.nodeType !== 1) return false;
  if (sel[0] === '#') return el.getAttribute('id') === sel.slice(1);
  if (sel[0] === '.') return el.classList.contains(sel.slice(1));
  const m = sel.match(/^([a-zA-Z]*)\[([a-zA-Z-]+)=["']?([^"'\]]+)["']?\]$/);
  if (m) { if (m[1] && el.tagName !== m[1].toUpperCase()) return false; return el.getAttribute(m[2]) === m[3]; }
  return el.tagName === sel.toUpperCase();
}
function collectAll(env) {
  const out = [];
  const roots = Object.keys(env.registry.ids).map(k => env.registry.ids[k]);
  const seen = new Set();
  function walk(n) {
    if (!n || n.nodeType !== 1 || seen.has(n)) return;
    seen.add(n); out.push(n);
    (n.children || []).forEach(walk);
  }
  roots.forEach(walk);
  return out;
}
function install(env) {
  const doc = env.doc;
  doc.documentElement = new El('html', env.registry);
  doc.documentElement.style = { setProperty() {} };
  doc.body = new El('body', env.registry);
  doc.querySelector = function (sel) {
    if (sel[0] === '#' && sel.indexOf(' ') < 0 && sel.indexOf('[') < 0 && sel.indexOf('.') < 0) return env.registry.ids[sel.slice(1)] || null;
    return doc.querySelectorAll(sel)[0] || null;
  };
  doc.querySelectorAll = function (sel) {
    const parts = String(sel).trim().split(/\s+/);
    let els = collectAll(env).filter(e => matchSimple(e, parts[parts.length - 1]));
    for (let i = parts.length - 2; i >= 0; i--) {
      els = els.filter(e => { let p = e.parentNode; while (p) { if (matchSimple(p, parts[i])) return true; p = p.parentNode; } return false; });
    }
    return els;
  };
  // innerHTML 记录（一次性定义，支撑 renderMd / h() html 属性路径断言）
  if (!Object.getOwnPropertyDescriptor(El.prototype, 'innerHTML')) {
    Object.defineProperty(El.prototype, 'innerHTML', {
      configurable: true,
      get: function () { return this._html || ''; },
      set: function (v) { this._html = String(v); }
    });
  }
  // script 注入模拟：走真实 course.js 镜像，补上加载分支的冒烟盲区
  doc.head = new El('head', env.registry);
  doc.head.appendChild = function (s) {
    const src = s && (s.src || (s.getAttribute && s.getAttribute('src')));
    if (s && s.tagName === 'SCRIPT' && src) {
      const m = String(src).match(/^courses\/([a-z0-9-]+)\/course\.js$/);
      // fixture 课程映射到 verification 目录，不污染生产 courses/
      const fp = m ? (m[1] === FIX
        ? path.join(ROOT, 'verification', 'fixtures', 'course-b', 'course.js')
        : path.join(ROOT, 'courses', m[1], 'course.js')) : null;
      if (fp && fs.existsSync(fp)) {
        try {
          delete require.cache[require.resolve(fp)];
          require(fp);
          if (typeof s.onload === 'function') s.onload();
        } catch (e) { if (typeof s.onerror === 'function') s.onerror(); }
      } else if (typeof s.onerror === 'function') s.onerror();
      return s;
    }
    return El.prototype.appendChild.call(doc.head, s);
  };
  return env;
}

/* ---------- 启动 ---------- */
async function boot(opts) {
  opts = opts || {};
  const warns = [];
  const env = install(makeEnv({ ids: IDS, protocol: opts.protocol || 'file:', storageThrows: !!opts.storageThrows }));
  global.window = env.win; global.document = env.doc;
  global.location = env.win.location;
  global.localStorage = env.win.localStorage;
  global.fetch = opts.fetch || undefined;
  // 登录墙：除非显式 loggedOut，测试默认注入已登录用户
  // 登录墙：默认提供已登录会话（含 __session__.user 契约）
  env.win.__session__ = opts.loggedOut ? null
    : { user: { username: 'tester', displayName: '测试用户', isAdmin: false } };
  try { delete require.cache[require.resolve(path.join(ROOT, 'app.js'))]; } catch (e) {}
  env.win.__COURSES_META__ = opts.emptyRegistry ? { version: 'test', defaultCourse: '', courses: [] } : TEST_REG;
  env.win.__COURSES__ = {};
  if (!opts.noPreload) {
    env.win.__COURSES__[C] = { content: PROD_CONTENT, bank: PROD_BANK };
    env.win.__COURSES__[FIX] = { content: FIX_CONTENT, bank: FIX_BANK };
  }
  if (opts.corruptKey) env.store[KEY] = '{corrupted';
  if (opts.legacySeed) {
    env.store[LEGACY_KEY] = JSON.stringify(opts.legacySeed.progress);
    env.store[LEGACY_DRILL_KEY] = JSON.stringify(opts.legacySeed.drill);
  }
  const realWarn = console.warn;
  console.warn = function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); };
  require(path.join(ROOT, 'app.js'));
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 2));
  console.warn = realWarn;
  env.doc._warns = warns;
  return env;
}

async function fire(env, hash) {
  env.win.location.hash = hash;
  (env.win._handlers['hashchange'] || []).forEach(fn => fn());
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 1));
}
function fireSync(env, hash) {
  env.win.location.hash = hash;
  (env.win._handlers['hashchange'] || []).forEach(fn => fn());
}
function all(env) { return collectAll(env); }
function textOf(env) { const a = env.registry.ids['app']; return a ? a.textContent : ''; }
function findButtons(env) { return all(env).filter(e => e.tagName === 'BUTTON'); }

/* ---------- 场景 ---------- */
async function scenario(name, opts) {
  let env;
  try { env = await boot(opts); }
  catch (e) { ok('[' + name + '] boot 不抛异常', false, String(e && e.stack || e)); return; }

  const content = PROD_CONTENT;
  const ch0 = content.chapters[0];
  const sec0 = ch0.sections[0];
  const p = x => '#/c/' + C + x;

  // 1) 大厅
  await fire(env, '#/');
  const hallText = textOf(env);
  ok('[' + name + '] 大厅渲染', /我的课程/.test(hallText) && /刑法总论/.test(hallText), hallText.slice(0, 60));
  ok('[' + name + '] 大厅列出两门课程', /测试课程B/.test(hallText), '');

  // 2) 旧链接重定向
  fireSync(env, '#/read/' + sec0.id);
  ok('[' + name + '] 旧链接重定向到课程内', env.win.location.hash.indexOf('#/c/' + C + '/read/' + sec0.id) === 0, env.win.location.hash);
  await fire(env, env.win.location.hash);
  ok('[' + name + '] 重定向后渲染阅读页', textOf(env).indexOf(sec0.title) >= 0, textOf(env).slice(0, 50));

  // M2 回归：畸形 hash 不抛 URIError，重定向后可恢复
  let m2err = null;
  try { fireSync(env, '#/read/100%'); } catch (e) { m2err = e; }
  ok('[' + name + '] 畸形 hash 不抛异常', !m2err, String(m2err && m2err.message));
  ok('[' + name + '] 畸形 hash 被重定向', env.win.location.hash.indexOf('#/c/' + C) === 0, env.win.location.hash);
  await fire(env, p('/'));
  ok('[' + name + '] 畸形 hash 后页面可恢复', textOf(env).indexOf(content.title) >= 0, textOf(env).slice(0, 40));

  // 3) 目录
  await fire(env, p('/'));
  const tocText = textOf(env);
  ok('[' + name + '] 课程目录非空', tocText.length > 20 && tocText.indexOf(content.title) >= 0, tocText.slice(0, 40));

  // 4) 章节页
  await fire(env, p('/ch/' + ch0.id));
  ok('[' + name + '] 章节页含章标题', textOf(env).indexOf(ch0.title) >= 0);

  // 5) 阅读页 + 标记已读
  await fire(env, p('/read/' + sec0.id));
  const rdText = textOf(env);
  ok('[' + name + '] 阅读页含节标题', rdText.indexOf(sec0.title) >= 0);
  ok('[' + name + '] 阅读页含「一句话搞懂」', sec0.plain ? rdText.indexOf('一句话搞懂') >= 0 : true);
  const markBtn = findButtons(env).filter(b => /标记已学会|已学会/.test(b.textContent))[0];
  if (markBtn) {
    (markBtn._handlers['click'] || []).forEach(fn => fn());
    let saved = null; try { saved = JSON.parse(env.store[KEY]); } catch (e) {}
    if (!opts.storageThrows) {
      ok('[' + name + '] 已读落盘', !!(saved && saved.read && saved.read[sec0.id]), saved && Object.keys(saved.read || {}));
    } else {
      ok('[' + name + '] 存储禁用时不落盘', Object.keys(env.store).length === 0, Object.keys(env.store));
      const banner = env.registry.ids['banner'];
      ok('[' + name + '] 存储禁用显示横幅', banner && !banner.hidden && /无法保存/.test(banner.textContent), banner && banner.textContent);
    }
  } else ok('[' + name + '] 阅读页有标记按钮', false);

  // renderMd 输出断言：富文本生成且无脚本注入面
  const htmlAll = all(env).map(e => e._html || '').join('');
  ok('[' + name + '] renderMd 生成富文本', /<(p|strong|ul|li|blockquote)\b/i.test(htmlAll), htmlAll.slice(0, 60));
  ok('[' + name + '] innerHTML 无脚本注入面', !/<script/i.test(htmlAll), '');

  // M1 回归：章首“上一节”跨章回退到上一章末节（旧 bug 跳回全课第一节）
  const ch1 = content.chapters[1];
  const firstOfCh1 = ch1.sections[0];
  const lastOfCh0 = ch0.sections[ch0.sections.length - 1];
  await fire(env, p('/read/' + firstOfCh1.id));
  const prevBtn = findButtons(env).filter(b => b.textContent.indexOf('上一节') >= 0)[0];
  ok('[' + name + '] 章首“上一节”可用', !!prevBtn && !prevBtn.disabled, prevBtn && prevBtn.disabled);
  if (prevBtn && !prevBtn.disabled) {
    (prevBtn._handlers['click'] || []).forEach(fn => fn());
    ok('[' + name + '] 章首上一节跨章回退正确', env.win.location.hash.indexOf(lastOfCh0.id) >= 0, env.win.location.hash);
  }

  // Bug1 回归：翻页不得新增“已读”键（只记位置）
  await fire(env, p('/read/' + sec0.id));
  const bb = env.registry.ids['bottombar'];
  const nextBtn = (bb.children || []).filter(function (k) { return /下一节/.test(k.textContent || ''); })[0];
  if (nextBtn) {
    let beforeKeys = [];
    try { beforeKeys = Object.keys((JSON.parse(env.store[KEY]) || {}).read || {}); } catch (e) {}
    (nextBtn._handlers['click'] || []).forEach(function (fn) { fn.call(nextBtn, { stopPropagation: function () {} }); });
    (env.win._handlers['hashchange'] || []).forEach(function (fn) { fn(); });
    let saved = null; try { saved = JSON.parse(env.store[KEY]); } catch (e) {}
    if (!opts.storageThrows) {
      const afterKeys = Object.keys((saved || {}).read || {});
      const added = afterKeys.filter(function (k) { return beforeKeys.indexOf(k) < 0; });
      ok('[' + name + '] 翻页不新增已读', added.length === 0, added);
      ok('[' + name + '] 翻页推进 lastSid', !!(saved && saved.lastSid && saved.lastSid !== sec0.id), saved && saved.lastSid);
    }
  } else ok('[' + name + '] 阅读页有下一节按钮', false);

  // 6) 自测
  if (ch0.quiz && ch0.quiz.length) {
    await fire(env, p('/quiz/' + ch0.id));
    ok('[' + name + '] 自测页含题干', textOf(env).indexOf(ch0.quiz[0].q) >= 0);
    const opts2 = findButtons(env).filter(b => b.textContent.trim().length > 2 && /^[A-H]/.test(b.textContent.trim()[0]));
    ok('[' + name + '] 自测页有选项', opts2.length >= 2, opts2.length);
    if (opts2.length) {
      (opts2[0]._handlers['click'] || []).forEach(fn => fn());
      ok('[' + name + '] 作答后有解析', /回答正确|回答错误/.test(textOf(env)));
      ok('[' + name + '] 作答后题目不重复', (textOf(env).split(ch0.quiz[0].q).length - 1) === 1);
    }
    // L7 回归：整卷交卷后再进应全新开卷，而非停在最后一题已作答态
    let guard = 0;
    while (guard++ < ch0.quiz.length + 6) {
      if (/自测成绩/.test(textOf(env))) break;
      const pick = findButtons(env).filter(b => (' ' + b.className + ' ').indexOf(' opt ') >= 0 && !b.disabled)[0];
      if (pick) (pick._handlers['click'] || []).forEach(fn => fn());
      const nb = findButtons(env).filter(b => /下一题|查看成绩/.test(b.textContent))[0];
      if (!nb || nb.disabled) break;
      (nb._handlers['click'] || []).forEach(fn => fn());
    }
    ok('[' + name + '] 自测可整卷完成', /正确率|掌握得不错|继续加油|建议回去再读一遍/.test(textOf(env)), textOf(env).slice(0, 40));
    await fire(env, p('/quiz/' + ch0.id));
    const reText = textOf(env);
    ok('[' + name + '] 交卷后重进为全新开卷', /第\s*1\s*\/\s*\d+/.test(reText) && !/回答正确|回答错误/.test(reText), reText.slice(0, 60));
  }

  // 7) 刷题
  await fire(env, p('/drill'));
  ok('[' + name + '] 刷题首页', /按章节刷题/.test(textOf(env)) && /随机刷题/.test(textOf(env)));
  await fire(env, p('/drill/ch/' + ch0.id));
  ok('[' + name + '] 章节刷题设置页', /本章题库/.test(textOf(env)));
  const startChip = findButtons(env).filter(b => /题$|全部（/.test(b.textContent.trim()))[0];
  if (startChip) {
    (startChip._handlers['click'] || []).forEach(fn => fn());
    await fire(env, p('/drill/run'));
    const runText = textOf(env);
    ok('[' + name + '] 刷题会话渲染', /答题进度|连对/.test(runText), runText.slice(0, 50));
    const q0 = PROD_BANK.questions.filter(q => runText.indexOf(q.stem) >= 0)[0];
    ok('[' + name + '] 会话题干来自题库', !!q0, q0 && q0.id);
    const dopts = findButtons(env).filter(b => (' ' + b.className + ' ').indexOf(' opt ') >= 0);
    ok('[' + name + '] 会话有选项', dopts.length >= 2, dopts.length);
    if (q0 && dopts.length) {
      (dopts[0]._handlers['click'] || []).forEach(fn => fn());
      const t2 = textOf(env);
      ok('[' + name + '] 刷题作答有反馈', /回答正确|回答错误/.test(t2));
      ok('[' + name + '] 刷题作答后不重复', (t2.split(q0.stem).length - 1) === 1, t2.split(q0.stem).length - 1);
      if (!opts.storageThrows) {
        let ds = null; try { ds = JSON.parse(env.store[DRILL_KEY]); } catch (e) {}
        ok('[' + name + '] 刷题记录落盘', !!(ds && ds.qstats && ds.qstats[q0.id]), ds && Object.keys(ds.qstats || {}).length);
      }
    }
  } else ok('[' + name + '] 有题量按钮', false);

  await fire(env, p('/drill/random'));
  ok('[' + name + '] 随机刷题设置页', /题量/.test(textOf(env)) && /范围/.test(textOf(env)));
  await fire(env, p('/drill/wrong'));
  ok('[' + name + '] 错题本渲染', /错题/.test(textOf(env)));

  // 8) 我的
  await fire(env, p('/me'));
  ok('[' + name + '] 我的页含进度', /已学小节/.test(textOf(env)));
  ok('[' + name + '] 我的页含切换课程', /切换课程/.test(textOf(env)));

  // 清理已掌握回归：清空 read，但保留 lastSid 与 quiz
  await fire(env, p('/me'));
  const cleanBtn = findButtons(env).filter(function (b) { return /清理全部已掌握/.test(b.textContent || ''); })[0];
  if (cleanBtn && !opts.storageThrows) {
    let pre = null; try { pre = JSON.parse(env.store[KEY]); } catch (e) {}
    const preLast = (pre || {}).lastSid;
    const preQuiz = JSON.stringify((pre || {}).quiz || {});
    env.win.confirm = function () { return true; };
    (cleanBtn._handlers['click'] || []).forEach(function (fn) { fn.call(cleanBtn); });
    let post = null; try { post = JSON.parse(env.store[KEY]); } catch (e) {}
    ok('[' + name + '] 清理已掌握：read 清空', !!(post && Object.keys(post.read || {}).length === 0), post && Object.keys(post.read || {}));
    ok('[' + name + '] 清理已掌握：保留 lastSid', !!(post && post.lastSid === preLast), post && post.lastSid);
    ok('[' + name + '] 清理已掌握：保留自测成绩', !!((post && JSON.stringify(post.quiz || {}) === preQuiz)), '');
    // 回归关键：必须写入删除墓碑，否则服务端“取并集”会把旧标记合并回来（线上真实 bug）
    ok('[' + name + '] 清理已掌握：写入 readClearedAt 墓碑', !!(post && Number(post.readClearedAt) > 0), post && post.readClearedAt);
    ok('[' + name + '] 清理已掌握：不动 wipedAt', !!(post && Number(post.wipedAt || 0) === 0), post && post.wipedAt);
  } else if (!cleanBtn) ok('[' + name + '] 我的页有清理按钮', false);

  // 9) 双课程隔离
  await fire(env, '#/c/' + FIX + '/');
  ok('[' + name + '] B 课程目录', /测试课程B/.test(textOf(env)));
  await fire(env, '#/c/' + FIX + '/read/b1-s1');
  const markB = findButtons(env).filter(b => /标记已学会|已学会/.test(b.textContent))[0];
  if (markB) {
    (markB._handlers['click'] || []).forEach(fn => fn());
    if (!opts.storageThrows) {
      let sb = null; try { sb = JSON.parse(env.store[FIX_KEY]); } catch (e) {}
      ok('[' + name + '] B 课程已读落盘', !!(sb && sb.read && sb.read['b1-s1']), sb && Object.keys(sb.read || {}));
      let sa = null; try { sa = JSON.parse(env.store[KEY]); } catch (e) {}
      ok('[' + name + '] A/B 进度互不串味', !sa || !sa.read || !sa.read['b1-s1'], sa && Object.keys(sa.read || {}));
    }
  } else ok('[' + name + '] B 阅读页有标记按钮', false);

  // 10) 回大厅显示进度
  await fire(env, '#/');
  const hall2 = textOf(env);
  if (!opts.storageThrows) {
    ok('[' + name + '] 大厅回显进度', /已学/.test(hall2), hall2.slice(0, 80));
    ok('[' + name + '] B 课程进度 25%', /25%/.test(hall2), hall2.match(/25%|1%/g));
  }
}

/* ---------- 旧数据迁移场景 ---------- */
async function migrationScenario() {
  const env = await boot({ legacySeed: {
    progress: { version: 1, contentVersion: '', read: { 'ch1-s1': 123 }, quiz: {}, lastSid: 'ch1-s1', settings: { theme: 'dark', fontScale: 1.15 }, updatedAt: 1 },
    drill: { version: 1, qstats: { 'q-ch1-001': { r: 1, w: 0 } }, wrong: {}, history: [], updatedAt: 1 }
  } });
  await fire(env, '#/c/' + C + '/');
  let saved = null; try { saved = JSON.parse(env.store[KEY]); } catch (e) {}
  ok('[迁移] 旧阅读进度已复制', !!(saved && saved.read && saved.read['ch1-s1']), saved && Object.keys(saved.read || {}));
  let dd = null; try { dd = JSON.parse(env.store[DRILL_KEY]); } catch (e) {}
  ok('[迁移] 旧刷题记录已复制', !!(dd && dd.qstats && dd.qstats['q-ch1-001']), dd && Object.keys(dd.qstats || {}));
  ok('[迁移] 旧键保留可回滚', !!env.store[LEGACY_KEY] && !!env.store[LEGACY_DRILL_KEY]);
  let st = null; try { st = JSON.parse(env.store[SETTINGS_KEY]); } catch (e) {}
  ok('[迁移] 阅读设置已拆分保存', !!(st && st.theme === 'dark'), st);
  const sec0 = PROD_CONTENT.chapters[0].sections[0];
  await fire(env, '#/c/' + C + '/read/' + sec0.id);
  ok('[迁移] 迁移后的进度可继续标记', textOf(env).indexOf(sec0.title) >= 0, '');
  // 幂等：再次进入不会覆盖已有新键
  await fire(env, '#/');
  await fire(env, '#/c/' + C + '/');
  let saved2 = null; try { saved2 = JSON.parse(env.store[KEY]); } catch (e) {}
  ok('[迁移] 迁移幂等不重复覆盖', !!(saved2 && saved2.read && saved2.read['ch1-s1']));
}

/* ---------- 跑矩阵 ---------- */
async function loginWallScenario() {
  let env;
  try { env = await boot({ protocol: 'file:', loggedOut: true }); }
  catch (e) { ok('[登录墙] boot 不抛异常', false, String(e && e.stack || e)); return; }
  await fire(env, '#/');
  const t1 = textOf(env);
  ok('[登录墙] 未登录访问大厅被拦截', /请输入用户名和密码|登录/.test(t1) && t1.indexOf('我的课程') < 0, t1.slice(0, 40));
  ok('[登录墙] 未登录不显示底部导航', env.registry.ids['tabbar'].hidden === true, env.registry.ids['tabbar'].hidden);
  await fire(env, '#/c/' + C + '/');
  ok('[登录墙] 未登录直接访问课程也被拦截', textOf(env).indexOf('刑法总论') < 0 || /登录/.test(textOf(env)), textOf(env).slice(0, 40));
  await fire(env, '#/c/' + C + '/read/ch1-s1');
  ok('[登录墙] 未登录访问阅读页被拦截', /登录/.test(textOf(env)) && !/一句话搞懂/.test(textOf(env)), textOf(env).slice(0, 40));
  ok('[登录墙] 提供用户名/密码输入框', env.doc.querySelectorAll('input').length >= 2, env.doc.querySelectorAll('input').length);
}

/* 法条正文（Bug2）：两门课的法条须覆盖节尾全部引用，且卡片渲染不出现缺失占位 */
function articlesScenario() {
  const CASES = [
    { id: 'constitutional-law', name: '宪法学', want: 58, sections: 60 },
    { id: 'criminal-law-general', name: '刑法总论', want: 92, sections: 71 }
  ];
  const grab = (s, name) => {
    const st = s.indexOf('function ' + name + '(');
    const ob = s.indexOf('{', st);
    let d = 0;
    for (let p = ob; p < s.length; p++) {
      if (s[p] === '{') d++;
      else if (s[p] === '}') { d--; if (!d) return s.slice(st, p + 1); }
    }
    throw new Error('未找到函数结束: ' + name);
  };
  const walk = (x, out) => { out = out || []; if (!x) return out; out.push(x); (x.children || []).forEach(c => walk(c, out)); return out; };
  const pick = (root, cls) => walk(root).filter(e => typeof e.className === 'string' && e.className.split(/\s+/).indexOf(cls) >= 0);
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  for (const cfg of CASES) {
  const cp = path.join(ROOT, 'courses', cfg.id, 'course.js');
  const src = fs.readFileSync(cp, 'utf8');
  const pack = JSON.parse(src.slice(src.indexOf('= {') + 1).trim().replace(/;$/, ''));
  const arts = pack.articles || {};
  const n = Object.keys(arts).length;
  ok('[法条] ' + cfg.name + ' 收条 ' + cfg.want + ' 条', n === cfg.want, n);

  // 1) 键必须落在 content.json 的法条标签全集内
  const labels = new Set();
  for (const ch of pack.content.chapters || [])
    for (const s of ch.sections || [])
      for (const t of s.articles || []) labels.add(t);
  const extra = Object.keys(arts).filter(k => !labels.has(k));
  ok('[法条] ' + cfg.name + ' 无多余键', extra.length === 0, extra.slice(0, 3));

  // 2) 每处节尾引用都有正文，且正文非空
  let cited = 0, covered = 0, empty = 0;
  for (const ch of pack.content.chapters || [])
    for (const s of ch.sections || [])
      for (const t of s.articles || []) { cited++; if (arts[t]) { covered++; if (!String(arts[t]).trim()) empty++; } }
  ok('[法条] ' + cfg.name + ' 覆盖率 100%', cited > 0 && covered === cited, { cited, covered });
  ok('[法条] ' + cfg.name + ' 无空正文', empty === 0, empty);

  // 3) 渲染：抽取 h + renderLawSection 实跑，卡片无缺失占位
  const ARTICLES = arts;
  const render = eval('(function(){"use strict";' + grab(appSrc, 'h') + '\n' + grab(appSrc, 'renderLawSection') + ';return renderLawSection;})()');

  let sections = 0, cards = 0, missing = 0;
  let citedSections = 0;
  for (const ch of pack.content.chapters || [])
    for (const s of ch.sections || []) {
      if ((s.articles || []).length) citedSections++;
      const r = render(s.articles || []);
      if (pick(r, 'lawsec').length) sections++;
      cards += pick(r, 'lawcard').length;
      missing += pick(r, 'lawmissing').length;
    }
  ok('[法条] ' + cfg.name + ' 有引用的节均渲染区块', sections === citedSections, { sections, citedSections });
  ok('[法条] ' + cfg.name + ' 卡片数 = 引用处数', cards === cited, { cards, cited });
  ok('[法条] ' + cfg.name + ' 无缺失占位', missing === 0, missing);
  }

  // 4) 降级：全部正文缺失时退回标签，不显示“暂未收录”
  const noData = eval('(function(){"use strict";var ARTICLES={};' + grab(appSrc, 'h') + '\n' + grab(appSrc, 'renderLawSection') + ';return renderLawSection;})()');
  const d = noData(['《宪法》第五条']);
  ok('[法条] 无数据时退回标签样式', pick(d, 'lawsec').length === 0 && pick(d, 'lawmissing').length === 0, pick(d, 'lawcard').length);
}

/* 正文排版：宪法用「先建直觉：…」内联标签，必须拆成小标题+段落，
 * 否则标题与正文粘成一段（线上真实反馈）。刑法用 `###`，不得被此改动影响。 */
function typographyScenario() {
  const grab = (src, name) => {
    const st = src.indexOf('function ' + name + '(');
    if (st < 0) throw new Error('未找到函数 ' + name);
    const ob = src.indexOf('{', st);
    let d = 0;
    for (let p = ob; p < src.length; p++) {
      if (src[p] === '{') d++;
      else if (src[p] === '}') { d--; if (!d) return src.slice(st, p + 1); }
    }
    throw new Error('未找到函数结束: ' + name);
  };
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const pre = appSrc.slice(appSrc.indexOf('var BODY_LABELS'), appSrc.indexOf('function matchBodyLabel'));
  const R = eval('(function(){' + pre + '\n' + grab(appSrc, 'esc') + '\n' + grab(appSrc, 'matchBodyLabel') + '\n' + grab(appSrc, 'renderMd') + ';return renderMd;})()');
  const LAB = '(?:对比一下|先建直觉|再上定义|一条关系线|术语先解释|术语解释|生活例子|对比)';
  const read = id => JSON.parse(fs.readFileSync(path.join(ROOT, 'courses', id, 'content.json'), 'utf8'));

  // 1) 宪法：每节 6 个小标题，段落不得再以标签开头
  const cl = read('constitutional-law');
  let secs = 0, h4 = 0, bad = [];
  for (const ch of cl.chapters) for (const s of ch.sections) {
    const html = R(s.body, { labels: true });
    const n = (html.match(/<h4>/g) || []).length;
    secs++; h4 += n;
    if (n !== 6 || new RegExp('<p>' + LAB + '[：:]').test(html)) bad.push(s.id);
  }
  ok('[排版] 宪法 60 节每节 6 个小标题', secs === 60 && bad.length === 0, { secs, bad: bad.slice(0, 4) });
  ok('[排版] 宪法小标题总数 360', h4 === 360, h4);
  ok('[排版] 宪法段落不与标签粘连', !new RegExp('<p>' + LAB + '[：:]').test(R(cl.chapters[0].sections[0].body, { labels: true })));

  // 2) 刑法：与原渲染逐字节一致，h4 数等于源码 `###` 数
  const sl = read('criminal-law-general');
  let diff = 0, hn = 0, srcH = 0;
  for (const ch of sl.chapters) for (const s of ch.sections) {
    if (R(s.body) !== R(s.body, { labels: true })) diff++;
    hn += (R(s.body).match(/<h4>/g) || []).length;
    srcH += (String(s.body).match(/^### /gm) || []).length;
  }
  ok('[排版] 刑法渲染不受影响', diff === 0, diff);
  ok('[排版] 刑法 h4 数 = 源码 ### 数', hn === srcH && hn > 0, { hn, srcH });

  // 3) 未启用标签时（题干/解析路径）行为不变 + 转义 + 列表
  const lab = '对比：甲乙之间的对比说明。';
  ok('[排版] 未启用标签时保持原样', R(lab) === '<p>对比：甲乙之间的对比说明。</p>', R(lab));
  ok('[排版] 启用标签后拆为标题+段落', R(lab, { labels: true }) === '<h4>对比</h4><p>甲乙之间的对比说明。</p>', R(lab, { labels: true }));
  ok('[排版] 启用标签仍走转义', !R('<img src=x onerror=alert(1)>', { labels: true }).includes('<img'));
  ok('[排版] 不吞列表', R('- 要点一', { labels: true }).includes('<li>要点一</li>'));
}

(async function main() {
  console.log('== law-study 多课程冒烟 ==');
  await scenario('file:', { protocol: 'file:' });
  await scenario('https+fetch成功', {
    protocol: 'https:',
    fetch: function (url) {
      const k = String(url).split('?')[0];
      if (!FILES[k]) return Promise.reject(new Error('404 ' + k));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FILES[k]) });
    }
  });
  await scenario('https+fetch失败', { protocol: 'https:', fetch: function () { return Promise.reject(new Error('net')); } });
  await scenario('存储禁用', { protocol: 'file:', storageThrows: true });
  // 镜像加载分支：不预置 __COURSES__，强制走真实 course.js 脚本注入（L8 冒烟盲区）
  await scenario('镜像加载', { protocol: 'file:', noPreload: true });
  // M3 回归：单键坏 JSON 不再禁用本会话保存
  await scenario('坏键容错', { protocol: 'file:', corruptKey: true });
  try { await migrationScenario(); } catch (e) { ok('[迁移] 场景不抛异常', false, String(e && e.stack || e)); }
  try { await loginWallScenario(); } catch (e) { ok('[登录墙] 场景不抛异常', false, String(e && e.stack || e)); }
  try { articlesScenario(); } catch (e) { ok('[法条] 场景不抛异常', false, String(e && e.stack || e)); }
  try { typographyScenario(); } catch (e) { ok('[排版] 场景不抛异常', false, String(e && e.stack || e)); }
  console.log('检查项: ' + (pass + fail) + '  通过: ' + pass + '  失败: ' + fail);
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f.name + (f.extra !== undefined ? '  → ' + JSON.stringify(f.extra) : ''))); process.exitCode = 1; }
  else console.log('  全部通过 ✓');
})();
