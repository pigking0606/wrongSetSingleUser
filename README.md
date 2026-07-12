# 考研错题自适应刷题系统

基于 Next.js 16 的考研错题管理工具，支持拍照上传、AI 识别分类、多解法解析、LaTeX 数学渲染、艾宾浩斯自适应复习、每日学习计划、学习进度 AI 管理。

## 开发规范

- **图标**：禁止使用 emoji，统一使用 `@/lib/icons` 中的 SVG Icon 组件（如 `<IconCheck>`、`<IconFileText>` 等）
- **数据库**：MySQL 8.0（mysql2/promise），禁止使用 PostgreSQL/SQLite 专属语法
  - `ON CONFLICT` → `ON DUPLICATE KEY UPDATE`
  - `RANDOM()` → `RAND()`
  - `last_insert_rowid()` → `LAST_INSERT_ID()`
  - `||` 字符串拼接 → `CONCAT()`
  - `key` 是 MySQL 保留字，必须用 `` `key` `` 反引号包裹
- **异步**：所有 `async` 函数调用必须加 `await`，否则返回 Promise 对象序列化为 `{}`

---

## 当前进度

### 已完成

| 模块 | 功能 | 状态 |
|---|---|---|
| 项目基础 | Next.js 16 (Turbopack) + TypeScript + MySQL (mysql2) + Tailwind CSS v4 | ✅ |
| 数据库 | 10 张表（banks / chapters / questions / review_records / tags / question_tags / settings / plan_tasks / daily_summaries / learning_progress） | ✅ |
| 科目体系 | 4 科目 82 分类节点，三级层级（科目 → 书本 → 章节），支持多题库 | ✅ |
| 408 | 408 → 数据结构/计组/操作系统/计算机网络 → 24 章节 | ✅ |
| 数学二 | 数学二 → 高等数学(6章)/线性代数(6章) | ✅ |
| 英语二 | 英语二 → 完形填空/阅读理解/翻译/写作 → 11 考点 | ✅ |
| 政治 | 政治 → 马原/毛中特/近现代史/思修法基/形势与政策 → 15 考点 | ✅ |
| AI 分析 | 视觉模型(DashScope qwen-vl) + 文本模型(DeepSeek)，OCR+分类+多解法+LaTeX修复+去重 | ✅ |
| 拍照上传 | 手机端相机拍照 + 相册选择 + 拖拽上传 + react-image-crop 裁剪 + 旋转 + 双页合并 | ✅ |
| 题库浏览 | `/questions` 多级筛选 + 多题库切换 + filter chips + 删除 + AI 重新解析 + 分页 | ✅ |
| 错题复习 | `/review` 艾宾浩斯遗忘曲线排期 + 对/错评分 + 科目/章节/题库筛选 + 题数可调 | ✅ |
| 学习计划 | `/plan` 每日任务 CRUD + 计时器(防漂移) + AI 建议生成 + 昨日未完成提醒 | ✅ |
| 学习进度 | 单例进度文档，支持手动编辑 + AI 优化 + 基于每日小结的自动更新 | ✅ |
| 每日小结 | `/plan` 内置编辑器，支持 AI 生成总结，按日期存储 | ✅ |
| 设置中心 | `/settings` API Key 加密存储(AES-256-GCM) + 模型/URL 自定义 + 题库管理 | ✅ |
| LaTeX 渲染 | KaTeX + 自动裸LaTeX包裹 + AI二次修复 + sanitize 管线（3层） | ✅ |
| 部署 | PM2 + Nginx 反向代理 + 域名 066112.xyz + 自动/手动部署脚本 | ✅ |

### 待完成

- [ ] 用户登录/注册
- [ ] 复习提醒推送
- [ ] 错题导出（PDF/打印）
- [ ] 刷题模式（随机抽题/模拟考试）
- [ ] 数据统计看板（正确率趋势/科目分布）
- [ ] PWA 支持（离线访问）

---

## 启动方法

### 环境要求

