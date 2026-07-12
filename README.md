# 考研错题自适应刷题系统

基于 Next.js 16 的考研错题管理工具，支持拍照上传、AI 识别分类、多解法解析、LaTeX 数学渲染、艾宾浩斯自适应复习、每日学习计划。

## 开发规范

- **图标**：禁止使用 emoji，统一使用 `@/lib/icons` 中的 SVG Icon 组件（如 `<IconCheck>`、`<IconFileText>` 等）

## 当前进度

### 已完成

| 模块 | 功能 | 状态 |
|---|---|---|
| 项目基础 | Next.js 16 (Turbopack) + TypeScript + MySQL (mysql2/promise) + Tailwind CSS v4 | ✅ |
| 数据库 | 10 张表（banks / chapters / questions / review_records / tags / question_tags / settings / plan_tasks / daily_summaries / learning_progress） | ✅ |
| 科目体系 | 4 科目 82 分类节点，三级层级（科目 → 书本 → 章节） | ✅ |
| 408 | 408 → 数据结构/计组/操作系统/计算机网络 → 24 章节 | ✅ |
| 数学二 | 数学二 → 高等数学(6章)/线性代数(6章) | ✅ |
| 英语二 | 英语二 → 完形填空/阅读理解/翻译/写作 → 11 考点 | ✅ |
| 政治 | 政治 → 马原/毛中特/近现代史/思修法基/形势与政策 → 15 考点 | ✅ |
| AI 分析 | 千问 Qwen-VL-Plus (DashScope)，支持 OCR 识别 + 分类 + 多解法 + 答案解析，可配置模型 | ✅ |
| 拍照上传 | 手机端相机拍照 + 相册选择 + 拖拽上传 + react-image-crop 框选裁剪 + 旋转 | ✅ |
| 题库浏览 | `/questions` 三级级联筛选 + 答案/解析/解法隐藏切换 + filter chips + 删除 + AI重新解析 | ✅ |
| 错题复习 | `/review` 艾宾浩斯遗忘曲线排期 + 对/错二值评分 + 科目/章节/知识点三级筛选 + 题数选择 | ✅ |
| 错误原因 | 上传时编辑错误原因，题库中展示错误原因标签 | ✅ |
| LaTeX 渲染 | KaTeX 渲染全部数学公式（自动识别裸 LaTeX，支持 `$...$` / `$$...$$`） | ✅ |
| 前端美化 | 简约黑白色调 + 护眼模式 + 全中文化 | ✅ |
| 数据统计 | 首页展示科目数、章节数、题目数、复习次数 | ✅ |

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

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化数据库

```bash
npm run db:init
npm run seed:408
```

### 3. 配置 AI（必须）

复制 `.env.local.example` 为 `.env.local`，填入 DashScope API Key：

```env
DASHSCOPE_API_KEY=你的API_Key

# 可选：选择模型（默认 qwen-vl-plus）
# qwen-vl-plus : 性价比首选，OCR+分类+解析，1.5/4.5 元/百万token（推荐）
# qwen-vl-max  : 旗舰版，能力最强，3/9 元/百万token
# qwen-vl-ocr  : 纯OCR专用，最便宜 0.3/0.5 元/百万token
DASHSCOPE_MODEL=qwen-vl-plus
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
| `/upload` | 拍照上传错题，框选裁剪，AI 分析，LaTeX 渲染确认，编辑保存 |
| `/questions` | 题库浏览，三级分类筛选，答案/解析隐藏，删除，AI 重新解析 |
| `/review` | 每日复习，艾宾浩斯排期，对/错评分，科目/章节筛选，题数可调 |

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/init` | 初始化数据库 |
| GET | `/api/db-status` | 数据库统计（题目数/章节数等） |
| GET/POST | `/api/chapters` | 章节列表/新增，支持 `?level=` `?parent_id=` `?tree=true` |
| GET/POST/DELETE | `/api/questions` | 题目列表/新增/删除，支持 `?subject_id=` `?chapter_l2_id=` `?chapter_id=` `?id=` |
| POST | `/api/upload` | 上传图片 → OCR + AI 分类 + 多解法解析 |
| POST | `/api/reanalyze` | 对已有题目用文本模型（qwen-plus）重新 AI 解析 |
| GET | `/api/review?limit=10&subject_id=&chapter_l2_id=` | 获取到期复习题目，支持科目/章节筛选 |
| POST | `/api/review` | 提交复习结果（`correct: true/false`） |

---

## 项目结构

```
src/
├── app/
│   ├── layout.tsx               # 根布局（含 KaTeX CSS）
│   ├── page.tsx                 # 首页
│   ├── upload/page.tsx          # 错题上传（拍照+裁剪+AI分析+LaTeX确认）
│   ├── questions/page.tsx       # 题库浏览（筛选+删除+AI重解析）
│   ├── review/page.tsx          # 每日复习（对/错评分+章节筛选+题数）
│   └── api/
│       ├── init/route.ts
│       ├── db-status/route.ts
│       ├── chapters/route.ts
│       ├── questions/route.ts
│       ├── upload/route.ts
│       ├── review/route.ts
│       └── reanalyze/route.ts
├── lib/
│   ├── db.ts                    # SQLite 连接（sql.js WASM）
│   ├── schema.ts                # 表结构 + 迁移
│   ├── types.ts                 # TypeScript 类型定义
│   ├── ai.ts                    # AI 分析（千问 VL / Mock）+ JSON 解析 + LaTeX 自动包裹
│   ├── ebbinghaus.ts            # 艾宾浩斯间隔重复算法（对/错二值）
│   ├── math-text.tsx            # LaTeX 渲染组件（MathAtom 纯 ref 模式）
│   ├── crop-image.ts            # Canvas 图片裁剪
│   └── upload-utils.ts          # 文件验证/保存
scripts/
├── init-db.mjs                  # 初始化数据库
├── seed-408.mjs                 # 播种科目分类
└── seed-questions.mjs           # 播种样题
data/
└── app.db                       # SQLite 数据库文件
```

---

## 重要说明

**大改动后请更新此 README 文件**，包括：
- 新增/修改的功能模块
- 新增的 API 接口
- 变更的启动步骤
- 待完成任务列表的更新


---

## 部署

### 服务器信息
- **IP**: 43.134.234.119
- **路径**: /www/wwwroot/wrongset
- **PM2**: wrongset (端口 3000)
- **Nginx**: 反向代理到 :3000，`proxy_cache off`，`location /_next/static/` 需代理
- **域名**: 066112.xyz (Cloudflare DNS)

### 自动部署
push 到 `main` 分支后 GitHub Actions 自动执行：
1. SSH 到服务器 → `cd /www/wwwroot/wrongset`
2. `git pull origin main`
3. `bash wrong.sh`（npm install → db:init → seed:408 → build → pm2 restart）

### 手动部署
```bash
ssh root@43.134.234.119
cd /www/wwwroot/wrongset
bash wrong.sh
```

### 注意事项
- 数据库备份：`cp data/app.db /tmp/app.db.backup`
- 构建前清理缓存：`rm -rf .next node_modules/.cache`
- `.env.local` 包含 API Key，已在 .gitignore 中排除