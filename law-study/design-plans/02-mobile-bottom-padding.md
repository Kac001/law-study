# 修复移动端正文被底部两条栏遮挡

Written against: 无 git 仓库（静态文件，2026-10-22）

## Evidence chain

- **Surface**：`law-study/styles.css` 的移动端布局（≤899px），影响所有带底部操作条的路由：`#/c/:id/read/:sid`（标记已学会 / 上一节 / 下一节）、`#/c/:id/quiz/:quizId`（下一题 / 查看成绩）、`#/c/:id/drill/run`（下一题）、`#/c/:id/drill/result`（返回 / 再来一组）、`#/c/:id/drill/wrong`（开始刷错题）。
- **Problem**：移动端正文底部只预留 72px，而底部导航（56px）与底部操作条（约 62px）同时固定叠放，实际占用 118–124px。阅读页与答题页滚动到底时，最后一行正文/最后一个选项被操作条遮住约 50px。
- **Design evidence**：`law-study/DESIGN.md` Layout 节规定「固定元素必须留出安全区……两者叠放时正文底部内边距必须覆盖两者总高，避免内容被遮」。
- **Owner**：`styles.css:52`（`body` 的 `padding-bottom`），与 `:243-244`（`.bottombar` 固定偏移）、`:256`（`.tab` 最小高度）构成同一几何关系。
- **Scope and affected surfaces**：移动端全部路由；桌面端不受影响（`:292` 的 `body` 规则已将 `padding-bottom` 覆盖为 `0`）。
- **Uncertainty**：实际像素受系统字号缩放影响，故按「≥124px + 8px 呼吸」取值而非精确测量。

## Design decision

底部内边距必须由「页签高度 + 操作条高度」共同决定，而不是只按页签高度取值。把移动端 `body` 的底部内边距从 `72px` 提到 `132px`，覆盖 56px 页签 + 62px 操作条 + 8px 呼吸，并继续叠加 `env(safe-area-inset-bottom)`，使 iPhone 等有 Home Indicator 的机型也不会遮挡。

## Reuse

- 现有 `padding-bottom:calc(72px + env(safe-area-inset-bottom))`（`styles.css:52`）
- 现有安全区写法 `env(safe-area-inset-bottom)`（`:52`、`:244`、`:252`）
- 桌面端既有覆盖规则 `body{padding-bottom:0}`（`:292`）
- Exemplar：`.bottombar` 的 `bottom:calc(62px + env(safe-area-inset-bottom))` 已按「页签高度 + 安全区」计算，本次把同一算式用于正文预留

## Changes

1. `law-study/styles.css` — `body`（`:52`）
   - Change：
     ```css
     padding-bottom:calc(132px + env(safe-area-inset-bottom));
     ```
   - Preserve：`margin:0`、`background`、`font-size`、`line-height`、`overflow-x:hidden`、`-webkit-font-smoothing` 不变
   - Verify：阅读页滚动到底，最后一行文字完整可见，与操作条之间留有间距

2. `law-study/styles.css` — 桌面端 `body`（`:292`）
   - Change：无需改动，确认其中已有 `padding-bottom:0`
   - Preserve：桌面双栏布局与 `min-height:100vh`
   - Verify：1440×900 下无多余底部留白

## Scope

- **Inherit**：所有移动端路由（≤899px），包括无 `#bottombar` 的页面——多出的 60px 空白在视觉上可接受，且能避免「有无操作条」两种状态的跳动
- **Verify**：`#/`（课程大厅，无操作条）、`#/c/:id`（目录，无操作条）确认底部空白不过分
- **Exclude**：`.tab` 的 56px 高度、`.bottombar` 的 62px 偏移、桌面端布局、任何 JS 逻辑
- **替代方案（如需更精确）**：改为仅在存在 `#bottombar` 时增加内边距（`body:has(#bottombar:not([hidden])){padding-bottom:calc(132px + env(safe-area-inset-bottom))}`）。若采用此方案，须确认目标浏览器支持 `:has()`；当前实现按统一 132px 处理，避免兼容性分支

## Validation

- **Product**：在 390×844 与 375×667 两种视口下阅读到页面末尾，确认无遮挡
- **Interface**：`#/c/:id/read/:sid`（长正文）、`#/c/:id/quiz/:quizId`（选项 + 解析）、`#/c/:id/drill/result`（错题回顾列表）
- **System**：确认没有为单个页面写局部内边距，修正在 `body` 一处生效
- **Repository**：
  - `node --check app.js` → 通过（本计划不改 JS）
  - `node verification/smoke.js` → 236 项全部通过（冒烟不校验像素，但确认结构未受影响）

## Stop conditions

- 若产品方要求「无操作条的页面不得出现额外空白」，改为 `:has()` 方案，并先确认浏览器支持范围
- 若 132px 在 375×667 小屏上仍显不足（例如系统字号放大到 1.3×），按 `1.3 × 124 + 8` 复核

## Design documentation

- 验收通过后：在 `DESIGN.md` 的 Layout 节明确写出具体算式「正文预留 = 页签高度 + 操作条高度 + 8px」，替换现有定性表述。
