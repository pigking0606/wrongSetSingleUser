# Trae 重构提示词


参考文档：`REFACTOR_DOC.md`（完整功能映射）和 `TREA.md`（项目初始化信息）

> **前端技术栈保持现有不变**：Next.js 16 + TypeScript + React 18 + KaTeX + Tailwind CSS v4
> 前端现有代码（组件、图标、KaTeX渲染、图片裁剪、计时器等）可直接复用，主要改动是 API 调用从本地 SQLite 改为远程 SpringBoot。

---

## 阶段0：后端项目初始化

```
用SpringBoot3+JPA+MySQL初始化后端项目，包名com.wrongset。
创建以下JPA实体（含userId实现多用户）：
1. User(id, username, password, createdAt)
2. Chapter(id, userId, name, parentId, level, sortOrder, createdAt) — 三级树，parentId自引用
3. Question(id, userId, chapterId FK→Chapter, imagePath, ocrText, questionType, correctAnswer, explanation, aiSolutions TEXT, userAnswer, errorReason, status, createdAt)
4. ReviewRecord(id, userId, questionId FK→Question, reviewDate, score, easeFactor, intervalDays, nextReviewDate, createdAt)
5. PlanTask(id, userId, taskDate, chapterId, title, description, completionPct, difficulty, timeSpent, status, sortOrder, createdAt, completedAt)
6. DailySummary(id, userId, summaryDate UNIQUE+userId, content, createdAt)
7. LearningProgress(id CHECK=1, userId, content, updatedAt)
8. UserSetting(id, userId, settingKey, settingValue) — key+userId联合唯一
所有表要有对应的JPA Repository接口。
同时创建Spring Security+JWT的基础配置。
```

```
在后端创建CryptoUtil.java：AES-256-GCM加解密工具类。
加密：随机16字节IV → AES-256-GCM → "enc:base64IV:base64Cipher:base64Tag"
解密：检测"enc:"前缀 → 解析解密 → 向后兼容返回明文
密钥从配置文件app.encryption-key读取，SHA-256派生32字节key。
```

---

## 阶段1：用户系统

```
后端：创建UserController和AuthController。
POST /api/v1/auth/register — 注册(username+password, BCrypt)
POST /api/v1/auth/login — 登录，返回JWT(含userId+username，7天过期)
所有API通过Spring Security过滤器验证JWT（除auth和公开资源外）。
```

```
前端：修改现有auth-gate.tsx，改为调用SpringBoot的登录API。
保持现有AuthGate组件和useAuth hook结构不变，只改API endpoint。
添加登录页面（简单表单），token存localStorage。
所有fetch请求添加Authorization: Bearer header。
```

---

## 阶段2：分类管理

```
后端：ChapterController完整CRUD。
GET /api/v1/chapters — 返回当前用户的三级树(按level+sortOrder排序)
POST /api/v1/chapters — 创建{name, parentId, level}
PUT /api/v1/chapters/{id} — 重命名
DELETE /api/v1/chapters/{id} — 删除
```

```
前端：chapters/page.tsx 改为调用SpringBoot API。
现有组件和树形展示逻辑完全复用，只改fetch URL。
```

---

## 阶段3：图片上传+AI分析

```
后端：UploadController。
POST /api/v1/upload — multipart图片，Thumbnailator缩放(2048px/quality 85)，
保存到磁盘uploads/，创建Question(status='pending')，
启动后台线程调用AI分析管道，立即返回questionId。
```

```
后端：AiClient.java（OpenAI兼容API客户端）。
支持多endpoint(deepseek/dashscope)，根据model前缀自动路由。
从DB读取当前用户的API Key(解密)、Model、URL。
所有AI调用加180s超时。
```

```
后端：AiService.java + PromptTemplates.java（集中管理所有提示词）。
实现analyzeWrongAnswerImage() 五步管道：
1. 图片base64→视觉模型（系统提示词含章节树）
2. JSON解析（三层兜底：去markdown→搜花括号→原始文本构建）
3. AI去重（删除自我推翻）
4. LaTeX修复三层管道（prompt约束→AI修复→正则清理）
5. 匹配章节树（模糊匹配科目/章节/知识点）
完成后UPDATE status='ready'。
参考REFACTOR_DOC.md 3.2节的所有提示词和细节。
```

```
前端：upload/page.tsx 改为调用SpringBoot API。
现有三种上传模式、裁剪、预览逻辑完全复用，只改API URL。
```

---

## 阶段4：题库管理+重解析

