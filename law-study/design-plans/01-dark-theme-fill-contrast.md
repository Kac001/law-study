# 修复夜间主题填充面对比度

Written against: 无 git 仓库（静态文件，2026-10-22）

## Evidence chain

- **Surface**：`law-study/styles.css`，影响 `#/`（课程大厅 hero）、`#/c/:id`（主按钮）、`#/c/:id/me`（字号/主题分段控件选中态）、`#/c/:id/drill/random`（章节筛选胶囊选中态）。
- **Problem**：夜间主题下，hero、主按钮、分段控件与胶囊的选中态都是「白字 + `--brand`/`--brand-ink` 填充」，对比度仅 2.77:1 与 1.91:1；同一组件在日间主题为 6.91:1。
- **Design evidence**：`law-study/DESIGN.md` 的 Colors 节规定「`brand` 作为填充面时必须配 `brand-ink`」，Themes 节规定「夜间主题的 `brand` 是浅色前景，不能再用作填充面」。
- **Owner**：`styles.css` 的 token 层（`:root` / `[data-theme="sepia"]` / `[data-theme="dark"]`）与 4 个消费选择器。
- **Scope and affected surfaces**：`.hero`（`:111`）、`.btn.primary`（`:234-235`）、`.seg button[aria-pressed="true"]`（`:284`）、`.chip.on`（`:371`）。
- **Uncertainty**：无。对比度按 WCAG 相对亮度公式对 `#5aa2d8`/`#8bc2ea` 与 `#ffffff` 计算得出。

## Design decision

`--brand` 与 `--brand-ink` 在夜间主题下是**浅色前景**（用于深底上的文字），不能同时充当**深色填充面**。因此把「填充面」拆成独立语义对，按主题分别赋值，使四处填充在所有主题下都保持 ≥4.5:1 的文字对比度，同时保留 `--brand`/`--brand-ink` 原有的前景用途（链接、当前页签文字、`--brand-soft` 底上的标题）。

## Reuse

- 现有语义 token 体系：`--brand`、`--brand-ink`、`--brand-soft`（`styles.css:2-31`）
- 现有三主题结构：`:root`、`[data-theme="sepia"]`、`[data-theme="dark"]`
- 既有 `@supports not (color: var(--ink))` 兜底块（`styles.css` 末尾）——新增 token 后需同步该块
- Exemplar：`.btn.primary` 与 `.chip.on` 已经是同一套「填充 + 反白文字」写法，本次只替换取值来源

## Changes

1. `law-study/styles.css` — `:root`
   - Change：新增
     ```css
     --brand-fill:#1f5d92;
     --brand-fill-2:#164a75;
     --brand-fill-ink:#ffffff;
     ```
   - Preserve：`--brand`、`--brand-ink`、`--brand-soft` 原值不变（前景用途继续依赖它们）
   - Verify：`getComputedStyle(document.documentElement).getPropertyValue('--brand-fill')` 返回 `#1f5d92`

2. `law-study/styles.css` — `[data-theme="sepia"]`
   - Change：新增
     ```css
     --brand-fill:#8a5a2b;
     --brand-fill-2:#6f4720;
     --brand-fill-ink:#ffffff;
     ```
   - Preserve：护眼主题其余 token 不变
   - Verify：切换护眼主题后 hero 仍为棕系渐变、白字可读

3. `law-study/styles.css` — `[data-theme="dark"]`
   - Change：新增
     ```css
     --brand-fill:#1b2a37;
     --brand-fill-2:#24384a;
     --brand-fill-ink:#8bc2ea;
     ```
   - Preserve：夜间 `--brand:#5aa2d8`、`--brand-ink:#8bc2ea` 不变（继续用于链接与页签文字）
   - Verify：夜间主题下 `#8bc2ea` 文字压 `#1b2a37` 填充，对比度约 7.4:1

