# 错题复习系统 — SpringBoot + Vue 重构文档

## 一、项目总览

现项目：Next.js 16 (Turbopack) + TypeScript + SQLite(sql.js WASM) + KaTeX + Tailwind CSS v4
目标：SpringBoot 3 + Next.js 16 (现有前端) + MySQL + KaTeX + 多用户支持

> 前端技术栈不变：Next.js 16 + TypeScript + React 18 + Tailwind CSS v4
> 现有组件/图标/裁剪/计时/KaTeX 等前端代码可直接复用，仅需将 API 调用从本地 SQLite 改为远程 SpringBoot

---

## 二、数据库设计

### 当前表结构（`src/lib/schema.ts` — `initSchema()` 函数）

```sql
-- 1. 科目章节知识点（三级树）
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,              -- 父节点ID，null=科目(level=1)
  level INTEGER DEFAULT 1,        -- 1=科目, 2=章节, 3=知识点
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE SET NULL
);

-- 2. 题目（核心业务表）
CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,    -- → chapters.id (知识点级)
  image_path TEXT,                -- 图片路径如 "uploads/xxx.jpg"
  ocr_text TEXT,                  -- AI识别的题干文本
  question_type TEXT DEFAULT 'single_choice',  -- single_choice|multiple_choice|true_false|fill_blank|short_answer|comprehensive
  correct_answer TEXT,            -- 正确答案
  explanation TEXT,               -- 解析
  ai_solutions TEXT,              -- AI生成的多种解法(JSON字符串)
  user_answer TEXT,               -- 用户上传时填的答案
  ai_raw_response TEXT,           -- AI原始返回
  original_filename TEXT,
  error_reason TEXT,              -- 错误原因
  status TEXT DEFAULT 'ready',    -- pending|ready|error  (分析状态)
  created_at TEXT,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- 3. 复习记录（艾宾浩斯）
CREATE TABLE review_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  review_date TEXT NOT NULL,
  score INTEGER DEFAULT 0,        -- 0=错, 1=对
  ease_factor REAL DEFAULT 2.5,
  interval_days INTEGER DEFAULT 0,
  next_review_date TEXT,
  created_at TEXT,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 4. 标签
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
CREATE TABLE question_tags (
  question_id INTEGER, tag_id INTEGER,
  PRIMARY KEY (question_id, tag_id)
);

-- 5. API设置（加密存储）
CREATE TABLE settings (
  key TEXT PRIMARY KEY,           -- vision_key|vision_model|vision_url|text_key|text_model|text_url
  value TEXT NOT NULL             -- API Key使用AES-256-GCM加密，enc:前缀
);

-- 6. 每日学习计划
CREATE TABLE plan_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_date TEXT NOT NULL,        -- 'YYYY-MM-DD'
  chapter_id INTEGER,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  completion_pct INTEGER DEFAULT 0,  -- 0-100
  difficulty INTEGER DEFAULT 3,      -- 1-5
  time_spent INTEGER DEFAULT 0,      -- 累计计时秒数
  status TEXT DEFAULT 'pending',     -- pending|in_progress|completed
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  completed_at TEXT
);

-- 7. 每日小结
CREATE TABLE daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summary_date TEXT NOT NULL UNIQUE,
  content TEXT DEFAULT '',
  created_at TEXT
);

-- 8. 学习总进度（单行，用户编辑+AI辅助）
CREATE TABLE learning_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT DEFAULT '',
  updated_at TEXT
);
```

### 重构要点
- 所有表加 `user_id` 字段实现多用户隔离
- `settings` 表改为 `user_settings`，每个用户独立配置
- `learning_progress` 加 `user_id`
- SQLite → MySQL：注意 `datetime('now','localtime')` → `NOW()`，`ON CONFLICT` → `ON DUPLICATE KEY UPDATE`

---

## 三、功能模块详解

### 3.1 用户认证 & 密码门控