```
后端：QuestionController + ReanalyzeController。
GET /api/v1/questions — 分页+筛选(subjectId,chapterId,dateFrom,dateTo,page)
PUT /api/v1/questions/{id} — 编辑
DELETE /api/v1/questions/{id} — 删除（含图片文件+复习记录）
POST /api/v1/questions/{id}/reanalyze — {mode:"full"|"answer", reason?}
  设置status='pending'→后台AI分析→成功:'ready'+清除errorReason→失败:'error'+errorReason
  full模式必须发送图片！(不要因为已有OCR就只发文本)
GET /api/v1/image/{filename} — 从磁盘读取图片返回
参考REFACTOR_DOC.md 3.3节。
```

```
前端：questions/page.tsx 改为调用SpringBoot API。
现有筛选、分页、编辑弹窗、重解析逻辑完全复用。
```

---

## 阶段5：艾宾浩斯复习

```
后端：ReviewController。
GET /api/v1/review/due — 待复习(筛选subjectId,chapterId,limit)
  查review_records.next_review_date<=today OR 从未复习
POST /api/v1/review/{questionId} — {correct:bool}
  正确→interval×easeFactor, ease×1.3
  错误→interval=1, ease=max(1.3, ease-0.2)
参考REFACTOR_DOC.md 3.6节。
```

```
前端：review/page.tsx 改为调用SpringBoot API。
现有筛选、复习流程、图片切换、口令保护完全复用。
```

---

## 阶段6：每日学习计划

```
后端：PlanTaskController + DailySummaryController + LearningProgressController。
GET /api/v1/plan-tasks?date=... — 若是今天，额外返回yesterdayIncomplete
POST/PUT/DELETE — 任务CRUD
GET /api/v1/plan-tasks/stats — {streak, avgPct, avgDifficulty}
GET/POST /api/v1/daily-summaries
GET/POST /api/v1/learning-progress
POST /api/v1/learning-progress/ai — {mode:"optimize"|"update"}
  update：查updatedAt至今的所有小结+任务→AI更新
POST /api/v1/plan-tasks/ai-suggest — AI生成今日建议(返回JSON，不自动创建)
参考REFACTOR_DOC.md 3.7节。
```

```
前端：plan/page.tsx 改为调用SpringBoot API。
现有日期导航、统计、任务卡片、滑块、计时、小结、AI建议采纳等全部逻辑完全复用。
这个页面~550行，是改动量最大的页面，但代码结构不变，只改fetch URL。
```

---

## 阶段7：设置+加密

```
后端：SettingController。
GET /api/v1/settings — 返回解密后的Key+Model+URL
POST /api/v1/settings — Key字段加密存储，Model/URL明文存储
```

```
前端：settings/page.tsx 改为调用SpringBoot API。
现有两张卡片布局和输入框完全复用。
```

---

## 阶段8：前端收尾

```
前端全局改动：
1. 所有fetch URL从 /api/xxx 改为 /api/v1/xxx
2. 所有fetch添加 credentials + Authorization header
3. 确认所有 <a href> 都是 Next.js <Link>（客户端路由）
4. 确认 global-timer.ts 跨页面持久化正常
5. 确认三个主题切换正常
6. 确认 KaTeX CSS 已加载
```



---

## 验收清单

- [ ] 注册+登录+JWT
- [ ] 上传图片→后台AI分析→题库展示
- [ ] 重解析（全量/仅答案）
- [ ] 复习→对错评分→艾宾浩斯间隔
- [ ] 每日计划→任务+计时+小结+AI建议
- [ ] 总进度→AI优化+AI更新
- [ ] 分类树CRUD
- [ ] 设置保存（加密）→即时生效
- [ ] 主题切换（日间/夜间/护眼）
- [ ] 多用户数据隔离
- [ ] 操作口令保护写操作
- [ ] 计时跨页面持久

## 关键坑位

1. **时区**：Java用LocalDate.now()，前端用本地日期拼字符串，永不使用toISOString()
2. **LaTeX**：AI prompt强调JSON内反斜杠双写\\\\frac，三层修复管道必须保留
3. **重解析**：全量模式必须发图片给视觉模型，不要因为有旧OCR就只发文本
4. **计时器**：全局单例模块级变量，React组件通过useEffect订阅
5. **导航**：Next.js <Link>客户端路由（不可<a href>整页刷新）
6. **AI超时**：所有fetch带180s AbortController
7. **防重复**：提交按钮用useRef防double click
8. **权限**：前端conditional render + 后端@PreAuthorize双重保护
9. **API Key加密**：DB存储加密，读取时解密，明文兼容
10. **完成度自动停计时**：滑块到100%触发globalTimer.stop()