- Node.js >= 18
- npm >= 9
- MySQL 8.0（端口 6603，库名 wrongset，用户 wrongset）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.local.example` 为 `.env.local`，填入配置：

```env
# 视觉模型（图片识别+解题）— DashScope API
DASHSCOPE_API_KEY=你的API_Key
DASHSCOPE_MODEL=qwen3.6-flash

# 文本模型（去重精简、LaTeX修复、重解析答案）— DeepSeek API
DEEPSEEK_API_KEY=你的API_Key
TEXT_MODEL=deepseek-v4-pro

# 数据库
DB_HOST=localhost
DB_PORT=6603
DB_USER=wrongset
DB_PASSWORD=wrongset123
DB_NAME=wrongset

# 操作口令
APP_PASSWORD=你的口令
```

### 3. 初始化数据库

```bash
npm run db:init
npm run seed:408
```

### 4. 启动开发服务器

```bash
npm run dev
```

浏览器访问 `http://localhost:3000`

---

## 页面路由

| 路由 | 说明 |
|---|---|
| `/` | 首页，数据库状态 + 统计面板 + 导航入口 |
| `/upload` | 拍照上传错题，框选裁剪，多页合并，AI 分析，LaTeX 渲染确认 |
| `/questions` | 题库浏览，多级筛选，多题库切换，答案/解析隐藏，删除，AI 重新解析 |
| `/review` | 每日复习，艾宾浩斯排期，对/错评分，科目/章节/题库筛选 |
| `/plan` | 学习计划，每日任务 + 计时器 + AI 建议 + 每日小结 + 进度统计 |
| `/settings` | 设置中心，API Key 管理，模型 URL 配置，题库创建/删除 |

---

## API 接口

### 基础

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 健康检查（无数据库依赖） |
| GET | `/api/version` | 构建时间戳，客户端轮询检测新部署 |
| POST | `/api/init` | 初始化数据库表结构 |
| GET | `/api/db-status` | 数据库统计（题目数/章节数/科目数/复习次数） |
| POST | `/api/auth` | 操作口令验证，返回 token |

### 章节 & 题库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/chapters?banks=1` | 题库列表 |
| GET | `/api/chapters?tree=true` | 完整章节树（三级嵌套） |
| GET | `/api/chapters?level=&parent_id=` | 按层级/父级筛选章节 |
| POST | `/api/chapters` | 新增章节 `{name, parent_id?, sort_order?}` |
| POST | `/api/chapters` | 新增题库 `{bankName}` |
| PUT | `/api/chapters?id=` | 更新章节 `{name?, parent_id?, sort_order?}` |
| DELETE | `/api/chapters?id=` | 删除章节（有子节点或题目时拒绝） |
| DELETE | `/api/chapters` | 删除题库 `{bankId}` |

### 题目

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/questions?subject_id=&chapter_l2_id=&chapter_id=&bank_id=&from=&to=&page=&pageSize=` | 分页筛选题目列表 |
| GET | `/api/questions?external_id=` | 按 external_id 查找（跨工程同步） |
| GET | `/api/questions/[id]` | 获取单个题目 |
| POST | `/api/questions` | 新增题目 |
| PUT | `/api/questions?id=` 或 `/api/questions/[id]` | 更新题目字段 |
| DELETE | `/api/questions?id=` 或 `/api/questions/[id]` | 删除题目（含关联图片和复习记录） |

### 上传 & AI 分析

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/upload` | 上传图片（multipart: image, user_answer, bank_id）→ 后台 AI 分析 |
| POST | `/api/reanalyze` | 重新 AI 分析 `{question_id, mode?:"answer"|"full", reason?}` |
| GET | `/api/image/[filename]` | 获取上传的图片（带缓存头） |