| 项目 | 位置 | 说明 |
|------|------|------|
| 前端 AuthGate 组件 | `src/lib/auth-gate.tsx` | 密码输入弹窗，验证后存 hash 到 localStorage |
| 前端 useAuth hook | 同上文件 `useAuth()` | 检查 localStorage hash vs 服务端 `/api/auth` GET |
| 后端验证 | `src/app/api/auth/route.ts` | POST 验证密码，GET 返回 hash |
| 密码来源 | `.env.local` → `APP_PASSWORD` | |

**流程**：
1. 前端 `useAuth()` GET `/api/auth` → 获取当前 hash，对比 localStorage
2. 未认证 → 渲染 `<AuthGate>` 密码输入框
3. POST `/api/auth` body=`{password}` → 服务端对比 `APP_PASSWORD`
4. 成功 → 返回 `{ok,hash}` → 前端存 localStorage

**各页面权限控制**（`authed` 变量）：
- 上传页：完全拦截
- 计划页：隐藏添加/删除/保存/AI按钮，slider disabled，textarea readOnly
- 题库页：隐藏编辑/删除/重解析按钮
- 复习页：隐藏对错评分按钮
- 分类页：隐藏重命名/添加/删除按钮
- 设置页：隐藏保存按钮，input readOnly

### 3.2 AI 图片分析（上传 → OCR → 分类 → 入库）

| 项目 | 位置 | 说明 |
|------|------|------|
| 上传前端页面 | `src/app/upload/page.tsx` | 拍照/选图→裁剪→预览→上传 |
| 图片处理工具 | `src/lib/crop-image.ts` | `cropImage()`, `rotateImage()`, `compressImage()`, `mergeImagesVertical()` |
| 上传API | `src/app/api/upload/route.ts` | sharp服务端缩放(2048px/quality 85) → 保存文件 → 后台AI分析 |
| 文件保存 | `src/lib/upload-utils.ts` | `saveUploadData(buffer, ext)` → public/uploads/ |
| 后台分析管道 | `src/lib/analyze-pipeline.ts` | `performAnalysis(questionId)` — 读取图片→base64→调用AI→匹配章节→更新DB |
| AI分析核心 | `src/lib/ai.ts` | `analyzeWrongAnswerImage()` → `realAnalyze()` → 5步管道 |
| 图片服务API | `src/app/api/image/[filename]/route.ts` | 从 filesystem 读取图片返回，绕过 Next.js 静态文件限制 |

**上传模式**（upload/page.tsx）：
- **单页模式**：拍照/选图 → ReactCrop 裁剪 → 预览确认 → compress(2048px) → upload
- **多题框选**：选图 → 多次裁剪(每个题目一次) → 预览列表(可删除) → 逐个上传
- **双页合成**：拍第1页裁剪 → 拍第2页裁剪 → `mergeImagesVertical()` 纵向拼接 → upload

**AI 分析 5 步管道**（`ai.ts` — `realAnalyze()`）：
```
Step 1: 图片→base64，调用视觉模型(qwen-vl-plus)识别+分类+解题
Step 2: JSON解析AI返回
Step 3: AI去重（dedupWithAI — 删除AI的自我推翻内容）
Step 4: L1 → 包裹数学公式为 $...$，L3 → sanitizeLatex 清理
Step 5: L2 → fixLatexWithAI（第二次AI调用，修复LaTeX格式）
```

**AI模型路由**（`ai.ts` — `getApiUrl()`）：
- 模型名以 `deepseek` 开头 → api.deepseek.com/v1
- 否则 → dashscope.aliyuncs.com/compatible-mode/v1

**API Key来源**（`ai.ts` — `loadSetting()`）：
1. 先查 DB `settings` 表
2. 解密（AES-256-GCM，加密格式 `enc:iv:cipher:tag`）
3. 若无DB值，fallback到 `process.env`

### 3.3 重解析（重新AI分析）

