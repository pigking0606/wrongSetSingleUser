import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const questions = [
  // ---- 408 数据结构 ----
  {
    path: ["408", "数据结构", "栈和队列"],
    ocr_text: "设栈的初始状态为空，元素 1,2,3,4,5,6 依次入栈，在入栈过程中允许出栈，则不可能得到的出栈序列是（  ）\nA. 3,2,5,6,4,1\nB. 1,5,4,6,2,3\nC. 2,4,3,6,5,1\nD. 4,5,3,6,2,1",
    question_type: "single_choice",
    correct_answer: "B",
    explanation: "选项B中，2在3之前出栈，但入栈顺序为1,2,3,4,5,6。若2先于3出栈，则2出栈后3仍在栈内；序列要求2之后为3，而元素2已离开，不可能再出现3紧随其后。验证：1入→1出；5,4,6需2-5均已入栈，此时栈内为2,3,4,5→5出→4出→6入→6出→此时栈内为2,3→必须3先出、2后出，但序列要求2在3前，矛盾。",
    ai_solutions: [
      { name: "排除法", steps: ["从入栈顺序1~6依次检查每个选项", "模拟栈操作：能出栈仅当元素在栈顶", "A项模拟通过", "B项模拟发现2先于3出栈后不可逆", "C、D项模拟通过"], answer: "B" },
      { name: "卡特兰数验证法", steps: ["n=6时合法出栈序列数为C(12,6)/7=132", "检查B中2→3的出栈顺序是否满足LIFO约束", "2出栈后栈内[3,4,5,...]，下一个出栈必须是3", "B选项2之后是5，违反栈约束"], answer: "B" },
    ],
    user_answer: "A",
    error_reason: "没有掌握栈的LIFO性质，错误认为A选项不可能",
  },
  {
    path: ["408", "数据结构", "线性表"],
    ocr_text: "在一个具有 $n$ 个结点的有序单链表中插入一个新结点并仍然保持有序的时间复杂度是（  ）\nA. $O(1)$\nB. $O(n)$\nC. $O(n^2)$\nD. $O(n\\log_2 n)$",
    question_type: "single_choice",
    correct_answer: "B",
    explanation: "有序单链表插入需先找到插入位置。单链表只能顺序查找，最坏需遍历 $n$ 个结点，时间复杂度 $O(n)$。找到位置后插入操作本身为 $O(1)$，总复杂度为 $O(n)$。",
    ai_solutions: [
      { name: "分步分析法", steps: ["定位：找到第一个大于新结点的位置，最坏 $O(n)$", "插入：修改指针，$O(1)$", "总复杂度 $\\max(O(n), O(1)) = O(n)$"], answer: "B" },
    ],
    user_answer: "A",
    error_reason: "误以为链表插入总是O(1)，忽略了查找插入位置的开销",
  },
  // ---- 408 计算机组成原理 ----
  {
    path: ["408", "计算机组成原理", "数据的表示和运算"],
    ocr_text: "某计算机字长为32位，按字节编址，采用小端方式存储。若从地址0x1000开始存储int型变量x=0x12345678，则地址0x1001中的内容是（  ）\nA. 0x12\nB. 0x34\nC. 0x56\nD. 0x78",
    question_type: "single_choice",
    correct_answer: "C",
    explanation: "小端方式：低字节存低地址。0x12345678字节从低到高为：0x78,0x56,0x34,0x12。起始地址0x1000存0x78，0x1001存0x56。故选C。",
    ai_solutions: [
      { name: "字节拆分法", steps: ["0x12345678按字节拆分：最低0x78,次低0x56,次高0x34,最高0x12", "小端：低地址←低字节", "0x1000→0x78,0x1001→0x56"], answer: "C" },
    ],
    user_answer: "D",
    error_reason: "混淆了大端和小端的存储方式",
  },
  // ---- 408 操作系统 ----
  {
    path: ["408", "操作系统", "进程管理"],
    ocr_text: "操作系统中，死锁产生的四个必要条件不包括（  ）\nA. 互斥条件\nB. 请求和保持条件\nC. 不可抢占条件\nD. 循环使用条件",
    question_type: "single_choice",
    correct_answer: "D",
    explanation: "死锁四个必要条件：互斥条件、请求和保持条件、不可抢占条件、循环等待条件。'循环使用条件'不是死锁的必要条件，正确表述应为'循环等待条件'。",
    ai_solutions: [
      { name: "死锁四条件记忆法", steps: ["互斥：资源只能被一个进程独占", "请求保持：持有资源的同时请求新资源", "不可抢占：已分配资源不能被强制剥夺", "循环等待：存在进程-资源循环等待链", "D表述错误"], answer: "D" },
    ],
    user_answer: "C",
    error_reason: "对死锁四个必要条件的记忆不准确",
  },
  // ---- 408 计算机网络 ----
  {
    path: ["408", "计算机网络", "传输层"],
    ocr_text: "在TCP/IP协议栈中，传输层协议TCP和UDP的共用端口号范围是（  ）\nA. 0～255\nB. 0～1023\nC. 0～65535\nD. 1024～49151",
    question_type: "single_choice",
    correct_answer: "C",
    explanation: "端口号字段为16位，取值范围0～65535。TCP和UDP均可使用完整范围。0～1023为熟知端口，1024～49151为注册端口，49152～65535为动态端口。",
    ai_solutions: [
      { name: "端口号分类法", steps: ["端口号16位=2¹⁶=65536(0~65535)", "熟知端口0~1023", "注册端口1024~49151", "动态端口49152~65535", "TCP/UDP均使用相同端口号空间"], answer: "C" },
    ],
    user_answer: "B",
    error_reason: "只记住了熟知端口范围，忽略了端口号完整的16位范围",
  },
  // ---- 数学二 ----
  {
    path: ["数学二", "高等数学", "函数、极限、连续"],
    ocr_text: "求极限：$\\lim_{x\\to 0} \\frac{e^x - 1 - x}{x^2} =$ (  )\nA. $0$\nB. $\\frac{1}{2}$\nC. $1$\nD. $2$",
    question_type: "single_choice",
    correct_answer: "B",
    explanation: "当 $x\\to 0$ 时，$e^x = 1 + x + \\frac{x^2}{2!} + \\cdots$，代入分子：$e^x-1-x = \\frac{x^2}{2}+O(x^3)$。因此 $\\frac{e^x-1-x}{x^2} = \\frac{1}{2}+O(x)\\to\\frac{1}{2}$。也可使用洛必达法则连续两次求导。",
    ai_solutions: [
      { name: "泰勒展开法", steps: ["$e^x = 1+x+\\frac{x^2}{2!}+\\cdots$", "分子 $= \\frac{x^2}{2}+o(x^2)$", "除以 $x^2$ 得 $\\frac{1}{2}+o(1)$", "极限为 $\\frac{1}{2}$"], answer: "$\\frac{1}{2}$" },
      { name: "洛必达法则（两次）", steps: ["原式 $\\frac{0}{0}$ 型，第一次洛必达：$\\lim\\frac{e^x-1}{2x}$", "仍 $\\frac{0}{0}$，第二次洛必达：$\\lim\\frac{e^x}{2}$", "$x\\to 0$ 时 $e^x\\to 1$，极限 $=\\frac{1}{2}$"], answer: "$\\frac{1}{2}$" },
    ],
    user_answer: "A",
    error_reason: "错误使用了等价无穷小替换，忽略了高阶项",
  },
  {
    path: ["数学二", "线性代数", "行列式"],
    ocr_text: "设 $A$ 为 3 阶方阵，且 $|A|=2$，则 $|2A^*|=$ (  )\nA. $8$\nB. $16$\nC. $32$\nD. $64$",
    question_type: "single_choice",
    correct_answer: "C",
    explanation: "根据伴随矩阵性质：$A\\cdot A^*=|A|\\cdot E$，因此 $A^*=|A|\\cdot A^{-1}$。$|A^*|=|A|^{n-1}=2^2=4$（$n=3$）。$|2A^*|=2^3\\cdot|A^*|=8\\times 4=32$。",
    ai_solutions: [
      { name: "公式推导法", steps: ["$A\\cdot A^*=|A|E$，两边取行列式", "$|A|\\cdot|A^*|=|A|^n$，即 $|A^*|=|A|^{n-1}$", "$n=3,\\ |A|=2$，得 $|A^*|=4$", "$|2A^*|=2^3\\cdot|A^*|=32$"], answer: "$32$" },
    ],
    user_answer: "B",
    error_reason: "计算|2A*|时，忘记系数2对3阶行列式产生2³=8倍的影响",
  },
  {
    path: ["数学二", "高等数学", "常微分方程"],
    ocr_text: "求微分方程 $\\frac{dy}{dx} + \\frac{y}{x} = x^2$ 的通解。",
    question_type: "fill_blank",
    correct_answer: "$y = \\frac{x^3}{4} + \\frac{C}{x}$",
    explanation: "标准一阶线性形式：$y'+\\frac{1}{x}y=x^2$，$P(x)=\\frac{1}{x}$，$Q(x)=x^2$。通解公式：$y=e^{-\\int Pdx}[\\int Q\\cdot e^{\\int Pdx}dx+C]$。$\\int Pdx=\\ln|x|$，$e^{\\int Pdx}=x$。$y=\\frac{1}{x}[\\int x^3dx+C]=\\frac{x^3}{4}+\\frac{C}{x}$。",
    ai_solutions: [
      { name: "积分因子法", steps: ["$P(x)=\\frac{1}{x}$，积分因子 $\\mu(x)=e^{\\int\\frac{1}{x}dx}=x$", "方程 $\\times x$：$x\\cdot y'+y=x^3$，即 $\\frac{d}{dx}(xy)=x^3$", "积分得 $xy=\\frac{x^4}{4}+C$", "通解：$y=\\frac{x^3}{4}+\\frac{C}{x}$"], answer: "$y = \\frac{x^3}{4} + \\frac{C}{x}$" },
    ],
  },
  // ---- 英语二 ----
  {
    path: ["英语二", "阅读理解", "推理判断题"],
    ocr_text: "It can be inferred from the passage that the author's attitude toward AI in education is one of ______.\nA. unconditional enthusiasm\nB. cautious optimism\nC. complete skepticism\nD. indifferent acceptance",
    question_type: "single_choice",
    correct_answer: "B",
    explanation: "推理判断题考查根据原文进行合理推断。题干'inferred'和'attitude'表明考查作者态度。学术文章通常保持客观中立，极少出现unconditional或complete等极端态度词。正确选项为cautious optimism（谨慎乐观）。",
    ai_solutions: [
      { name: "态度词定位法", steps: ["定位AI in education相关段落", "标注正面词汇(promising, potential)+转折词(however, concerns)", "权衡正负面词汇权重", "得出cautiously optimistic"], answer: "B" },
      { name: "选项排除法", steps: ["A极端语气，排除", "C文中提到benefits，并非完全怀疑", "D作者有明确态度，并非漠不关心", "B正面+保留，最符合学术风格"], answer: "B" },
    ],
    user_answer: "A",
    error_reason: "只关注到正面描述忽略了转折后的限制条件",
  },
  {
    path: ["英语二", "完形填空", "语法结构"],
    ocr_text: "The committee has reached a decision, but its details ______ to the public yet.\nA. haven't been released\nB. weren't released\nC. hadn't been released\nD. won't be released",
    question_type: "single_choice",
    correct_answer: "A",
    explanation: "yet常与现在完成时连用表示'到目前为止尚未...'。details与release是被动关系。因此用现在完成时被动语态haven't been released。",
    ai_solutions: [
      { name: "语法标记词法", steps: ["识别关键词'yet'——现在完成时标志词", "主语details与release为被动关系", "现在完成时被动：have/has been done", "details复数用have→haven't been released"], answer: "A" },
    ],
    user_answer: "B",
    error_reason: "忽略yet是现在完成时的标志词，误用了一般过去时",
  },
  // ---- 政治 ----
  {
    path: ["政治", "马克思主义基本原理", "唯物辩证法"],
    ocr_text: "唯物辩证法的总特征是（  ）\nA. 量变和质变\nB. 对立统一\nC. 联系和发展\nD. 否定之否定",
    question_type: "single_choice",
    correct_answer: "C",
    explanation: "唯物辩证法的总特征是联系的观点和发展的观点。A项量变和质变、B项对立统一、D项否定之否定是唯物辩证法的三大规律，而非总特征。",
    ai_solutions: [
      { name: "概念辨析法", steps: ["唯物辩证法包含：总特征+基本规律+基本范畴", "总特征：联系和发展的观点", "三大规律：对立统一、量变质变、否定之否定"], answer: "C" },
    ],
    user_answer: "B",
    error_reason: "混淆了唯物辩证法的总特征和核心规律（对立统一）",
  },
  {
    path: ["政治", "中国近现代史纲要", "新民主主义革命时期"],
    ocr_text: "新民主主义革命的总路线是（  ）\nA. 无产阶级领导的，人民大众的，反对帝国主义、封建主义和官僚资本主义的革命\nB. 无产阶级领导的，工农联盟为基础的，反对资产阶级的革命\nC. 资产阶级领导的，反对封建主义的革命\nD. 无产阶级领导的，反对一切剥削阶级的革命",
    question_type: "single_choice",
    correct_answer: "A",
    explanation: "新民主主义革命总路线：无产阶级领导的，人民大众的，反对帝国主义、封建主义和官僚资本主义的革命。这是1948年毛泽东在《在晋绥干部会议上的讲话》中的完整表述。",
    ai_solutions: [
      { name: "四要素记忆法", steps: ["领导：无产阶级（共产党）", "动力：人民大众", "对象：帝国主义、封建主义、官僚资本主义", "性质：资产阶级民主主义革命（新式的）", "对应A完全正确"], answer: "A" },
    ],
  },
];

