"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { IconQuote, IconUpload, IconRefresh, IconClipboard, IconList, IconFolder } from "@/lib/icons";

interface DbStats { questionCount: number; chapterCount: number; subjectCount: number; reviewCount: number; }

const QUOTES = [
  "路虽远，行则将至；事虽难，做则必成。",
  "每一个不曾起舞的日子，都是对生命的辜负。 — 尼采",
  "天行健，君子以自强不息。 — 《周易》",
  "不积跬步，无以至千里；不积小流，无以成江海。 — 荀子",
  "宝剑锋从磨砺出，梅花香自苦寒来。",
  "长风破浪会有时，直挂云帆济沧海。 — 李白",
  "业精于勤，荒于嬉；行成于思，毁于随。 — 韩愈",
  "莫等闲，白了少年头，空悲切。 — 岳飞",
  "千淘万漉虽辛苦，吹尽狂沙始到金。 — 刘禹锡",
  "书山有路勤为径，学海无涯苦作舟。",
  "博观而约取，厚积而薄发。 — 苏轼",
  "志之所趋，无远弗届，穷山距海，不能限也。",
  "星光不问赶路人，时光不负有心人。",
  "你的坚持，终将美好。",
  "乾坤未定，你我皆是黑马。",
  "既然选择了远方，便只顾风雨兼程。",
  "今天翻的书，就是明天数的钱。",
  "最困难之时，就是离成功不远之日。 — 拿破仑",
  "日拱一卒，功不唐捐。",
  "与其临渊羡鱼，不如退而结网。",
  "成功的路上并不拥挤，因为坚持的人不多。",
  "你不是在考试，你是在奔赴更好的自己。",
  "熬过无人问津的日子，才能拥抱诗和远方。",
  "看似不起眼的日复一日，会在将来的某天让你看到坚持的意义。",
  "没有一蹴而就的成功，只有厚积薄发的努力。",
  "今天所有的努力，都是未来惊喜的铺垫。",
  "放弃不难，但坚持一定很酷。",
  "你所热爱的，总有一天会反过来拥抱你。",
  "无人做你的光芒，就自己照亮前方。",
  "与其仰望星空，不如脚踏实地。",
  "将来的你，一定会感谢现在拼命的自己。",
];

export default function Home() {
  const [dbStatus, setDbStatus] = useState<string>("检测中...");
  const [stats, setStats] = useState<DbStats | null>(null);

  const quote = useMemo(() => {
    const today = new Date();
    const idx = (today.getFullYear() * 365 + today.getMonth() * 31 + today.getDate()) % QUOTES.length;
    return QUOTES[idx];
  }, []);

  useEffect(() => {
    fetch("/api/init", { method: "POST" })
      .then((r) => r.json())
      .then((data) => setDbStatus(data.ok ? "已连接" : "错误"))
      .catch(() => setDbStatus("错误"));
    fetch("/api/db-status")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Hero */}
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>错题复习</h1>
        <p style={{ color: "var(--text-muted)", fontSize: ".875rem", marginTop: ".25rem" }}>
          拍照上传错题，AI 自动识别分类，艾宾浩斯自适应复习
        </p>
      </div>

      {/* Daily Quote */}
      <div className="card" style={{
        textAlign: "center", padding: "1rem 1.25rem",
        background: "linear-gradient(135deg, var(--green-bg), var(--yellow-bg))",
        display: "flex", alignItems: "center", justifyContent: "center", gap: ".5rem",
      }}>
        <IconQuote size={20} />
        <p style={{ fontSize: ".95rem", fontWeight: 600, color: "var(--text)", margin: 0, lineHeight: 1.7 }}>
          {quote}
        </p>
      </div>

      {/* Stats */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".75rem" }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: dbStatus === "已连接" ? "var(--green-text)" : dbStatus === "错误" ? "var(--red-text)" : "#c90"
          }} />
          <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
            数据库：{dbStatus}
          </span>
        </div>
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: ".75rem", textAlign: "center" }}>
            {[
              { n: stats.subjectCount, label: "科目" },
              { n: stats.chapterCount, label: "章节" },
              { n: stats.questionCount, label: "题目" },
              { n: stats.reviewCount, label: "复习" },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text)" }}>{s.n}</div>
                <div style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nav */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: ".75rem" }}>
        {[
          { href: "/upload", title: "上传错题", desc: "拍照 / 裁剪 / AI 分析", icon: <IconUpload size={20} /> },
          { href: "/review", title: "每日复习", desc: "艾宾浩斯间隔复习", icon: <IconRefresh size={20} /> },
          { href: "/plan", title: "考研计划", desc: "每日任务 + 小结 + AI 建议", icon: <IconClipboard size={20} /> },
          { href: "/questions", title: "题库浏览", desc: "筛选 / 删除 / 重解析", icon: <IconList size={20} /> },
          { href: "/chapters", title: "分类管理", desc: "科目 / 章节 / 知识点", icon: <IconFolder size={20} /> },
          { href: "/daily-questions", title: "每日新题", desc: "当日新增错题汇总", icon: <IconList size={20} /> },
        ].map(item => (
          <Link key={item.href} href={item.href} className="card" style={{ textDecoration: "none", transition: "transform .15s" }}>
            <div style={{ marginBottom: ".35rem" }}>{item.icon}</div>
            <div style={{ fontWeight: 600, fontSize: ".9rem", color: "var(--text)" }}>{item.title}</div>
            <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: ".25rem" }}>{item.desc}</div>
          </Link>
        ))}
      </div>

    </div>
  );
}
