import { jsPDF } from "jspdf";

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
 * Export questions to PDF.
 * @param questions Array of questions
 * @param filename Output filename
 * @param includeAnswers Whether to include answers/explanations
 * @param title PDF title
 */
export async function exportQuestionsPdf(
  questions: PdfQuestion[],
  filename: string,
  includeAnswers: boolean,
  title: string
) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageW = 190; // usable width in mm
  const marginX = 10;
  let y = 15;

  // Title
  doc.setFontSize(14);
  doc.text(title, marginX, y);
  y += 8;
  doc.setFontSize(9);
  doc.text(`共 ${questions.length} 题 · 导出时间：${new Date().toLocaleString("zh-CN")}`, marginX, y);
  y += 10;

  doc.setFontSize(10);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const mathMode = isMathSubject(q.subject_name);

    // Check if we need a new page (at least 30mm remaining)
    if (y > 260) {
      doc.addPage();
      y = 15;
    }

    // Question header
    const header = `【${i + 1}】${q.subject_name || ""}${q.chapter_name ? " > " + q.chapter_name : ""} · ${q.question_type}`;
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(header, marginX, y);
    y += 5;

    // Question body
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    const lines = wrapText(doc, q.ocr_text || "(无题干文字)", pageW);
    for (const line of lines) {
      if (y > 270) { doc.addPage(); y = 15; }
      doc.text(line, marginX, y);
      y += 5.5;
    }
    y += 2;

    // Answer (if requested)
    if (includeAnswers) {
      doc.setFontSize(9);
      doc.setTextColor(0, 100, 0);
      const ansLines = wrapText(doc, `答案：${q.correct_answer || "(无)"}`, pageW - 5);
      for (const line of ansLines) {
        if (y > 270) { doc.addPage(); y = 15; }
        doc.text(line, marginX + 3, y);
        y += 5;
      }
      if (q.explanation) {
        doc.setTextColor(80, 80, 80);
        const expLines = wrapText(doc, `解析：${q.explanation}`, pageW - 5);
        for (const line of expLines) {
          if (y > 270) { doc.addPage(); y = 15; }
          doc.text(line, marginX + 3, y);
          y += 5;
        }
      }
      doc.setTextColor(0, 0, 0);
      y += 2;
    }

    // Writing space for math subjects
    if (mathMode) {
      const spaceLines = 8;
      const spaceHeight = spaceLines * 5.5;
      if (y + spaceHeight > 270) {
        doc.addPage();
        y = 15;
      }
      doc.setDrawColor(200, 200, 200);
      for (let s = 0; s < spaceLines; s++) {
        doc.line(marginX, y, marginX + pageW, y);
        y += 5.5;
      }
      y += 1;
    }

    // Separator between questions
    y += 2;
    doc.setDrawColor(180, 180, 180);
    doc.line(marginX, y, marginX + pageW, y);
    y += 6;
  }

  doc.save(filename);
}