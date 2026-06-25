# 错题复习 — 考研错题AI分析系统

## 技术栈
- Next.js 16 (Turbopack) + TypeScript + App Router
- SQLite via sql.js (WASM, 服务器内存DB + 文件持久化)
- KaTeX 数学公式渲染
- DashScope API (qwen3.6-flash 图片识别 + qwen-plus 格式修复)
- sharp 服务端图片裁剪
- Tailwind CSS v4 + 自定义主题 (日间/夜间/护眼)

## 项目结构
```
src/
├── lib/
│   ├── ai.ts              # AI分析核心：提示词、解析、3层LaTeX修复管道
│   ├── analyze-pipeline.ts # 后台分析管道 performAnalysis()
│   ├── math-text.tsx       # KaTeX渲染组件 (MathAtom + MathText)
│   ├── db.ts              # sql.js DB连接
│   ├── schema.ts          # 数据库表结构 (initSchema)
│   ├── crop-image.ts      # 裁剪/旋转/压缩 (cropImage, rotateImage, compressImage)
│   ├── ebbinghaus.ts      # 艾宾浩斯复习算法
│   └── upload-utils.ts    # 文件上传保存工具
├── app/
│   ├── layout.tsx         # 根布局 (主题切换, 版本轮询)
│   ├── page.tsx           # 首页
│   ├── globals.css        # 全局样式 + 主题变量
│   ├── upload/            # 上传页 (拍照→裁剪→预览→上传)
│   ├── questions/         # 题库页 (筛选/编辑/重解析)
│   ├── review/            # 复习页
│   ├── chapters/          # 分类管理 (科目/章节/知识点)
│   └── api/
│       ├── upload/        # 上传 (sharp缩放 → 后台AI分析)
│       ├── analyze/       # AI分析 (手动触发)
│       ├── reanalyze/     # 重解析 (full/answer两种模式，后台运行)
│       ├── questions/     # 题目CRUD
│       ├── chapters/      # 分类CRUD
│       ├── review/        # 复习计划
│       └── image/[filename]/ # 图片API (绕过Next.js静态文件限制)
└── scripts/
    ├── init-db.mjs        # 初始化数据库 (现加载已有DB再添加表)
    └── seed-408.mjs       # 填充408科目体系 (已存在则跳过)
```

## 关键配置
- `.env.local`: DASHSCOPE_API_KEY + DASHSCOPE_MODEL
- `next.config.ts`: serverExternalPackages: ["sql.js", "sharp"]
- `wrong.sh`: 部署脚本 (npm install → db:init → seed:408 → build → pm2 restart)
- 服务器: 43.134.234.119, PM2进程wrongset, nginx代理到:3000, Cloudflare DNS

## AI分析管道 (5步)
```
JSON解析 → AI精简去重(qwen-plus) → L1+3: LaTeX包裹+清理 → L2: AI LaTeX修复 → L3: 清理兜底
```

## 上传流程 (3步)
```
选图 → 框选裁剪 → 预览确认 → 上传(前端裁剪Blob+压缩2048px, 服务端sharp缩放)
```

## 重要规则
- 数据库备份: 每次部署前 `cp data/app.db /tmp/app.db.backup`
- 构建缓存: `rm -rf .next node_modules/.cache` 后构建
- nginx: proxy_cache off 防缓存, location /_next/static/ 需代理
- 不要删除已有prompt内容，新增/修改需确认
- 部署前需用户确认
