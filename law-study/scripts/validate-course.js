#!/usr/bin/env node
/* validate-course.js —— 课程包完整性校验（接入前把关）
 * 用法：node scripts/validate-course.js <content.json> <bank.json>
 *
 * 校验项（任一 fail 即退出非 0）：
 *   1  两个文件可解析
 *   2  章节数、小节数非空
 *   3  章节 id / 小节 id 全局唯一
 *   4  小节必要字段（title/plain/body）
 *   5  每节题数 3–5
 *   6  sectionId 属于对应 chapterId
 *   7  题目 id / 题干唯一
 *   8  答案落在 options 范围内
 *   9  judge 题 options 恒为 [正确, 错误]
 *  10  解析非空
 *  11  无多选题
 *  12  难度取值 1/2/3
 *  13  章内自测答案合法
 *  14  难度分布与题库/自测统计报告
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MIN_PER_SECTION = 3;
const MAX_PER_SECTION = 5;

let fails = 0;
const warnings = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); }
  else { fails++; console.log('  ✗ ' + label + (detail ? '  → ' + detail : '')); }
}
function warn(msg) { warnings.push(msg); }
function norm(s) { return String(s || '').replace(/[\s，。、；：？！“”‘’（）()\-—…·,.!?;:]/g, ''); }

const [contentPath, bankPath] = process.argv.slice(2);
if (!contentPath || !bankPath) {
  console.error('用法: node scripts/validate-course.js <content.json> <bank.json>');
  process.exit(2);
}

function readJson(p, name) {
  try {
    if (!fs.existsSync(p)) { console.log('✗ 缺少 ' + name + ': ' + p); process.exit(1); }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.log('✗ ' + name + ' 不是合法 JSON: ' + e.message);
    process.exit(1);
  }
}

const content = readJson(path.resolve(contentPath), 'content.json');
const bank = readJson(path.resolve(bankPath), 'bank.json');

console.log('\n=== 结构 ===');
const chapters = Array.isArray(content.chapters) ? content.chapters : [];
const questions = Array.isArray(bank.questions) ? bank.questions : [];
let sectionCount = 0;
chapters.forEach(ch => { sectionCount += (ch.sections || []).length; });
console.log(`  章节 ${chapters.length} · 小节 ${sectionCount} · 题库 ${questions.length} · 章内自测 ${chapters.reduce((n, ch) => n + (ch.quiz || []).length, 0)}`);
ok('章节非空', chapters.length > 0);
ok('题库非空', questions.length > 0);

console.log('\n=== id 唯一性 ===');
const chIds = new Set(), secIds = new Set(), dupCh = [], dupSec = [];
chapters.forEach(ch => {
  if (!ch.id) { ok('章节缺 id: ' + ch.title, false); return; }
  if (chIds.has(ch.id)) dupCh.push(ch.id); else chIds.add(ch.id);
  (ch.sections || []).forEach(s => {
    if (!s.id) { ok('小节缺 id: ' + ch.id, false); return; }
    if (secIds.has(s.id)) dupSec.push(s.id); else secIds.add(s.id);
  });
});
ok('章节 id 唯一', dupCh.length === 0, dupCh.join(','));
ok('小节 id 唯一', dupSec.length === 0, dupSec.join(','));

console.log('\n=== 小节字段 ===');
const missing = [];
chapters.forEach(ch => (ch.sections || []).forEach(s => {
  const lack = ['title', 'plain', 'body'].filter(k => !String(s[k] || '').trim());
  if (lack.length) missing.push(s.id + ' 缺 ' + lack.join('/'));
}));
ok('小节必要字段齐全', missing.length === 0, missing.slice(0, 5).join(' | '));

console.log('\n=== 题库覆盖与题型 ===');
const byChapter = {}, bySection = {};
questions.forEach(q => {
  byChapter[q.chapterId] = (byChapter[q.chapterId] || 0) + 1;
  if (q.sectionId) bySection[q.sectionId] = (bySection[q.sectionId] || 0) + 1;
});
const secOwner = {};
chapters.forEach(ch => (ch.sections || []).forEach(s => { secOwner[s.id] = ch.id; }));

const badOwner = questions.filter(q => q.sectionId && secOwner[q.sectionId] !== q.chapterId).map(q => q.id);
ok('sectionId 归属正确', badOwner.length === 0, badOwner.slice(0, 5).join(','));

const lowCover = [], highCover = [], noSection = [];
Object.keys(secOwner).forEach(sid => {
  const n = bySection[sid] || 0;
  if (n < MIN_PER_SECTION) lowCover.push(sid + '(' + n + ')');
  if (n > MAX_PER_SECTION) highCover.push(sid + '(' + n + ')');
});
questions.forEach(q => { if (!q.sectionId) noSection.push(q.id); });
ok(`每节题数 ≥${MIN_PER_SECTION}`, lowCover.length === 0, lowCover.slice(0, 6).join(','));
ok(`每节题数 ≤${MAX_PER_SECTION}`, highCover.length === 0, highCover.slice(0, 6).join(','));
ok('每题都有 sectionId', noSection.length === 0, noSection.slice(0, 5).join(','));

const multi = questions.filter(q => q.type !== 'single' && q.type !== 'judge');
ok('无多选题', multi.length === 0, multi.map(q => q.id + ':' + q.type).slice(0, 5).join(','));

console.log('\n=== 题目内容 ===');
const qIds = new Set(), dupIds = [], dupStems = [], seenStem = new Set();
const badAnswer = [], badJudgeOpts = [], noExplain = [], badDiff = [];
questions.forEach(q => {
  if (!q.id) { badAnswer.push('缺 id'); return; }
  if (qIds.has(q.id)) dupIds.push(q.id); else qIds.add(q.id);

  const key = norm(q.stem);
  if (seenStem.has(key)) dupStems.push(q.id); else seenStem.add(key);

  const opts = Array.isArray(q.options) ? q.options : [];
  if (q.type === 'judge') {
    if (opts.length !== 2 || opts[0] !== '正确' || opts[1] !== '错误') badJudgeOpts.push(q.id);
    if (q.answer !== '正确' && q.answer !== '错误') badAnswer.push(q.id);
  } else if (q.type === 'single') {
    const idx = 'ABCDEFGH'.indexOf(q.answer);
    if (idx < 0 || idx >= opts.length) badAnswer.push(q.id + '(' + q.answer + ')');
  }
  if (!String(q.explain || '').trim()) noExplain.push(q.id);
  if (![1, 2, 3].includes(Number(q.difficulty))) badDiff.push(q.id + '(' + q.difficulty + ')');
});

ok('题目 id 唯一', dupIds.length === 0, dupIds.slice(0, 5).join(','));
ok('题干无重复', dupStems.length === 0, dupStems.slice(0, 5).join(','));
ok('答案合法', badAnswer.length === 0, badAnswer.slice(0, 5).join(','));
ok('判断题选项格式正确', badJudgeOpts.length === 0, badJudgeOpts.slice(0, 5).join(','));
ok('解析非空', noExplain.length === 0, noExplain.slice(0, 5).join(','));
ok('难度取值合法', badDiff.length === 0, badDiff.slice(0, 5).join(','));

console.log('\n=== 章内自测 ===');
const quizBad = [];
chapters.forEach(ch => (ch.quiz || []).forEach((q, i) => {
  const tag = ch.id + '#' + (i + 1);
  const opts = Array.isArray(q.options) ? q.options : [];
  if (q.type === 'judge') {
    if (opts.length !== 2 || q.answer !== '正确' && q.answer !== '错误') quizBad.push(tag);
  } else {
    const idx = 'ABCDEFGH'.indexOf(q.answer);
    if (idx < 0 || idx >= opts.length) quizBad.push(tag);
  }
  if (!String(q.explain || '').trim()) quizBad.push(tag + '无解析');
  if (!String(q.q || '').trim()) quizBad.push(tag + '无题干');
}));
ok('章内自测合法', quizBad.length === 0, quizBad.slice(0, 5).join(','));

console.log('\n=== 统计 ===');
const diff = { 1: 0, 2: 0, 3: 0 };
questions.forEach(q => { diff[Number(q.difficulty)] = (diff[Number(q.difficulty)] || 0) + 1; });
const total = questions.length || 1;
console.log(`  难度分布: ★1 ${diff[1]} (${(diff[1] / total * 100).toFixed(1)}%) · ★2 ${diff[2]} (${(diff[2] / total * 100).toFixed(1)}%) · ★3 ${diff[3]} (${(diff[3] / total * 100).toFixed(1)}%)`);
const typeCount = questions.reduce((m, q) => { m[q.type] = (m[q.type] || 0) + 1; return m; }, {});
console.log(`  题型: ${Object.entries(typeCount).map(([k, v]) => k + ' ' + v).join(' · ')}`);
console.log('  每章题数: ' + chapters.map(ch => ch.id + ':' + (byChapter[ch.id] || 0)).join(' '));

const target = { 1: 0.5, 2: 0.35, 3: 0.15 };
Object.keys(target).forEach(k => {
  const actual = (diff[k] || 0) / total;
  if (Math.abs(actual - target[k]) > 0.12) warn(`难度 ${k} 占比 ${(actual * 100).toFixed(0)}%，目标 ${(target[k] * 100)}%（±12%）`);
});
if (questions.length < 150) warn('题库偏少（<150 题）');

if (warnings.length) {
  console.log('\n=== 警告（不阻断）===');
  warnings.forEach(w => console.log('  ⚠ ' + w));
}

console.log('\n' + (fails === 0 ? '✓ 校验通过（' + (warnings.length ? warnings.length + ' 条警告' : '无警告') + '）' : '✗ 校验失败：' + fails + ' 项'));
process.exit(fails === 0 ? 0 : 1);
