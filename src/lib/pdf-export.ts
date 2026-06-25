import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export interface PdfQuestion {
  ocr_text: string;
  correct_answer: string;
  explanation: string | null;
  question_type: string;
  subject_name: string | null;
  chapter_name: string | null;
  kp_name: string | null;
  image_path: string | null;
}

const MATH_SUBJECTS = ["高数", "线代", "高等数学", "线性代数", "数学"];

function isMathSubject(subjectName: string | null): boolean {
  if (!subjectName) return false;
  return MATH_SUBJECTS.some(s => subjectName!.includes(s));
}

function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") { lines.push(""); continue; }
    const split = doc.splitTextToSize(paragraph, maxWidth);
    if (Array.isArray(split)) lines.push(...split);
    else lines.push(split as string);
  }
  return lines;
}

/**
 * Build HTML string for all questions. Uses browser-native CJK font rendering.
 */
function buildQuestionsHtml(
  questions: PdfQuestion[],
  includeAnswers: boolean,
  title: string
): string {
  const lines: string[] = [];
  lines.push(`<div style="font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Hiragino Sans GB', sans-serif; font-size: 14px; color: #222; line-height: 1.7; width: 750px; padding: 20px 30px; background: #fff;">`);
  lines.push(`<h2 style="font-size: 20px; margin: 0 0 4px 0;">${escHtml(title)}</h2>`);
  lines.push(`<p style="font-size: 12px; color: #888; margin: 0 0 16px 0;">共 ${questions.length} 题 · 导出时间：${new Date().toLocaleString("zh-CN")}</p>`);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const mathMode = isMathSubject(q.subject_name);
    const header = `${q.subject_name || ""}${q.chapter_name ? " > " + q.chapter_name : ""}${q.kp_name ? " > " + q.kp_name : ""}`;

    lines.push(`<div style="margin-bottom: 16px; border-bottom: 1px solid #ddd; padding-bottom: 12px;">`);
    // Header
    lines.push(`<div style="font-size: 11px; color: #888; margin-bottom: 4px;">【${i + 1}】${escHtml(header)} · ${escHtml(q.question_type)}</div>`);
    // Question body
    lines.push(`<div style="font-size: 14px; color: #111; margin-bottom: 6px; white-space: pre-wrap;">${escHtml(q.ocr_text || "(无题干文字)")}</div>`);

    // Answer
    if (includeAnswers) {
      lines.push(`<div style="font-size: 13px; color: #2a7d2a; margin-bottom: 4px;">答案：${escHtml(q.correct_answer || "(无)")}</div>`);
      if (q.explanation) {
        lines.push(`<div style="font-size: 12px; color: #555; white-space: pre-wrap;">解析：${escHtml(q.explanation)}</div>`);
      }
    }

    // Writing space for math subjects
    if (mathMode) {
      lines.push(`<div style="margin-top: 8px;">`);
      for (let s = 0; s < 8; s++) {
        lines.push(`<div style="border-bottom: 1px solid #e0e0e0; height: 28px;"></div>`);
      }
      lines.push(`</div>`);
    }

    lines.push(`</div>`);
  }

  lines.push(`</div>`);
  return lines.join("\n");
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Export questions to PDF using html2canvas for proper CJK font rendering.
 */
export async function exportQuestionsPdf(
  questions: PdfQuestion[],
  filename: string,
  includeAnswers: boolean,
  title: string
) {
  const html = buildQuestionsHtml(questions, includeAnswers, title);

  // Create off-screen container
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "810px"; // 750 + 30*2 padding
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    // Render to canvas via html2canvas (browser handles CJK fonts natively)
    const canvas = await html2canvas(container.firstElementChild as HTMLElement, {
      scale: 2, // 2x for sharper text
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    // A4 at 96dpi ≈ 794 x 1123 px; with scale=2 → 1588 x 2246
    // We slice the tall canvas into A4 pages
    const pageWidth = canvas.width;
    const pageHeight = Math.round(pageWidth * 1.414); // A4 ratio

    const doc = new jsPDF("p", "mm", "a4");
    const pdfWidth = 210;
    const pdfHeight = 297;

    let srcY = 0;
    let pageNum = 0;

    while (srcY < canvas.height) {
      if (pageNum > 0) doc.addPage();

      const sliceHeight = Math.min(pageHeight, canvas.height - srcY);

      // Create a slice canvas
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = pageWidth;
      sliceCanvas.height = sliceHeight;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, srcY, pageWidth, sliceHeight, 0, 0, pageWidth, sliceHeight);

      doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", 0, 0, pdfWidth, (sliceHeight / pageWidth) * pdfWidth);
      srcY += pageHeight;
      pageNum++;
    }

    doc.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}