async function main() {
  const initSqlJs = require("sql.js").default;
  const DB_PATH = path.join(__dirname, "..", "data", "app.db");

  if (!fs.existsSync(DB_PATH)) {
    console.error("Database not found. Run `npm run db:init` and `npm run seed:408` first.");
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  // Delete old questions (which have stale chapter FK references)
  db.run("DELETE FROM questions");
  db.run("DELETE FROM review_records");

  let count = 0;

  const insertStmt = db.prepare(`
    INSERT INTO questions (chapter_id, image_path, ocr_text, question_type, correct_answer, explanation, ai_solutions, user_answer, error_reason)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Get chapter ID by hierarchy path
  function findChapterId(namePath) {
    // Find Level 1
    let stmt = db.prepare(`SELECT id FROM chapters WHERE level=1 AND name=?`);
    stmt.bind([namePath[0]]);
    if (!stmt.step()) { stmt.free(); return null; }
    const l1Id = stmt.getAsObject().id;
    stmt.free();

    // Find Level 2
    stmt = db.prepare(`SELECT id FROM chapters WHERE level=2 AND parent_id=? AND name=?`);
    stmt.bind([l1Id, namePath[1]]);
    if (!stmt.step()) { stmt.free(); return null; }
    const l2Id = stmt.getAsObject().id;
    stmt.free();

    // Find Level 3
    stmt = db.prepare(`SELECT id FROM chapters WHERE level=3 AND parent_id=? AND name=?`);
    stmt.bind([l2Id, namePath[2]]);
    if (!stmt.step()) { stmt.free(); return null; }
    const l3Id = stmt.getAsObject().id;
    stmt.free();

    return l3Id;
  }

  for (const q of questions) {
    const chapterId = findChapterId(q.path);
    if (!chapterId) {
      console.error(`Chapter not found: ${q.path.join(" > ")}`);
      continue;
    }

    insertStmt.run([
      chapterId,
      q.ocr_text,
      q.question_type,
      q.correct_answer,
      q.explanation || null,
      q.ai_solutions ? JSON.stringify(q.ai_solutions) : null,
      q.user_answer || null,
      q.error_reason || null,
    ]);
    count++;
  }

  insertStmt.free();

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log(`Seeded ${count} questions across all subjects.`);
}

main().catch(console.error);
