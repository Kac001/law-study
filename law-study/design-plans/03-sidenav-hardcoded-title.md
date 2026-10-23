# 移除桌面侧栏硬编码的课程名

Written against: 无 git 仓库（静态文件，2026-10-22）

## Evidence chain

- **Surface**：`law-study/styles.css` 的桌面端侧栏（≥900px），影响所有课程内路由：`#/c/:id`、`#/c/:id/ch/:chId`、`#/c/:id/read/:sid`、`#/c/:id/quiz/:quizId`、`#/c/:id/drill/*`、`#/c/:id/me`。
- **Problem**：桌面侧栏顶部通过 CSS `content:"刑法总论"` 显示固定课程名，而顶栏标题由 `app.js` 按当前课程动态写入 `#topbar-title`。当用户进入其他课程（如未来新增的民法课程）时，侧栏仍显示「刑法总论」，与顶栏课程名直接矛盾。
- **Design evidence**：`law-study/DESIGN.md` Layout 节规定「桌面端为左侧竖向导航加右侧阅读区」，课程名由顶栏承担；`app.js` 中 `#topbar-title` 是课程名的唯一动态来源（`setTopbar()`）。
- **Owner**：`styles.css:313-317` 的 `.tabbar::before` 伪元素。
- **Scope and affected surfaces**：桌面端侧栏（仅 ≥900px 生效）；移动端底部页签不受影响（该规则在媒体查询内）。
- **Uncertainty**：无。当前生产环境只有一门课程，故该矛盾尚未在界面上暴露；一旦新增第二门课即会出现。

## Design decision

课程名属于**数据**，不属于样式。CSS 伪元素无法感知当前课程，因此删除侧栏的 `content` 声明，让课程名只由顶栏（`#topbar-title`）承担。侧栏顶部保留视觉分隔所需的留白，避免导航项紧贴顶栏。

## Reuse

- 现有顶栏课程名机制：`app.js` 的 `setTopbar(title, sub, showBack)` 写入 `#topbar-title` / `#topbar-sub`
- 现有侧栏结构：`.tabbar`（`:249`）在桌面端变为竖向导航（`:306-321`）
- Exemplar：移动端底部页签不显示课程名，课程名由顶栏承担——桌面端与之一致

## Changes

1. `law-study/styles.css` — `.tabbar::before`（`:313-317`）
   - Change：删除 `content:"刑法总论"`，保留块级占位与内边距：
     ```css
     .tabbar::before{
       content:"";display:block;height:14px;
     }
     ```
     （或直接删除整个 `.tabbar::before` 规则，改由 `.tabbar{padding-top:30px}` 提供留白）
   - Preserve：侧栏宽度 220px、右边框、`position:sticky`、`top:64px`、导航项样式与选中态
   - Verify：进入任意课程，侧栏顶部无固定课程名；顶栏显示当前课程名

2. `law-study/styles.css` — 桌面端 `.tabbar`（`:306-311`）
   - Change：若采用「删除伪元素」方案，把 `padding:16px 12px` 调整为 `padding:30px 12px 16px`，补回顶部留白
   - Preserve：`flex-direction:column`、`gap:4px`、`height:calc(100vh - 64px)`
   - Verify：首个导航项与顶栏之间有约 30px 间距，不贴边

## Scope

- **Inherit**：所有课程的桌面端侧栏
- **Verify**：1440×900 与 1024×768 两种桌面视口
- **Exclude**：移动端底部页签（`.tabbar` 的移动端规则）；顶栏标题逻辑（`app.js`）；课程卡片上的课程名（`.course-title`，属另一处正确用法）

## Validation

- **Product**：进入课程，确认页面只在一处显示课程名（顶栏）
- **Interface**：`#/c/criminal-law-general`、`#/c/criminal-law-general/read/ch1-s1`、`#/c/criminal-law-general/drill`，桌面端各检查一次
- **System**：确认没有新增第二个课程名来源；侧栏纯导航
- **Repository**：
  - `node --check app.js` → 通过（本计划不改 JS）
  - `node verification/smoke.js` → 236 项全部通过
  - `grep -c 'content:"刑法总论"' styles.css` → 0

## Stop conditions

- 若产品方希望侧栏保留课程名，则改为由 `app.js` 写入真实 DOM 节点（而非伪元素），并在 `setTopbar` 同步更新；此时需新增一个 `#sidenav-title` 元素，属于结构性改动，须先确认
- 若删除后侧栏顶部留白与顶栏视觉重心不协调，按 24–32px 区间微调并在计划中记录实际取值

## Design documentation

- 验收通过后：在 `DESIGN.md` 的 Layout 节补充一句「课程名只由顶栏承载，侧栏仅作导航」，防止后续再次把数据写进 CSS。
