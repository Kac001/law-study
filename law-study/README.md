# 多课程学习系统（law-study）

一个**可以在电脑和手机上随时打开**的多课程学习页面：课程大厅选课 → 进入该课程的内容阅读、章节自测、刷题与错题本。无框架、无 CDN、无构建，断网也能用。

## 打开方式

- **在线**：`http://<公网IP>:8123/`（本机托管，见下）
- **离线**：直接双击 `index.html`（`file://` 也能用，内容来自同目录课程包镜像）

## 手机访问（同一 WiFi）

1. 手机浏览器打开 `http://<服务器/电脑局域网IP>:8123/`
2. 建议「添加到主屏幕」，像 App 一样随时点开。

## 多课程架构

```
law-study/
├── index.html                 单页外壳
├── app.js                     课程无关内核（路由/加载器/存储/视图）
├── courses.json               课程清单（首屏只加载这个，~0.5 KB）
├── courses.js                 清单的 file:// 镜像
├── courses/
│   └── <courseId>/
│       ├── content.json       教材正文
│       ├── bank.json          题库
│       └── course.js          离线镜像（content + bank 合并）
├── legacy/                    旧单课程版备份（可回滚）
├── scripts/add-course.js     新增课程脚手架
└── verification/              冒烟测试 + 截图 + 测试用 fixture 课程
```

### 路由

| 路由 | 页面 |
|---|---|
| `#/` | 课程大厅（卡片 + 进度，无需加载正文） |
| `#/c/:id` | 课程目录 |
| `#/c/:id/ch/:chId` `#/c/:id/read/:sid` `#/c/:id/quiz/:chId` | 章节/阅读/自测 |
| `#/c/:id/drill/...` | 刷题（章节/随机/会话/成绩/错题本） |
| `#/c/:id/me` | 我的 |

旧链接（如 `#/read/ch1-s1`）自动重定向到 `#/c/<defaultCourse>/read/ch1-s1`。

### 按需加载

进入课程时才加载该课程内容：http(s) 下 `fetch` JSON；`file://` 或失败时注入 `courses/<id>/course.js` 镜像。已加载课程缓存在内存。

## 课程内功能

| 模块 | 说明 |
|---|---|
| 📚 目录 | 章节总览、每章阅读进度与自测最好成绩 |
| ▶️ 继续 | 回到上次看到的小节 |
| 📖 阅读 | 「一句话搞懂」+ 正文 + ✅记住这几点 + ⚠️容易搞混 + 法条标签 |
| 📝 自测 | 每章单选/判断题，即时判定 + 解析 + 成绩环与错题回顾 |
| ✍️ 刷题 | 按章节 / 随机两种模式，可选题量与范围 |
| 🔁 错题本 | 答错自动收录，连续答对 2 次自动移出 |
| 🔍 搜索 | 全站搜知识点/法条关键词 |
| 🎨 设置 | 字体四档、日间/护眼/夜间主题（全局，不随课程变） |

## 进度存储

| Key | 内容 | 作用域 |
|---|---|---|
| `app:settings:v1` | `{theme, fontScale}` | 全局 |
| `course:<id>:progress:v1` | 阅读进度、章节自测成绩、lastSid | 单课程 |
| `course:<id>:drill:v1` | 刷题记录、错题本、刷题历史 | 单课程 |
| `app:migrated:v1` | 迁移标记 | 全局 |

**旧数据迁移**：首次进入默认课程时，旧键 `xingfa-zonglun:progress:v1` / `xingfa-zonglun:drill:v1` 会被**复制**到新键（旧键保留，可回滚）；旧进度里的 `settings` 拆分到全局键。迁移幂等，失败不阻塞使用。

## 新增一门课程

1. 让对应学科 agent 按现有 schema 产出 `content.json` + `bank.json`，放到 `courses/<新课程id>/`（目录名 = 课程 id，小写字母/数字/连字符）
2. 执行脚手架（校验 + 生成镜像 + 更新清单）：

```bash
node scripts/add-course.js courses/<新课程id>
```

3. 刷新页面即可看到新课程（纯静态，无需重启）。

校验项：章节/小节 id 唯一、题干去重、答案命中选项、解析必填、chapterId 存在、清单 id 唯一。任何一项不过即退出非 0，不写入清单。

## 验证

```bash
node --check app.js
node verification/smoke.js      # 122 项断言 × 5 环境（file:/https+fetch 成败/存储禁用/迁移）
```

覆盖：课程大厅、进入课程、阅读/自测/刷题全流程、双课程存储隔离、旧链接重定向、旧数据迁移与幂等、存储禁用降级。

## 回滚

把 `legacy/criminal-law-general/` 复制回根目录（`content.json`/`bank.json`），并恢复旧版 `index.html`/`app.js` 即可；用户进度因为旧键被保留，无损。

## 部署

```bash
pm2 start ecosystem.config.js   # python3 http.server, 端口 8123
pm2 save
```

纯静态内容更新无需重启；仅改端口/进程时才 `pm2 restart law-study`。