### 复习

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/review?limit=&subject_id=&chapter_l2_id=&chapter_id=` | 获取到期复习题目 |
| POST | `/api/review` | 提交复习结果 `{question_id, correct}` → 计算下次复习日期 |

### 学习计划

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/plan-tasks?date=` | 获取指定日期任务（今天含昨日未完成提醒） |
| GET | `/api/plan-tasks?from=&to=` | 获取日期范围任务 |
| GET | `/api/plan-tasks?external_id=` | 按 external_id 查找 |
| POST | `/api/plan-tasks` | 创建任务 `{task_date, title, chapter_id?, description?, difficulty?, external_id?}` |
| PUT | `/api/plan-tasks` | 更新任务（含 timer_action: start/pause/stop/resume/autosave） |
| DELETE | `/api/plan-tasks?id=` | 删除任务（仅限今日） |
| PUT | `/api/plan-tasks/[id]` | 按 ID 更新任务字段 |
| DELETE | `/api/plan-tasks/[id]` | 按 ID 删除任务 |
| POST | `/api/plan-tasks/ai-suggest` | AI 建议今日任务 `{date?}` |

### 学习进度 & 小结

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/learning-progress` | 获取总进度（id=1） |
| POST | `/api/learning-progress` | 更新总进度 `{content}` |
| POST | `/api/learning-progress/ai` | AI 优化进度 `{content, mode:"optimize"|"update", summaryDate?}` |
| GET | `/api/daily-summaries?date=` | 获取指定日期小结 |
| GET | `/api/daily-summaries?recent=N` | 获取最近 N 天小结合并文本 |
| POST | `/api/daily-summaries` | 保存/更新小结 `{summary_date?, content}` |

### 设置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 获取所有设置（密钥解密返回） |
| POST | `/api/settings` | 保存设置 `{visionKey?, visionModel?, visionUrl?, textKey?, textModel?, textUrl?}` |

---

## 项目结构

```
src/
├── app/
│   ├── layout.tsx                    # 根布局（含 KaTeX CSS）
│   ├── page.tsx                      # 首页
│   ├── upload/page.tsx               # 错题上传（拍照+裁剪+AI分析+LaTeX确认）
│   ├── questions/page.tsx            # 题库浏览（筛选+删除+AI重解析）
│   ├── review/page.tsx               # 每日复习（对/错评分+章节筛选）
│   ├── plan/page.tsx                 # 学习计划（任务+计时器+小结+进度）
│   ├── settings/page.tsx             # 设置中心（密钥+模型+题库管理）
│   └── api/
│       ├── auth/route.ts             # 口令验证
│       ├── ping/route.ts             # 健康检查
│       ├── version/route.ts          # 构建时间戳
│       ├── init/route.ts             # 初始化数据库
│       ├── db-status/route.ts        # 数据库统计
│       ├── chapters/route.ts         # 章节+题库 CRUD
│       ├── questions/
│       │   ├── route.ts              # 题目列表 CRUD
│       │   └── [id]/route.ts         # 单个题目 CRUD
│       ├── upload/route.ts           # 图片上传+AI分析
│       ├── reanalyze/route.ts        # AI重新解析
│       ├── image/[filename]/route.ts # 图片访问
│       ├── review/route.ts           # 复习队列+提交结果
│       ├── plan-tasks/
│       │   ├── route.ts              # 计划任务 CRUD+计时器
│       │   ├── [id]/route.ts         # 按ID操作
│       │   └── ai-suggest/route.ts   # AI建议
│       ├── learning-progress/
│       │   ├── route.ts              # 学习进度读写
│       │   └── ai/route.ts           # AI进度更新
│       ├── daily-summaries/route.ts  # 每日小结
│       └── settings/route.ts         # 设置读写（加密）
├── lib/
│   ├── db.ts                    # MySQL 连接池（mysql2/promise, dateStrings:true）
│   ├── schema.ts                # 表结构 + 自动迁移（initSchema）
│   ├── types.ts                 # TypeScript 类型定义（10+接口）
│   ├── ai.ts                    # AI 分析管线：prompt构建+JSON解析+LaTeX包裹+二次修复+去重
│   ├── analyze-pipeline.ts      # 分析流程：读取图片→AI→匹配章节→写入DB
│   ├── ebbinghaus.ts            # 艾宾浩斯间隔重复算法
│   ├── crypto-utils.ts          # AES-256-GCM 加密/解密（密钥由APP_PASSWORD派生）
│   ├── crop-image.ts            # Canvas 图片裁剪
│   ├── upload-utils.ts          # 文件验证/保存/删除
│   ├── global-timer.ts          # 学习计时器（防时钟漂移）
│   ├── pdf-export.ts            # PDF导出（html2canvas + jsPDF）
│   └── icons.tsx                # SVG 图标库
scripts/
├── init-db.mjs                  # 初始化数据库
├── seed-408.mjs                 # 播种科目分类
└── seed-questions.mjs           # 播种样题
public/
└── uploads/                     # 上传的题目图片
```

---

## 部署

### 服务器信息
- **IP**: 43.134.234.119
- **域名**: 066112.xyz (Cloudflare DNS)
- **路径**: `/www/wwwroot/wrongset`
- **PM2**: `wrongset` (端口 3000, mode: fork)
- **Nginx**: 反向代理 `:3000`，`proxy_cache off`
- **数据库**: MySQL 8.0，端口 6603，库 `wrongset`，用户 `wrongset`

### 手动部署

```bash
ssh -i legacy_key.pem root@43.134.234.119
cd /www/wwwroot/wrongset
bash wrong.sh
```

`wrong.sh` 执行流程：备份数据库 → git pull → npm install → db:init → seed:408 → build → pm2 restart

### 自动部署

push 到 `main` 分支后，GitHub Actions 自动 SSH 到服务器执行 `wrong.sh`。

### 常用运维命令

```bash
# 查看日志
pm2 logs wrongset --lines 50

