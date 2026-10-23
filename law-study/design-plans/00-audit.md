# UI 审计报告（law-study）

Written against: 无 git 仓库（静态文件，2026-10-22 版本）

## Design language

- **Audited surface**：`law-study/index.html` + `styles.css` + `app.js`（单页多课程学习应用）。覆盖路由：`#/`（课程大厅）、`#/c/:id`（目录）、`#/c/:id/ch/:chId`、`#/c/:id/read/:sid`、`#/c/:id/quiz/:quizId`、`#/c/:id/drill/*`、`#/c/:id/me`；状态：加载中、加载失败、空清单、存储不可用横幅。
- **Design sources**：`law-study/DESIGN.md`（本次依据现有实现新建，记录语义 token、三套主题、断点与固定元素规则）；`styles.css` 的 `:root` / `[data-theme="sepia"]` / `[data-theme="dark"]` 三组变量；`styles.css` 三个 `@media` 断点（900 / 760–899 / 430）。
- **Documented decisions**：`--brand` 系列为品牌色；三套主题只覆盖语义 token；移动端底部五页签、桌面端 ≥900px 双栏；正文 16px/1.75，桌面 16.5px；卡片圆角 14px、内部 10px；固定元素使用 `env(safe-area-inset-bottom)`；`[hidden]{display:none!important}` 为强制规则。
- **Governing owners and consumers**：`styles.css` 是唯一视觉所有者，`app.js` 只生成结构与类名，`index.html` 提供固定骨架（`#topbar`/`#tabbar`/`#bottombar`/`#thememenu`）。
- **Explicit exceptions**：None documented。

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 夜间主题把**前景色**当**填充面**用：hero、主按钮、选中态用白字压在 `--brand`/`--brand-ink` 上，对比度只有 2.77:1 与 1.91:1（浅色主题同组件为 6.91:1） | 契约：同一组件在三套主题下的可读性自相矛盾（浅色 6.91:1 vs 夜间 1.91–2.77:1）。运行时：`styles.css:111-113` `.hero{background:linear-gradient(140deg,var(--brand),var(--brand-ink));color:#fff}` 继承 `styles.css:33-35` 夜间 `--brand:#5aa2d8;--brand-ink:#8bc2ea`；同因还影响 `:234` `.btn.primary`、`:284` `.seg button[aria-pressed="true"]`、`:371` `.chip.on`。 | 引入 `--brand-fill` / `--brand-fill-ink` 语义对（日间 `#1f5d92`/`#fff`，护眼 `#8a5a2b`/`#fff`，夜间 `#1b2a37`/`#8bc2ea`），四处填充改用该对；`--brand`/`--brand-ink` 只保留前景用途 | `styles.css` token 层 + 4 个选择器 | 高 |
| 2 | 移动端正文被底部操作条遮挡：`body` 底部内边距只预留 72px，而页签 56px + 操作条 62px 叠放共占 118–124px | 契约：`DESIGN.md`「固定元素必须留出安全区，两者叠放时正文底部内边距必须覆盖两者总高」。运行时：`styles.css:52` `body{padding-bottom:calc(72px + env(safe-area-inset-bottom))}`；`:243-244` `.bottombar{position:fixed;bottom:calc(62px + env(...))}` 高约 62px；`:256` `.tab{min-height:56px}`。阅读页与自测页（有 `#bottombar`）最后一行会被压住约 52px。 | 将移动端 `body` 底部内边距提高到 `calc(132px + env(safe-area-inset-bottom))`（124px 实际占用 + 8px 呼吸） | `styles.css` `body`（仅移动端，桌面端 `body` 已被 `:292` 覆盖为 0） | 高 |
| 3 | 桌面侧栏标题硬编码课程名「刑法总论」，切到其他课程时与顶栏显示的课程名冲突 | 契约：同一屏内两处课程名必须一致（顶栏由 `app.js` 动态写入 `#topbar-title`，侧栏为静态 CSS 内容）。运行时：`styles.css:313-315` `.tabbar::before{content:"刑法总论"}` 无法被 JS 更新；`app.js` 中 `topbar-title` 仅 1 处赋值。 | 删除 `.tabbar::before` 的 `content` 声明（保留布局占位改由顶栏承担课程名），避免出现与当前课程不符的标题 | `styles.css:313-317` | 高 |

## Improve first

**Finding 1（夜间主题对比度）**。它是唯一影响「能不能看清」的问题，且同一根因覆盖 hero、主按钮、选中胶囊三类高频控件——修一次即同时消除四个选择器的可读性缺陷；其余两项是遮挡与文案错位，影响面更局部。

## 未纳入的候选（已按门槛剔除）

| 候选 | 剔除理由 |
|---|---|
| `.MCard`、`.rchk` 死选择器 | 属代码质量，非视觉呈现；`improve-ui` 明确排除 |
| 79 处十六进制字面量、`.pbar.ok` 硬编码 `#3fae6a` | token 漂移但无可观察的界面后果，属代码质量 |
| 5 个 z-index 层级（35/36/40/50/60）未成表 | 当前无堆叠冲突证据，仅「未成体系」不足以构成契约 |
| 桌面端 `#app` 底部 110px 内边距 | 桌面操作条高约 66px，110px 已足够，非缺陷 |
| 页签 emoji 图标 | 各平台渲染一致，无契约要求替换 |

## 说明

本审计**未修改任何产品源码**（`index.html`/`styles.css`/`app.js` 均未改动），仅在 `law-study/` 下新建了 `DESIGN.md` 与 `design-plans/`。三份实施计划见同目录 `01`–`03`，均为可直接交给执行者的自包含文档。