4. `law-study/styles.css` — `.hero`（`:111-113`）
   - Change：
     ```css
     .hero{
       background:linear-gradient(140deg,var(--brand-fill),var(--brand-fill-2));
       color:var(--brand-fill-ink);
       ...
     }
     ```
   - Preserve：圆角、内边距、阴影、`.htitle`/`.hsub`/`.hmeta` 字号不变
   - Verify：三套主题下 hero 标题与正文均可读；`.hstat` 的半透明白底在三套主题下都不发灰

5. `law-study/styles.css` — `.btn.primary` / `.btn.primary:active`（`:234-235`）
   - Change：
     ```css
     .btn.primary{background:var(--brand-fill);color:var(--brand-fill-ink);border-color:transparent}
     .btn.primary:active{background:var(--brand-fill-2)}
     ```
   - Preserve：按钮高度 46px、圆角 12px、`disabled` 的 `opacity:.5`
   - Verify：夜间主题下主按钮文字清晰；按下态仍有可见变化

6. `law-study/styles.css` — `.seg button[aria-pressed="true"]`（`:284`）
   - Change：`background:var(--brand-fill);color:var(--brand-fill-ink)`
   - Preserve：分段控件的边框与圆角不变
   - Verify：「我的」页字号/主题选中项在夜间主题下可读

7. `law-study/styles.css` — `.chip.on`（`:371`）
   - Change：`background:var(--brand-fill);border-color:transparent;color:var(--brand-fill-ink)`
   - Preserve：`.chip` 未选中态与 `:disabled` 的 `opacity:.45`
   - Verify：刷题「随机」页章节胶囊选中项在夜间主题下可读

8. `law-study/styles.css` — `@supports not (color: var(--ink))` 兜底块（文件末尾）
   - Change：在该块内补充 `.hero{background:#1f5d92;color:#fff}` 与 `.btn.primary{background:#1f5d92;color:#fff}`（该块原本已覆盖 `.btn.primary`，确认 `.hero` 也被覆盖）
   - Preserve：兜底块只处理不支持 `var()` 的旧内核，不引入主题切换
   - Verify：模拟不支持 `var()` 时，hero 仍有底色而非透明

## Scope

- **Inherit**：所有使用 `.btn.primary`、`.chip.on`、`.seg [aria-pressed="true"]`、`.hero` 的页面（大厅、目录、阅读、自测、刷题、我的）自动生效
- **Verify**：`.course-icon`（`:388`）使用数据驱动的 `color` + 白字，不属本计划；`.opt.right .okey` 使用 `--ok` 底白字，属另一问题，不在本次范围
- **Exclude**：`.pbar > i` 的渐变（图形元素非文字，当前对比度充足）；`.hero` 的布局与字号；任何 JS 逻辑

## Validation

- **Product**：切换三套主题，确认所有「填充 + 反白文字」控件都可读
- **Interface**：`#/`（hero + 主按钮）、`#/c/:id/me`（分段选中态）、`#/c/:id/drill/random`（胶囊选中态），分别在 390×844 与 1440×900 下检查
- **System**：确认没有新增第二套品牌色，只新增了填充语义对；`--brand` 仍用于前景
- **Repository**：
  - `node --check app.js` → 通过（本计划不改 JS）
  - `node verification/smoke.js` → 236 项全部通过
  - 对比度复算：`#8bc2ea` on `#1b2a37` ≥ 7:1；`#ffffff` on `#1f5d92` ≥ 6.9:1

## Stop conditions

- 若发现除上述 4 处外还有组件把 `--brand` 当填充面用，先报告再扩大范围
- 若 `--brand-fill-2` 在护眼主题下与 `--brand-fill` 差异不可辨（渐变失效），改为单色填充并记录

## Design documentation

- 验收通过后：在 `DESIGN.md` 的 Colors 节补充 `--brand-fill` / `--brand-fill-2` / `--brand-fill-ink` 的用途说明，并在 Themes 表补充三套取值。