# 重启
pm2 restart wrongset

# 清理构建缓存后重构建
rm -rf .next node_modules/.cache && npm run build && pm2 restart wrongset

# 查看 MySQL 连接
mysql -uwrongset -pwrongset123 -P6603 wrongset
```

---

## 已知问题

| 问题 | 影响 | 状态 |
|------|------|------|
| `/api/questions` 500 (ER_WRONG_ARGUMENTS 1210) | 题库列表页无法加载 | ⚠️ 待修复 |
| `/api/review` 500 (ER_WRONG_ARGUMENTS 1210) | 复习队列无法加载 | ⚠️ 待修复 |

> 2026-07-12 已修复 11 个问题（commit `31edace` + `32d9027`），详见 git log。剩余 2 个 API 500 错误初步判断为 prepared statement 参数数量不匹配，建议添加 console.log(sql, params) 定位。

---

## 变更记录

### 2026-07-12 — API 大规模修复

**修复 11 个问题（3 次 commit）：**

1. **settings GET 返回空对象** — `getKey()`/`getPlain()` 未 await，Promise 序列化为 `{}`
2. **settings POST SQL 语法** — `ON CONFLICT` → `ON DUPLICATE KEY UPDATE`
3. **MySQL `key` 保留字** — 5 个文件中 `WHERE key=?` → `` WHERE `key`=? ``
4. **ai.ts buildSystemPrompt 未 await** — AI 系统提示词为空
5. **daily-summaries POST SQL** — `ON CONFLICT` → `ON DUPLICATE KEY UPDATE`
6. **daily-summaries GET SQL** — `GROUP_CONCAT(||)` → `CONCAT()` + `SEPARATOR`
7. **review SQL 语法** — `ORDER BY RANDOM()` → `ORDER BY RAND()`
8. **plan-tasks SQL 语法** — `last_insert_rowid()` → `LAST_INSERT_ID()`
9. **plan-tasks/route.ts 文件损坏** — 远程仓库中被覆盖为 learning-progress 代码，恢复 200+ 行完整实现
10. **questions GET 缺失 bank_id 过滤** — 参数已解析但未加入 WHERE 条件
11. **README 文档更新** — SQLite→MySQL、新增 API/功能/页面

**服务器部署状态：**
- commit `32d9027` 已部署
- PM2 运行正常，`/api/ping` 返回 200
- 8/10 个核心 API 正常，2 个待修复