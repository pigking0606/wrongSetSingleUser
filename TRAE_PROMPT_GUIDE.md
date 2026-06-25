# Trae Prompt 编写规范与示例

## 核心原则：一次调用完成一个独立功能

每次给 Trae 的 prompt 应该是一个**可独立编译/运行**的完整单元，不需要跨调用依赖上下文。

---

## 一、Prompt 结构模板

```
【角色】简短一句话定义 Trae 的身份
【输入】参考哪些文件（路径+关键内容摘要）
【任务】要做什么（具体到类名、方法名、字段名）
【约束】必须遵守的规则（技术栈、命名、格式）
【输出】期望产出什么（文件列表+验收方式）
【示例】（可选）期望的代码片段
```

---

## 二、好的 Prompt 示例

### 示例1：创建实体类（优秀）

```
用 SpringBoot 3 + JPA 创建以下实体类，包名 com.wrongset.model：

【Chapter 实体】
- 表名 chapters
- 字段：id(Long,自增), userId(Long,非空), name(String,非空), parentId(Long,可空), level(Integer,默认1), sortOrder(Integer,默认0), createdAt(LocalDateTime)
- parentId 自引用 @ManyToOne → Chapter，级联策略 SET NULL
- 创建 ChapterRepository extends JpaRepository<Chapter, Long>
  方法：List<Chapter> findByUserIdAndLevelOrderBySortOrder(Long userId, Integer level)
        List<Chapter> findByUserIdAndParentIdOrderBySortOrder(Long userId, Long parentId)

【约束】
- 使用 Lombok @Data @NoArgsConstructor
- 时间字段用 LocalDateTime，JPA自动填充
- 所有表加 user_id 实现多用户隔离
- 每个实体一个文件
```

### 示例2：创建 Controller（优秀）

```
创建 QuestionController，包名 com.wrongset.controller：

GET /api/v1/questions — 分页查询
- 参数：userId(从JWT取), subjectId(可选), chapterId(可选), page(默认0), size(默认20)
- 返回：{content: [...], totalElements: N, totalPages: N}
- 按 createdAt 降序
- LEFT JOIN chapters 三级获取 subjectName/chapterName/kpName
- 参考 REFACTOR_DOC.md 第3.9节的筛选逻辑

PUT /api/v1/questions/{id} — 编辑题目
- 请求体字段全部可选：ocrText, questionType, correctAnswer, explanation, chapterId...
- 只更新非 null 字段
- 验证 userId 归属（只能编辑自己的题目）
- 返回更新后的完整 Question 对象

【约束】
- 使用 @PreAuthorize 验证用户身份
- 分页用 Pageable
- 错误返回统一格式 {error: "message"}
```

### 示例3：跨文件功能（优秀）

```
实现 AI 图片分析功能，涉及3个文件：

1. AiClient.java（包 com.wrongset.ai）
   - 用 RestTemplate 封装 OpenAI 兼容 API 调用
   - 构造函数注入 API key/URL（从 DB 读取并解密）
   - 方法：chatCompletion(model, systemPrompt, userContent) → String
   - 超时 180 秒
   - 根据 model 前缀路由 endpoint：deepseek→api.deepseek.com，其他→dashscope.aliyuncs.com

2. PromptTemplates.java（包 com.wrongset.ai）
   - 常量字符串：SYSTEM_PROMPT_VISION（视觉模型系统提示词）
   - 包含：章节树格式化、LaTeX 规范、JSON 格式要求
   - 参考 REFACTOR_DOC.md 3.2节的完整提示词

3. AiService.java（包 com.wrongset.service）
   - analyzeQuestion(imageBase64, mimeType, chapterTree) → AnalysisResult
   - 5步管道：调视觉模型→JSON解析(三层兜底)→AI去重→LaTeX修复→章节匹配
   - 每层独立 try-catch
   - 失败时 question.status='error' + errorReason

【约束】
- 不要用 Lombok builder（用普通构造器+setter）
- 所有 AI 调用记录日志（请求模型名+耗时）
```

---

## 三、坏的 Prompt 示例（避免）

### 坏例1：太模糊
```
帮我创建后端需要的所有接口
```
→ Trae 不知道具体有哪些接口、什么格式、什么参数。

### 坏例2：一次塞太多
```
创建 User, Chapter, Question, ReviewRecord, PlanTask, DailySummary, LearningProgress,
UserSetting 全部实体 + 全部 Controller + 全部 Service + Spring Security + JWT + 文件上传
```
→ 超出单次调用能力，必定遗漏或出错。

### 坏例3：没有约束
```
写一个 Controller 处理题目
```
→ Trae 会自由发挥，可能用错技术栈、命名、返回格式。

---

## 

---



---

## 

```

```