| 项目 | 位置 | 说明 |
|------|------|------|
| API | `src/app/api/reanalyze/route.ts` | POST `{question_id, mode}` |
| 模式 | `mode="full"` | 重新OCR+答案+解析（发图片） |
| 模式 | `mode="answer"` | 只重新生成答案解析（发文本） |
| 状态管理 | 同上 | 开始→status='pending'，完成→'ready'，失败→'error'+error_reason |

**全量重解析流程**：
```
POST /api/reanalyze {question_id, mode:"full", reason?}
  → 1. UPDATE status='pending', error_reason=NULL
  → 2. 读取图片文件→base64
  → 3. 调用视觉模型（图片+旧OCR作为参考）
  → 4. 解析JSON → Layer1 sanitize → 保存DB(status='ready')
  → 5. Layer2 fixLatexWithAI → 重新保存
  → 6. 每层独立try-catch，Layer2失败不影响结果
  → 7. 失败→status='error'+error_reason
```

**AI Parse 失败兜底**：三层JSON提取策略：
1. 去 markdown 包裹 → JSON.parse
2. 搜花括号 → 提取JSON
3. 最后兜底：用原始文本构建最小结果（不抛异常）

### 3.4 LaTeX 数学公式渲染

| 项目 | 位置 | 说明 |
|------|------|------|
| 渲染组件 | `src/lib/math-text.tsx` | `MathText`, `MathAtom`, `TextAtom` |
| 分词器 | 同上 `tokenize()` | 按 `$...$` 分割，自动检测数学内容 |
| KaTeX渲染 | `MathAtom` 组件 | ref-based，`el.innerHTML=""` 后 `katex.render()` |
| LaTeX命令列表 | `LATEX_CMD` 正则 | 包含所有矩阵环境名(matrix/vmatrix/bmatrix/pmatrix等) |

**3层LaTeX修复管道**（`ai.ts`）：
- **Layer 1**（提示词约束）：prompt要求"完整公式一个$...$块包裹，禁止拆成$a=$b形式"
- **Layer 2**（AI修复）：`fixLatexWithAI(fields, apiKey)` — 第二次AI调用专门修复LaTeX
- **Layer 3**（正则清理）：`sanitizeLatex()` — 去嵌套$、合并相邻$块、补全裸上标下标

**关键函数**：
- `autoWrapMathDelimiters()` — 自动包裹裸数学符号
- `fixLatexEscapes()` — 确保JSON内LaTeX双反斜杠正确
- `BARE_EXPONENT` 正则 — 捕获裸 `x^2` 为 `$x^{2}$`

### 3.5 图片处理（纯前端Canvas + 服务端sharp）

| 项目 | 位置 | 说明 |
|------|------|------|
| 裁剪 | `src/lib/crop-image.ts` → `cropImage()` | Canvas drawImage + getContext + toBlob |
| 旋转 | 同上 → `rotateImage()` | Canvas 旋转 90/180/270度 |
| 压缩 | 同上 → `compressImage(maxDim)` | Canvas缩放，Math.min(maxDim/w, maxDim/h, 1) |
| 纵向拼接 | 同上 → `mergeImagesVertical(b1,b2,maxDim)` | 两个 Blob → 两个 Image → Canvas 上下拼接 |
| 服务端 | `src/app/api/upload/route.ts` | sharp: resize(2048,2048,{fit:'inside'}).jpeg({quality:85}) |

### 3.6 艾宾浩斯复习系统

| 项目 | 位置 | 说明 |
|------|------|------|
| 算法 | `src/lib/ebbinghaus.ts` → `calcNextReview()` | 二元评分：对→interval增长，错→重置1天 |
| 复习API | `src/app/api/review/route.ts` | GET 获取今日待复习 / POST 记录结果 |
| 复习前端 | `src/app/review/page.tsx` | 科目→章节→知识点三级筛选 + 自定义数量 |

**复习API GET参数**：`subject_id`, `chapter_l2_id`, `chapter_id`（知识点）

**next_review_date 计算逻辑**：
```
正确：easeFactor *= 1.3, intervalDays *= easeFactor
错误：intervalDays = 1, easeFactor = max(1.3, easeFactor - 0.2)
nextDate = today + intervalDays
```

