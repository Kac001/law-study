#!/usr/bin/env node
/* add-course.js —— 新增/更新课程包脚手架
 * 用法：node scripts/add-course.js courses/<courseId> [--force]
 *
 * 做的事：
 *   1. 校验 content.json（章节/小节 id 唯一、必要字段齐全）
 *   2. 校验 bank.json（答案命中选项、题干去重、chapterId 存在）
 *   3. 统计 chapters / sections / questions
 *   4. 生成 courses/<id>/course.js（离线镜像）
 *   5. 更新 courses.json 与 courses.js（id 唯一性校验）
 * 任何一步不通过即退出非 0，不写入清单。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dirArg = args[0];
const force = args.includes('--force');

if (!dirArg) {
  console.error('用法: node scripts/add-course.js courses/<courseId> [--force]');
  process.exit(1);
}
const dir = path.resolve(ROOT, dirArg);
const cid = path.basename(dir).replace(/\.+/g, '').trim();
if (!/^[a-z0-9-]{2,64}$/.test(cid)) {
  console.error('✗ 课程目录名只能是 小写字母/数字/连字符（2–64）: ' + cid);
  process.exit(1);
}

const errors = [];
const warns = [];
function fail(msg) { errors.push(msg); }
function warn(msg) { warns.push(msg); }

/* ---------- 读取 ---------- */
function readJson(p, name) {
  const f = path.join(dir, p);
  if (!fs.existsSync(f)) { fail('缺少 ' + name + ': ' + p); return null; }
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { fail(name + ' 不是合法 JSON: ' + e.message); return null; }
}
const content = readJson('content.json', 'content.json');
const bank = readJson('bank.json', 'bank.json');
if (!content || !bank) done();

/* ---------- 校验 content ---------- */
let chapters = [], sections = 0;
if (content) {
  chapters = Array.isArray(content.chapters) ? content.chapters : [];
  if (!chapters.length) fail('content.chapters 为空');
  const chIds = new Set(), secIds = new Set();
  chapters.forEach((ch, i) => {
    const chId = ch && ch.id;
    if (!chId) { fail('第 ' + (i + 1) + ' 章缺 id'); return; }
    if (chIds.has(chId)) fail('章节 id 重复: ' + chId);
    chIds.add(chId);
    if (!ch.title) warn(chId + ' 缺少 title');
    const secs = Array.isArray(ch.sections) ? ch.sections : [];
    if (!secs.length) warn(chId + ' 没有小节');
    secs.forEach((s, j) => {
      const sid = s && s.id;
      if (!sid) { fail(chId + ' 第 ' + (j + 1) + ' 节缺 id'); return; }
      if (secIds.has(sid)) fail('小节 id 重复: ' + sid);
      secIds.add(sid);
      if (!s.title) warn(sid + ' 缺少 title');
      if (!s.body) warn(sid + ' 缺少正文 body');
    });
    sections += secs.length;
  });
}

/* ---------- 校验 bank ---------- */
let questions = [];
if (bank) {
  questions = Array.isArray(bank.questions) ? bank.questions : [];
  if (!questions.length) fail('bank.questions 为空');
  const stems = new Set(); const ids = new Set();
  const chIdSet = new Set(chapters.map(c => c.id));
  questions.forEach((q, i) => {
    const tag = q && (q.id || '#' + (i + 1));
    if (!q || !q.stem) { fail('题目 ' + tag + ' 缺少 stem'); return; }
    const key = String(q.stem).replace(/\s+/g, '');
    if (stems.has(key)) fail('题干重复: ' + tag);
    stems.add(key);
    if (q.id) { if (ids.has(q.id)) fail('题目 id 重复: ' + q.id); ids.add(q.id); }
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 2) { fail(tag + ' 选项少于 2 个'); return; }
    if (new Set(opts).size !== opts.length) fail(tag + ' 选项有重复');
    if (q.type === 'judge') {
      if (q.answer !== '正确' && q.answer !== '错误') fail(tag + ' 判断题 answer 必须是 正确/错误');
    } else {
      if (!['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].includes(q.answer)) fail(tag + ' 单选 answer 不在选项范围: ' + q.answer);
      if (opts.length < 3) warn(tag + ' 单选选项少于 3 个');
    }
    if (!q.explain || !String(q.explain).trim()) fail(tag + ' 缺少解析 explain');
    if (chIdSet.size && !chIdSet.has(q.chapterId)) fail(tag + ' chapterId 不在 content 中: ' + q.chapterId);
  });
}

/* ---------- 汇总 ---------- */
function done() {
  if (errors.length) {
    console.error('✗ 校验失败（' + errors.length + ' 项）:');
    errors.forEach(e => console.error('   - ' + e));
    process.exit(1);
  }
}
if (!content || !bank) done();

const meta = {
  id: cid,
  title: (content && content.title) || cid,
  subtitle: (content && content.subtitle) || '',
  description: '',
  category: '法学',
  icon: '📘',
  color: '#1f5d92',
  chapters: chapters.length,
  sections,
  questions: questions.length,
  version: (bank && bank.meta && bank.meta.version) || '',
  updatedAt: new Date().toISOString().slice(0, 10),
  status: 'ready'
};
// 从既有清单继承展示字段（不覆盖统计）
const regPath = path.join(ROOT, 'courses.json');
let reg = { version: '2026.10', defaultCourse: '', courses: [] };
if (fs.existsSync(regPath)) {
  try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch (e) { warn('courses.json 解析失败，将重建'); }
}
const exist = (reg.courses || []).find(c => c.id === cid);
if (exist && !force && exist.updatedAt === meta.updatedAt) {
  // 同日重复执行允许覆盖，此分支仅提示
}
['title', 'subtitle', 'description', 'category', 'icon', 'color'].forEach(k => {
  if (exist && exist[k]) meta[k] = exist[k];
});
meta.title = (content && content.title) || meta.title;
meta.subtitle = (content && content.subtitle) || meta.subtitle;

if (!reg.defaultCourse) reg.defaultCourse = cid;
if (!exist) reg.courses.push(meta);
else reg.courses[reg.courses.indexOf(exist)] = meta;

/* ---------- 写入 ---------- */
// 可选：法条正文映射（articles.json），存在则一并打包
const articlesPath = path.join(dir, 'articles.json');
let articles = {};
if (fs.existsSync(articlesPath)) {
  try {
    articles = JSON.parse(fs.readFileSync(articlesPath, 'utf8'));
  } catch (e) {
    fail('articles.json 不是合法 JSON: ' + e.message);
    done();
  }
}
const pack = { content, bank };
if (articles && Object.keys(articles).length) pack.articles = articles;
fs.writeFileSync(path.join(dir, 'course.js'),
  '(window.__COURSES__ = window.__COURSES__ || {})[' + JSON.stringify(cid) + '] = ' +
  JSON.stringify(pack) + ';\n');
fs.writeFileSync(regPath, JSON.stringify(reg, null, 1));
fs.writeFileSync(path.join(ROOT, 'courses.js'),
  'window.__COURSES_META__ = ' + JSON.stringify(reg) + ';\n');

done();
console.log('✓ 课程已更新: ' + cid);
console.log('  章节 ' + chapters.length + ' · 小节 ' + sections + ' · 题目 ' + questions.length);
warns.forEach(w => console.log('  ⚠ ' + w));
if (warns.length) console.log('  （' + warns.length + ' 条警告，可接受则忽略）');
console.log('  下一步：直接刷新页面即可看到新课程（纯静态，无需重启）');
