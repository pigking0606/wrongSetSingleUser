# 错题复习系统 — Trae 重构初始化

## 项目目标
将现有 Next.js 16 单体应用重构为 SpringBoot 3 + Next.js 前后端分离的多用户考研错题管理系统。

## 技术栈
- 后端：SpringBoot 3.x + Spring Security + JWT + JPA + MySQL
- 前端：**保持现有技术栈不变** — Next.js 16 + TypeScript + React 18 + KaTeX + Tailwind CSS v4
- AI模型：DashScope (qwen-vl-plus/qwen-plus) + DeepSeek (deepseek-chat)
- 图片处理：Java端用Thumbnailator或ImageMagick，前端用Canvas

## 项目约定
- 后端命名：Java驼峰
- 前端命名：React组件用PascalCase，hooks用useXxx，工具函数用camelCase
- API路径：RESTful风格 `/api/v1/...`
- 多用户：所有数据表加 `user_id`，API从JWT中提取当前用户
- API Key加密存储：AES-256-GCM，密钥从配置文件读取
- 时区：统一使用服务器本地时间，日期格式 `yyyy-MM-dd`（前端坚决不用toISOString()）
- 前端导航：Next.js `<Link>` 客户端路由，不刷新页面
- 状态管理：模块级单例 + React Context（计时器等跨页面状态）
- 防御性编程：所有AI调用有超时(180s)，每层独立try-catch
- 部署：jar包 + nginx反向代理 + SSL
- **前端现有代码可直接复用**：所有组件、图标、KaTeX渲染、图片裁剪、计时器逻辑已成熟，仅需改为调用SpringBoot API

## 包含文件
- `REFACTOR_DOC.md` — 完整的功能→代码映射文档，每个功能的实现细节
- `src/` — 原始 Next.js 项目源码
- `.env.local` — 环境变量（含API Key，重构时注意保密）

## 对话历史关键点（按优先级）
1. LaTeX公式渲染用了3层修复管道（prompt约束→AI修复→正则清理），重构时务必保留
2. 时区处理：绝对不要用 `toISOString()`，用本地日期拼字符串
3. 计时系统需要跨页面持久（Vue中用Pinia store + 模块级单例）
4. 上传支持三种模式：单页、多题框选、双页拼接
5. API Key在DB中加密存储，读取时自动解密
6. 后台AI分析是fire-and-forget，上传后立即返回，分析在后台完成
7. 所有写操作需要口令验证（前端按钮隐藏+后端API拦截）
8. AI建议任务是展示卡片让用户选择采纳，不是自动创建
9. 昨日未完成任务在今日页面顶部提示（只读，不自动合并）
10. 计时结束后保存到DB，下次开始从累计值继续叠加