### 3.7 每日学习计划系统

| 项目 | 位置 | 说明 |
|------|------|------|
| 前端 | `src/app/plan/page.tsx` | 最复杂的页面(~550行) |
| 任务CRUD API | `src/app/api/plan-tasks/route.ts` | GET/POST/PUT/DELETE |
| 每日小结API | `src/app/api/daily-summaries/route.ts` | GET/POST |
| 总进度API | `src/app/api/learning-progress/route.ts` | GET/POST |
| AI建议任务 | `src/app/api/plan-tasks/ai-suggest/route.ts` | POST 生成今日建议 |
| AI优化进度 | `src/app/api/learning-progress/ai/route.ts` | POST mode="optimize"/"update" |

**计划页功能清单**：
1. 日期导航（◀ 今天 ▶）— 本地时区日期，不用 `toISOString()`
2. 统计栏：连续天数(每天平均≥80%)、平均完成度、平均难度
3. 昨日未完成提示（只读通知栏）
4. 总进度概括：用户填写 → 保存DB → AI优化排版 → AI更新进度（查上次updated_at至今的所有数据）
5. 任务卡片：标题、章节标签、完成度滑块(0-100%)、难度滑块(1-5★)、累计计时、删除按钮
6. 添加任务：输入描述 → 添加
7. 每日小结：textarea → 保存DB + AI更新总进度按钮
8. AI建议今日任务：生成多条 → 每条卡片显示 → 用户点「采纳」逐个添加
9. 历史记录：30天完成率条形图，点击跳转
10. 口令保护：未登录时所有输入disabled/readOnly，按钮隐藏

### 3.8 计时系统（全局持久化）

| 项目 | 位置 | 说明 |
|------|------|------|
| 全局计时器 | `src/lib/global-timer.ts` | 模块级单例，setInterval + listener模式 |
| React Hook | `src/lib/study-timer.tsx` → `useGlobalTimer()` | useState+useEffect订阅全局计时器 |
| 全屏学习模式 | 同上 → `StudyFullscreen` | 全屏+Unsplash照片+大字号计时+自动隐藏控件 |
| 导航栏显示 | `src/app/layout.tsx` | 实时计时数字(绿色) |
| 计时保存 | plan/page.tsx 结束按钮 | 停止→保存time_spent到DB，下次start从累计值继续 |

**计时流程**：
```
开始计时 → globalTimer.start(fromSec=上次累计)
  → 每200ms更新elapsed
  → 暂停/继续
  → 结束 → globalTimer.stop() → 返回总秒数
    → PUT /api/plan-tasks {id, time_spent}
    → 下次开始从DB读取time_spent继续叠加
```

**全局计时器特性**：
- 跨页面导航不中断（模块级变量在客户端路由中持久）
- 导航栏实时显示（layout.tsx 订阅 globalTimer）
- 全屏模式：沉浸式学习照片 + 3秒自动隐藏控件
- 100%完成任务后自动停计时
- 全屏结束计时→防双重调用stoppedRef

### 3.9 题库管理

| 项目 | 位置 | 说明 |
|------|------|------|
| 前端 | `src/app/questions/page.tsx` | 题列表+筛选+编辑+删除+重解析 |
| API | `src/app/api/questions/route.ts` | GET(分页+筛选)/PUT/DELETE |

**GET参数**：`subject_id`, `chapter_l2_id`, `chapter_id`, `from`, `to`, `page`, `pageSize`
**题目展示**：分类面包屑 → 题型标签 → 状态标签(分析中/失败) → OCR文本(KaTeX渲染) → 图片(可切换) → 答案/解析/解法(可展开) → 重解析/编辑/删除按钮

### 3.10 分类管理（三级树）

| 项目 | 位置 | 说明 |
|------|------|------|
| 前端 | `src/app/chapters/page.tsx` | 树形展示+重命名+添加子级+删除 |
| API | `src/app/api/chapters/route.ts` | 完整CRUD |
| 种子数据 | `scripts/seed-408.mjs` | 408计算机考研科目体系，已存在则跳过 |

