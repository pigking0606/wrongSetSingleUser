import { NextRequest, NextResponse } from "next/server";

// PUT: AI analyzes task completion and updates the self-intro progress
export async function PUT(req: NextRequest) {
  const { selfIntro, plan } = await req.json();

  const completed = plan.days.flatMap((d: any) =>
    d.tasks.filter((t: any) => t.done).map((t: any) => `[${d.label}] ${t.text}`)
  );
  const pending = plan.days.flatMap((d: any) =>
    d.tasks.filter((t: any) => !t.done).map((t: any) => `[${d.label}] ${t.text}`)
  );

  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ updated: selfIntro });
  }

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);

    const prompt = `你是考研进度管理助手。根据学生的任务完成情况，更新他们的学习进度描述。

原始进度描述：
${selfIntro}

已完成任务（共${completed.length}项）：
${completed.join("\n") || "无"}

未完成任务（共${pending.length}项）：
${pending.join("\n") || "无"}

请根据任务完成情况更新进度描述。规则：
- 在原始描述基础上修改各科进度（如"660题做到第4章"→"660题做到第6章"）
- 保留原格式和语气
- 只更新进度数字，不编造未提及的内容
- 返回纯文本，不要JSON，不要解释`;

    const resp = await fetch(getPlanApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.TEXT_MODEL || "deepseek-chat",
        max_tokens: 1024, temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    const data = await resp.json();
    const updated = data.choices?.[0]?.message?.content?.trim() || selfIntro;
    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json({ updated: selfIntro });
  }
}

function getPlanApiUrl(): string {
  const m = process.env.TEXT_MODEL || "";
  return m.startsWith("deepseek") ? "https://api.deepseek.com/v1/chat/completions"
    : "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

export async function POST(req: NextRequest) {
  const { profile, days = 7 } = await req.json();

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ plan: simplePlan(profile, days) });
  }

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20000);

    const prompt = `你是考研全年规划专家。请根据学生情况生成未来${days}天的每日学习计划。

学生自述：
${profile.selfIntro || "未填写"}

要求：
- 返回纯JSON（不要markdown包裹）
- 每天4-6个具体任务
- 任务要具体可执行（如"完成660题第3章选择题"而非"做数学题"）
- 合理安排各科目轮换
- 每周安排1天休息
- estimated是预估分钟数

JSON格式：
{
  "summary": "一句话总结本周重点",
  "days": [
    {
      "date": "2026-06-20",
      "label": "第1天 6月20日 周六",
      "tasks": [
        {"id":1,"text":"具体任务","done":false,"estimated":45},
        {"id":2,"text":"...","done":false,"estimated":30}
      ],
      "tips": ["今日建议"]
    }
  ]
}`;

    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY || apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.TEXT_MODEL || "deepseek-chat",
        max_tokens: 4096,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || "").replace(/^```[\s\S]*?\n/, "").replace(/\n```\s*$/, "").trim();
    const plan = JSON.parse(raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{")));
    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ plan: simplePlan(profile, days) });
  }
}

function simplePlan(profile: any, days: number) {
  const dayList = [];
  for (let d = 0; d < days; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const dow = ["周日","周一","周二","周三","周四","周五","周六"][dt.getDay()];
    const isRest = dow === "周日";
    dayList.push({
      date: `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`,
      label: `第${d+1}天 ${dt.getMonth()+1}月${dt.getDate()}日 ${dow}${isRest ? " (休息日)" : ""}`,
      tasks: isRest ? [{ id: 1, text: "休息放松，简单回顾本周所学", done: false, estimated: 30 }] : [
        { id: 1, text: "英语：背单词30个 + 阅读理解1篇", done: false, estimated: 45 },
        { id: 2, text: "数学：完成当日习题", done: false, estimated: 60 },
        { id: 3, text: "专业课：复习1个章节", done: false, estimated: 60 },
        { id: 4, text: "政治/408：刷题30道", done: false, estimated: 40 },
        { id: 5, text: "整理错题 + 回顾笔记", done: false, estimated: 30 },
      ],
      tips: ["保持专注，番茄钟25+5节奏"],
    });
  }
  return { summary: `考研备考计划 · 共${days}天`, days: dayList };
}
