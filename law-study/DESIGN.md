---
version: alpha
name: 课程学习站点
description: 多课程学习应用：课程大厅、章节阅读、自测与刷题；移动优先，提供日间/护眼/夜间三套主题。
colors:
  brand: "#1f5d92"
  brand-ink: "#164a75"
  brand-soft: "#e8f1f9"
  accent: "#b4762a"
  accent-soft: "#fbf2e3"
  ok: "#2f8a52"
  ok-soft: "#e6f5ec"
  err: "#c0392b"
  err-soft: "#fdeceb"
  ink: "#1b1f24"
  ink-2: "#3d454e"
  muted: "#6b7480"
  line: "#e3e7ec"
  bg: "#f5f7fa"
  card: "#ffffff"
  card-2: "#fafbfc"
typography:
  sans:
    fontFamily: "PingFang SC"
    fontSize: 16px
    lineHeight: 1.75
rounded:
  base: 14px
  sm: 10px
---

## Overview

面向零基础学习者的多课程学习站点：课程大厅选课，进入课程后阅读章节、做章内自测与刷题。移动端为底部五页签，桌面端（≥900px）为左侧竖向导航加右侧阅读区。同一套语义 token 驱动日间、护眼、夜间三套主题。

## Colors

`brand` 同时承担两种角色，必须分开使用：作为**前景色**（正文链接、当前页签文字）时直接使用 `brand`；作为**填充面**（配反白文字的按钮、hero、选中态）时使用 `brand-fill` / `brand-fill-2` 与 `brand-fill-ink`，不把 `brand` 当背景。

`brand-fill` 是填充面主色，`brand-fill-2` 用于渐变终点与按下态，`brand-fill-ink` 是填充面上的文字色。三者必须成套使用；夜间主题下 `brand-fill-ink` 为浅色（`#8bc2ea`），因此填充面必须是深色（`#1b2a37`），不可反置。

`ink` 用于正文，`ink-2` 用于次级正文，`muted` 用于说明与元信息。`line` 只用于分隔线与描边，不作文本色。

语义反馈固定成对使用：`ok`/`ok-soft` 表示正确与已掌握，`err`/`err-soft` 表示错误，`accent`/`accent-soft` 表示需要注意的易混点。同一屏内只用一个强调色，不与 `brand` 争夺注意力。

## Themes

三套主题只覆盖语义 token，不新增选择器分支。换主题时所有组件应自动跟随，不得为某个主题单独写组件样式。

| Token | 日间 | 护眼 | 夜间 |
|---|---|---|---|
| brand | #1f5d92 | #8a5a2b | #5aa2d8 |
| brand-ink | #164a75 | #6f4720 | #8bc2ea |
| brand-fill | #1f5d92 | #8a5a2b | #1b2a37 |
| brand-fill-2 | #164a75 | #6f4720 | #24384a |
| brand-fill-ink | #ffffff | #ffffff | #8bc2ea |
| brand-soft | #e8f1f9 | #f3e8d8 | #1b2a37 |
| accent | #b4762a | #9a6a2a | #e0a458 |
| accent-soft | #fbf2e3 | #f6ecd9 | #2c2418 |
| ink | #1b1f24 | #33291d | #e7ecf1 |
| ink-2 | #3d454e | #4c4033 | #c3ccd6 |
| muted | #6b7480 | #7d6f5c | #8d99a6 |
| line | #e3e7ec | #e6dccb | #2b333c |
| bg | #f5f7fa | #f6efe1 | #12161b |
| card | #ffffff | #fffaf0 | #1a2027 |
| card-2 | #fafbfc | #fbf4e6 | #1f262e |

夜间主题的 `brand` 是**浅色前景**，因此不能再用作填充面；填充面必须使用 `brand-fill`（深色），文字用 `brand-fill-ink`（浅色）。实测对比度：夜间 7.68:1 / 6.32:1，日间 6.91:1，护眼 5.87:1。

## Typography

正文基准 16px / 行高 1.75，桌面端 16.5px。用户字号设置只改变根字号倍数（`--font-scale`），组件内一律用 `em`/`rem`，不写死 px。

层级最多四级：页面标题 1.28em、卡片标题 1.02–1.12em、正文 1em、元信息 0.76–0.86em。元信息不得小于 0.72em。

## Layout

移动优先单列；断点三档：≤430px 压紧页签标签、760–899px 放宽内容、≥900px 切双栏（220px 侧栏 + 最大 820px 阅读区）。

固定元素必须留出安全区：底部导航与底部操作条使用 `env(safe-area-inset-bottom)`。移动端正文底部预留按算式取值：`页签高度 + 操作条高度 + 8px`，当前为 `calc(132px + env(safe-area-inset-bottom))`；桌面端该值为 `0`。实测移动端内容末尾与操作条顶部留有 7px 间距，无遮挡。

触控目标不小于 44×44px；列表行最小高度 52px。

## Elevation & Depth

只有两级：`--shadow`（卡片）与无阴影（页面底色）。不新增第三级阴影，不使用发光效果。

## Shapes

卡片圆角 14px，内部元素 10px，胶囊与圆形（进度条、标签、选项字母）用全圆角。同一层级内不混用两种圆角。

## Do's and Don'ts

- Do 用 `[hidden]{display:none !important}`：作者样式里的 `display:flex` 会压过 `hidden` 属性，导致主题菜单与底部操作条无法隐藏。
- Do 在 `@supports not (color: var(--ink))` 兜底块中同步新增组件，否则旧内核下新模块会失去样式。
- Don't 在组件里写死颜色或圆角字面量，一律引用语义 token。
- Don't 把课程名等**数据**写进 CSS（如伪元素 `content`），课程名只由顶栏 `#topbar-title` 动态承载。
- Don't 为单个主题写组件级覆盖，主题差异只允许出现在 token 层。