**树结构**：科目(level=1) → 章节(level=2) → 知识点(level=3)
图标：FolderIcon → BookIcon → FileIcon

### 3.11 设置系统（DB热加载）

| 项目 | 位置 | 说明 |
|------|------|------|
| 前端 | `src/app/settings/page.tsx` | 两张卡片：OCR模型 + 文本模型 |
| API | `src/app/api/settings/route.ts` | GET/POST |
| 加密 | `src/lib/crypto-utils.ts` | AES-256-GCM，密钥从APP_PASSWORD派生 |

**设置项**：vision_key(加密), vision_model, vision_url, text_key(加密), text_model, text_url
**特点**：存入SQLite → 修改即时生效无需重启 → API Key加密存储 → 向后兼容明文

### 3.12 主题系统

| 项目 | 位置 | 说明 |
|------|------|------|
| CSS变量 | `src/app/globals.css` | `:root`(日间) / `.theme-dark`(夜间) / `.theme-eye`(护眼) |
| 切换逻辑 | `src/app/layout.tsx` | inline script防闪烁 + localStorage持久化 |

**主题变量**：--bg, --bg-card, --bg-hover, --text, --text-muted, --border, --accent, --green-bg/text, --red-bg/text, --yellow-bg/text, --tag-bg/text, --shadow

### 3.13 SVG 图标系统

| 项目 | 位置 | 说明 |
|------|------|------|
| 图标组件 | `src/lib/icons.tsx` | 24×24 描边风格，currentColor继承主题色 |

**图标列表**（24个）：
IconFlame, IconChart, IconTrending, IconPencil, IconSparkle, IconCalendar, IconCamera, IconImage, IconLock, IconCheck, IconPlus, IconTrash, IconChevronLeft, IconChevronRight, IconCaretDown, IconCaretRight, IconFolder, IconBook, IconFile, IconClipboard, IconStar, IconStarEmpty, IconEye, IconRefresh, IconUpload, IconQuote, IconBrain, IconTarget, IconX, IconSettings, IconList, IconSearch, IconArrowRight, IconArrowLeft

---

## 四、API 路由汇总

| 路由 | 方法 | 功能 | 文件 |
|------|------|------|------|
| `/api/auth` | GET/POST | 密码验证 | `app/api/auth/route.ts` |
| `/api/upload` | POST | 图片上传 | `app/api/upload/route.ts` |
| `/api/image/[filename]` | GET | 图片服务 | `app/api/image/[filename]/route.ts` |
| `/api/questions` | GET/PUT/DELETE | 题目CRUD | `app/api/questions/route.ts` |
| `/api/chapters` | GET/POST/PUT/DELETE | 分类CRUD | `app/api/chapters/route.ts` |
| `/api/review` | GET/POST | 复习 | `app/api/review/route.ts` |
| `/api/reanalyze` | POST | 重解析 | `app/api/reanalyze/route.ts` |
| `/api/settings` | GET/POST | 设置 | `app/api/settings/route.ts` |
| `/api/plan-tasks` | GET/POST/PUT/DELETE | 计划任务 | `app/api/plan-tasks/route.ts` |
| `/api/plan-tasks/ai-suggest` | POST | AI建议 | `app/api/plan-tasks/ai-suggest/route.ts` |
| `/api/daily-summaries` | GET/POST | 每日小结 | `app/api/daily-summaries/route.ts` |
| `/api/learning-progress` | GET/POST | 总进度 | `app/api/learning-progress/route.ts` |
| `/api/learning-progress/ai` | POST | AI优化/更新进度 | `app/api/learning-progress/ai/route.ts` |
| `/api/plan` | POST/PUT | (旧版AI生成计划，已废弃) | `app/api/plan/route.ts` |
| `/api/version` | GET | 部署版本号 | `app/api/version/route.ts` |
| `/api/db-status` | GET | 数据库统计 | `app/api/db-status/route.ts` |
| `/api/init` | POST | 初始化 | `app/api/init/route.ts` |

---

## 五、关键技术细节

### 1. 时区处理（重要）
**问题**：`toISOString()` 返回UTC，在中国(UTC+8)导致日期错位/跳跃
**修复**：全部改用本地日期拼接 `yyyy-MM-dd`
**影响文件**：plan/page.tsx, ebbinghaus.ts, plan-tasks/route.ts, daily-summaries/route.ts, review/route.ts, ai-suggest/route.ts, plan/route.ts

### 2. OCR提示词要点
- 去掉题号前缀（"32."、"【2021统考真题】"）
- 忽略手写笔迹（手写答案/演算/批注不识别）
- 行列式/矩阵必须识别为整体LaTeX表达式
- 选择题选项每行一个\n分隔
- JSON内LaTeX反斜杠写成双反斜杠 `\\\\frac`

### 3. 导航方式
全部使用 Next.js `<Link>` 组件实现客户端路由（不刷新页面），保证计时器等状态持久。

### 4. 部署
服务器：43.134.234.119 (CentOS + 宝塔面板)
PM2进程：wrongset(端口3000)、wrongset-demo(端口3001)
Nginx：proxy_cache off，SSL via 宝塔
启动脚本：`wrong.sh`（npm install → db:init → seed:408 → 备份uploads → build → 恢复uploads → pm2 restart）

---

## 六、重建为SpringBoot+Vue的架构建议

### 后端（SpringBoot 3）
```
src/main/java/com/wrongset/
├── config/
│   ├── SecurityConfig.java          # Spring Security + JWT
│   └── AiConfig.java                # AI API配置(从DB读取)
├── controller/
│   ├── AuthController.java          # 登录/注册
│   ├── QuestionController.java      # 题目CRUD
│   ├── ChapterController.java       # 分类树
│   ├── ReviewController.java        # 复习
│   ├── PlanTaskController.java      # 每日计划
│   ├── DailySummaryController.java  # 每日小结
│   ├── LearningProgressController.java # 总进度
│   ├── SettingController.java       # 设置
│   ├── UploadController.java        # 文件上传
│   └── AiController.java            # AI分析/建议
├── service/                         # 业务逻辑
├── repository/                      # JPA Repository
├── model/entity/                    # JPA实体
├── model/dto/                       # 请求/响应DTO
├── util/
│   ├── CryptoUtil.java              # AES加密(ApiKey存储)
│   ├── ImageUtil.java               # 图片缩放/裁剪
│   ├── LatexUtil.java               # LaTeX清理
│   └── EbbinghausUtil.java          # 复习算法
└── ai/
    ├── AiClient.java                # OpenAI兼容API客户端
    └── PromptTemplates.java         # 提示词模板
```

### 前端（保持现有：Next.js 16 + React 18 + TypeScript）
```
src/  (现有项目结构，仅改API调用)
├── lib/
│   ├── ai.ts              → 改为调用后端 /api/v1/analyze
│   ├── math-text.tsx       → ✗ 不变（KaTeX渲染）
│   ├── crop-image.ts       → ✗ 不变（Canvas图片处理）
│   ├── icons.tsx           → ✗ 不变（24个SVG图标）
│   ├── study-timer.tsx     → ✗ 不变（计时器+全屏）
│   ├── global-timer.ts     → ✗ 不变（全局计时器单例）
│   ├── auth-gate.tsx       → 改为调用后端 /api/v1/auth
│   └── crypto-utils.ts     → 移入后端，前端不需要
├── app/
│   ├── upload/page.tsx     → fetch改URL
│   ├── questions/page.tsx  → fetch改URL
│   ├── review/page.tsx     → fetch改URL
│   ├── plan/page.tsx       → fetch改URL（最大改动页面~550行）
│   ├── chapters/page.tsx   → fetch改URL
│   ├── settings/page.tsx   → fetch改URL
│   └── api/                → 全部移除（逻辑移入SpringBoot Controller）
```
