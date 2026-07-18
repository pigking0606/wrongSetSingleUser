"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { IconCamera, IconImage, IconCheck, IconFileText } from "@/lib/icons";
import { cropImage, rotateImage, compressImage, mergeImagesVertical } from "@/lib/crop-image";
import { useAuth, AuthGate } from "@/lib/auth-gate";

type PageState = "idle" | "uploading" | "success" | "error";
type UploadMode = "single" | "twoPage" | "multiCrop";

export default function UploadPage() {
  const { authed, login } = useAuth();
  const [bankId, setBankId] = useState<number>(1);
  const [banks, setBanks] = useState<{id:number;name:string}[]>([]);
  const [state, setState] = useState<PageState>("idle");
  const [userAnswer, setUserAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Crop
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);

  // Two-page mode
  const [mode, setMode] = useState<UploadMode>("single");
  const [page1Blob, setPage1Blob] = useState<Blob | null>(null);
  const [page2Blob, setPage2Blob] = useState<Blob | null>(null);
  const [page1Preview, setPage1Preview] = useState<string | null>(null);
  const [page2Preview, setPage2Preview] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Multi-crop mode (single photo, multiple questions)
    const [twoCropSrc, setTwoCropSrc] = useState<string | null>(null);
  const [twoOriginalFile, setTwoOriginalFile] = useState<File | null>(null);
  const [twoAnswer, setTwoAnswer] = useState("");
  const [twoErrorMsg, setTwoErrorMsg] = useState("");
  const [twoState, setTwoState] = useState<PageState>("idle");

  // Multi-crop mode (single photo, multiple questions)
  const [multiCropSrc, setMultiCropSrc] = useState<string | null>(null);
  const [multiOriginalFile, setMultiOriginalFile] = useState<File | null>(null);
  const [multiCropAnswer, setMultiCropAnswer] = useState("");
  const [multiErrorMsg, setMultiErrorMsg] = useState("");
  const [multiState, setMultiState] = useState<PageState>("idle");
  const [multiCrops, setMultiCrops] = useState<{blob: Blob; preview: string}[]>([]);

  useEffect(() => { fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)}).catch(()=>{}); }, []);

  // ---- File handling ----
  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      if (mode === "single") { setErrorMsg("请选择图片文件"); setState("error"); }
      else if (mode === "twoPage") { setTwoErrorMsg("请选择图片文件"); setTwoState("error"); }
      else { setMultiErrorMsg("请选择图片文件"); setMultiState("error"); }
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      if (mode === "single") { setErrorMsg("文件不能超过 10MB"); setState("error"); }
      else if (mode === "twoPage") { setTwoErrorMsg("文件不能超过 10MB"); setTwoState("error"); }
      else { setMultiErrorMsg("文件不能超过 10MB"); setMultiState("error"); }
      return;
    }
    const src = URL.createObjectURL(f);
    if (mode === "single") {
      setOriginalFile(f); setCropSrc(src); setCropping(true);
      setPreviewUrl(null); setCroppedBlob(null);
      setCrop(undefined); setCompletedCrop(null);
      setState("idle"); setErrorMsg("");
    } else if (mode === "twoPage") {
      setTwoOriginalFile(f); setTwoCropSrc(src); setCropping(true);
      setCrop(undefined); setCompletedCrop(null);
      setTwoState("idle"); setTwoErrorMsg("");
    } else {
      setMultiOriginalFile(f); setMultiCropSrc(src); setCropping(true);
      setCrop(undefined); setCompletedCrop(null);
      setMultiState("idle"); setMultiErrorMsg("");
    }
  }, [mode]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { handleFile(f); e.target.value = ""; }
  }, [handleFile]);

  const handleCropComplete = useCallback((c: PixelCrop) => setCompletedCrop(c), []);

  // Step 1: Crop on frontend → show preview
  const handleDoCrop = async () => {
    if (!completedCrop || !imgRef.current) return;
    if (completedCrop.width < 10 || completedCrop.height < 10) {
      setErrorMsg("请拖动选框选中题目区域"); setState("error");
      return;
    }
    setErrorMsg("");
    try {
      const blob = await cropImage(imgRef.current, completedCrop);
      if (mode === "multiCrop") {
        const preview = URL.createObjectURL(blob);
        setMultiCrops(prev => [...prev, { blob, preview }]);
      } else if (mode === "twoPage") {
        if (currentPage === 1) {
          setPage1Blob(blob); if (page1Preview) URL.revokeObjectURL(page1Preview);
          setPage1Preview(URL.createObjectURL(blob));
        } else {
          setPage2Blob(blob); if (page2Preview) URL.revokeObjectURL(page2Preview);
          setPage2Preview(URL.createObjectURL(blob));
        }
      } else {
        setCroppedBlob(blob);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
      }
      if (mode === "multiCrop") {
        setCropping(false);
        setCrop(undefined); setCompletedCrop(null);
      } else {
        setCropping(false);
        if (mode === "single") {
          if (cropSrc) URL.revokeObjectURL(cropSrc);
          setCropSrc(null); setOriginalFile(null);
        } else if (mode === "twoPage") {
          if (twoCropSrc) URL.revokeObjectURL(twoCropSrc);
          setTwoCropSrc(null); setTwoOriginalFile(null);
        }
      }
    } catch { setErrorMsg("裁剪失败"); }
  };

  // Step 2: User confirms → upload (merge if two-page)
  const handleUpload = async () => {
    setState("uploading"); setErrorMsg("");
    try {
      let finalBlob: Blob;
      if (mode === "multiCrop") {
        if (multiCrops.length === 0) return;
        for (let i = 0; i < multiCrops.length; i++) {
          const comp = await compressImage(multiCrops[i].blob, 2048);
          const fd = new FormData();
          fd.append("image", comp, multiOriginalFile?.name || "upload.jpg"); fd.append("bank_id", String(bankId));
          if (userAnswer.trim()) fd.append("user_answer", userAnswer.trim());
          const r = await fetch("/api/upload", { method: "POST", body: fd });
          if (!r.ok) { setErrorMsg(`第${i+1}题上传失败`); setState("error"); return; }
        }
        multiCrops.forEach(c => URL.revokeObjectURL(c.preview));
        setMultiCrops([]); setState("success"); return;
      }
      if (mode === "twoPage") {
        if (!page1Blob || !page2Blob) { setErrorMsg("请先裁剪两页"); setState("idle"); return; }
        finalBlob = await mergeImagesVertical(page1Blob, page2Blob, 2048);
      } else {
        if (!croppedBlob) return;
        finalBlob = await compressImage(croppedBlob, 2048);
      }
      const formData = new FormData();
      const fileName = (mode === "twoPage" ? twoOriginalFile?.name : originalFile?.name) || "upload.jpg";
      formData.append("image", finalBlob, fileName);
      formData.append("bank_id", String(bankId));
      if (userAnswer.trim()) formData.append("user_answer", userAnswer.trim());

      const resp = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await resp.json();
      if (!resp.ok) { setErrorMsg(data.error || "上传失败"); setState("error"); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null); setCroppedBlob(null);
      setState("success");
    } catch { setErrorMsg("上传失败"); setState("error"); }
  };

  const handleCancelCrop = () => {
    if (mode === "single") {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
      setCropSrc(null); setOriginalFile(null);
      setCropping(false); setPreviewUrl(null); setState("idle");
    } else if (mode === "twoPage") {
      if (twoCropSrc) URL.revokeObjectURL(twoCropSrc);
      setTwoCropSrc(null); setTwoOriginalFile(null);
      setCropping(false); setState("idle");
    } else {
      // 多题框选模式：取消框选时只退出裁剪界面，保留已框选的题目
      // 这样用户能回到「已框选 X 题」的提交页面，继续上传之前的题目
      if (multiCropSrc) URL.revokeObjectURL(multiCropSrc);
      setMultiCropSrc(null); setMultiOriginalFile(null);
      setCrop(undefined); setCompletedCrop(null);
      if (multiCrops.length > 0) {
        // 已有框选：回到多题提交页面（早期 return 分支会渲染 review UI）
        setCropping(false);
      } else {
        // 没有任何框选：回到初始页
        setCropping(false); setState("idle");
      }
    }
  };

  const handleReCrop = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null); setCroppedBlob(null);
    setCropping(true); setCrop(undefined); setCompletedCrop(null);
  };

  const clearFile = () => {
    resetCropState();
  };

  // Clean all crop/image state when switching modes or canceling
  const resetCropState = () => {
    if (cropSrc) { URL.revokeObjectURL(cropSrc); setCropSrc(null); }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setOriginalFile(null); setCroppedBlob(null); setCropping(false);
    setCrop(undefined); setCompletedCrop(null);
    setState("idle"); setErrorMsg("");
  };

  const handleRotate = async (deg: 90 | 180 | 270) => {
    const file = mode === "single" ? originalFile : mode === "twoPage" ? twoOriginalFile : multiOriginalFile;
    if (!file) return;
    try {
      const blob = await rotateImage(file, deg);
      const rotated = new File([blob], file.name, { type: "image/jpeg" });
      if (mode === "single") {
        setOriginalFile(rotated);
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setCropSrc(URL.createObjectURL(blob));
      } else if (mode === "twoPage") {
        setTwoOriginalFile(rotated);
        if (twoCropSrc) URL.revokeObjectURL(twoCropSrc);
        setTwoCropSrc(URL.createObjectURL(blob));
      } else {
        setMultiOriginalFile(rotated);
        if (multiCropSrc) URL.revokeObjectURL(multiCropSrc);
        setMultiCropSrc(URL.createObjectURL(blob));
      }
      setCrop(undefined); setCompletedCrop(null);
    } catch { setErrorMsg("旋转失败"); setState("error"); }
  };

  // ---- MULTI-CROP REVIEW (done cropping, ready to upload all) ----
  if (mode === "multiCrop" && !cropping && multiCrops.length > 0) {
    const removeCrop = (i: number) => {
      URL.revokeObjectURL(multiCrops[i].preview);
      setMultiCrops(prev => prev.filter((_, j) => j !== i));
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>已框选 {multiCrops.length} 题</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
          {multiCrops.map((c, i) => (
            <div key={i} className="card" style={{ display: "flex", alignItems: "center", gap: ".75rem", padding: ".75rem" }}>
              <img src={c.preview} alt={`题目${i+1}`} style={{ height: "4rem", borderRadius: "4px" }} />
              <span style={{ flex: 1, fontSize: ".85rem", fontWeight: 500 }}>题目 {i + 1}</span>
              <span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>{(c.blob.size/1024).toFixed(0)}KB</span>
              <button className="btn" style={{ fontSize: ".7rem", color: "var(--red-text)" }} onClick={() => removeCrop(i)}>删除</button>
            </div>
          ))}
        </div>
        <div className="card">
          <label style={{ fontSize: ".875rem", fontWeight: 500, display: "block", marginBottom: ".25rem" }}>你的答案（选填，所有题共用）</label>
          <input type="text" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="例如：C 或 False" style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        {errorMsg && <div style={{ fontSize: ".8rem", color: "var(--red-text)", textAlign: "center" }}>{errorMsg}</div>}
        <div style={{ display: "flex", gap: ".75rem" }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setCropping(true)}>继续框选</button>
          <button className="btn" style={{ flex: 1, color: "var(--red-text)" }} onClick={() => {
            multiCrops.forEach(c => URL.revokeObjectURL(c.preview));
            setMultiCrops([]); setCropSrc(null); setOriginalFile(null); setState("idle");
          }}>全部取消</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={state === "uploading"} onClick={handleUpload}>
            {state === "uploading" ? "上传中..." : `上传 ${multiCrops.length} 题`}
          </button>
        </div>
      </div>
    );
  }

  // ---- TWO-PAGE PREVIEW (page 1 done, page 2 not yet) ----
  // Only show when NOT actively cropping (i.e., user hasn't taken page 2 photo yet)
  if (mode === "twoPage" && page1Preview && page1Blob && !page2Preview && !cropping) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>第1页已裁剪 <IconCheck size={14} /></h1>
        <div className="card" style={{ padding: ".5rem", textAlign: "center" }}>
          <img src={page1Preview} alt="第1页" style={{ maxWidth: "100%", maxHeight: "30vh", borderRadius: "6px" }} />
        </div>
        <p style={{ fontSize: ".8rem", color: "var(--text-muted)", textAlign: "center" }}>{(page1Blob.size/1024).toFixed(0)} KB</p>
        <div className="card">
          <label style={{ fontSize: ".875rem", fontWeight: 500, display: "block", marginBottom: ".25rem" }}>你的答案（选填）</label>
          <input type="text" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="例如：C 或 False" style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        <div style={{ display: "flex", gap: ".75rem" }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => {
            if (page1Preview) URL.revokeObjectURL(page1Preview);
            setPage1Preview(null); setPage1Blob(null);
            if (twoCropSrc) URL.revokeObjectURL(twoCropSrc); setTwoCropSrc(null); setTwoOriginalFile(null); setCropping(true); setCurrentPage(1);
            setCrop(undefined); setCompletedCrop(null);
            setTimeout(() => cameraInputRef.current?.click(), 0);
          }}>重拍第1页</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => {
            if (twoCropSrc) URL.revokeObjectURL(twoCropSrc); setTwoCropSrc(null); setTwoOriginalFile(null); setCropping(true); setCurrentPage(2); setCrop(undefined); setCompletedCrop(null);
            setTimeout(() => cameraInputRef.current?.click(), 0);
          }}>拍第二页</button>
        </div>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileInput} hidden />
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileInput} hidden />
      </div>
    );
  }

  // ---- TWO-PAGE PREVIEW (both pages done, ready to merge) ----
  if (mode === "twoPage" && page1Preview && page2Preview && page1Blob && page2Blob) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>两页已裁剪 <IconCheck size={14} /></h1>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <img src={page1Preview} alt="第1页" style={{ maxWidth: "100%", maxHeight: "25vh", borderRadius: "6px" }} />
            <p style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>第1页 ({(page1Blob.size/1024).toFixed(0)}KB)</p>
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <img src={page2Preview} alt="第2页" style={{ maxWidth: "100%", maxHeight: "25vh", borderRadius: "6px" }} />
            <p style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>第2页 ({(page2Blob.size/1024).toFixed(0)}KB)</p>
          </div>
        </div>
        <div className="card">
          <label style={{ fontSize: ".875rem", fontWeight: 500, display: "block", marginBottom: ".25rem" }}>你的答案（选填）</label>
          <input type="text" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="例如：C 或 False" style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        {errorMsg && <div style={{ fontSize: ".8rem", color: "var(--red-text)", textAlign: "center" }}>{errorMsg}</div>}
        <div style={{ display: "flex", gap: ".75rem" }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => {
            if (page1Preview) URL.revokeObjectURL(page1Preview);
            if (page2Preview) URL.revokeObjectURL(page2Preview);
            setPage1Preview(null); setPage2Preview(null);
            setPage1Blob(null); setPage2Blob(null);
            setCropping(true); setCurrentPage(1); setCrop(undefined); setCompletedCrop(null);
          }}>重新裁剪</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={state === "uploading"} onClick={handleUpload}>
            {state === "uploading" ? "合并上传中..." : "合并上传"}
          </button>
        </div>
      </div>
    );
  }

  // ---- SINGLE PAGE PREVIEW ----
  if (mode !== "twoPage" && previewUrl && croppedBlob) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>裁剪预览</h1>
        <p style={{ fontSize: ".875rem", color: "var(--text-muted)" }}>确认裁剪区域正确后再上传</p>
        <div className="card" style={{ padding: ".5rem", textAlign: "center" }}>
          <img src={previewUrl} alt="裁剪结果" style={{ maxWidth: "100%", maxHeight: "50vh", borderRadius: "6px" }} />
        </div>
        <p style={{ fontSize: ".8rem", color: "var(--text-muted)", textAlign: "center" }}>
          图片大小：{(croppedBlob.size / 1024).toFixed(0)} KB
        </p>
        <div className="card">
          <label style={{ fontSize: ".875rem", fontWeight: 500, display: "block", marginBottom: ".25rem" }}>你的答案（选填）</label>
          <input type="text" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="例如：C 或 False" style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        {errorMsg && <div style={{ fontSize: ".8rem", color: "var(--red-text)", textAlign: "center" }}>{errorMsg}</div>}
        <div style={{ display: "flex", gap: ".75rem" }}>
          <button className="btn" style={{ flex: 1 }} onClick={handleReCrop}>重新裁剪</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={state === "uploading"} onClick={handleUpload}>
            {state === "uploading" ? "上传中..." : "确认上传"}
          </button>
        </div>
      </div>
    );
  }

  // Auth gate — only render content if authenticated
  if (authed === null) return null;
  if (!authed) return <AuthGate authed={false} onLogin={login}><div /></AuthGate>;

  // ---- CROP UI ----
  const activeCropSrc = mode === "single" ? cropSrc : mode === "twoPage" ? twoCropSrc : multiCropSrc;
  const activeOriginalFile = mode === "single" ? originalFile : mode === "twoPage" ? twoOriginalFile : multiOriginalFile;
  if (cropping && activeCropSrc) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>框选题目区域</h1>
        <p style={{ fontSize: ".875rem", color: "var(--text-muted)" }}>拖动选框选中题目</p>
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "center" }}>
          {([90, 180, 270] as const).map(deg => (
            <button key={deg} className="btn" style={{ fontSize: ".85rem", padding: ".4rem .75rem" }} onClick={() => handleRotate(deg)}>↻ {deg}°</button>
          ))}
        </div>
        <div className="card" style={{ padding: ".5rem", overflow: "hidden" }}>
          <ReactCrop crop={crop} onChange={(c) => setCrop(c)} onComplete={handleCropComplete} aspect={undefined}>
            <img ref={(el) => { imgRef.current = el; }} src={activeCropSrc} alt="裁剪" style={{ maxWidth: "100%", maxHeight: "50vh" }} />
          </ReactCrop>
        </div>
        {multiCrops.length > 0 && (
          <div style={{ fontSize: ".8rem", color: "var(--green-text)", textAlign: "center" }}>
            已框选 {multiCrops.length} 道题目
          </div>
        )}
        {errorMsg && <div style={{ fontSize: ".8rem", color: "var(--red-text)", textAlign: "center" }}>{errorMsg}</div>}
        <div style={{ display: "flex", gap: ".75rem" }}>
          <button className="btn" style={{ flex: 1 }} onClick={handleCancelCrop}>取消</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={!completedCrop?.width} onClick={handleDoCrop}>
            {mode === "multiCrop" ? `框选第 ${multiCrops.length + 1} 题` : "确认裁剪"}
          </button>
        </div>
        {mode === "multiCrop" && multiCrops.length > 0 && (
          <button className="btn btn-success" style={{ padding: ".6rem" }} onClick={() => setCropping(false)}>
            完成框选 ({multiCrops.length} 题)
          </button>
        )}
        <div className="card">
          <label style={{ fontSize: ".875rem", fontWeight: 500, display: "block", marginBottom: ".25rem" }}>你的答案（选填）</label>
          <input type="text" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="例如：C 或 False" style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>
    );
  }

  // ---- SUCCESS ----
  if (state === "success") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div className="card" style={{ textAlign: "center", padding: "2rem", background: "var(--green-bg)", color: "var(--green-text)" }}>
          <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}><IconCheck size={24} /></div>
          <p style={{ fontWeight: 600, margin: 0 }}>题目已保存，AI 正在后台分析</p>
          <p style={{ fontSize: ".8rem", marginTop: ".5rem", opacity: 0.8 }}>分析完成后自动入库，可在题库中查看</p>
          <div style={{ display: "flex", gap: ".75rem", justifyContent: "center", marginTop: "1rem" }}>
            <button className="btn btn-primary" onClick={clearFile}>继续上传</button>
            <Link href="/questions" className="btn">查看题库</Link>
          </div>
        </div>
        <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
      </div>
    );
  }

  // ---- IDLE / ERROR ----
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>上传错题</h1>
        <select value={bankId} onChange={e=>setBankId(parseInt(e.target.value))} style={{fontSize:".75rem"}}>
          {banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {/* Single page: exit any special mode */}
        {(mode !== "single") && (
          <button className="btn" style={{ fontSize: ".75rem" }} onClick={() => {
            if (mode === "multiCrop") {
              multiCrops.forEach(c => URL.revokeObjectURL(c.preview));
              setMultiCrops([]);
              setMode("single");
            }
            if (mode === "twoPage") {
              setMode("single");
              setPage1Blob(null); setPage2Blob(null);
              if (page1Preview) URL.revokeObjectURL(page1Preview);
              if (page2Preview) URL.revokeObjectURL(page2Preview);
              setPage1Preview(null); setPage2Preview(null); setCurrentPage(1);
            }
            resetCropState();
          }}>
            {mode === "multiCrop" ? "退出多题" : "退出双页"}
          </button>
        )}
        {/* Multi-crop toggle */}
        <button className="btn" style={{ fontSize: ".75rem" }} onClick={() => {
          if (mode === "multiCrop") {
            setMode("single");
            multiCrops.forEach(c => URL.revokeObjectURL(c.preview));
            setMultiCrops([]);
            resetCropState();
          } else {
            setMode("multiCrop");
            if (mode === "twoPage") {
              setMode("single");
              setPage1Blob(null); setPage2Blob(null);
              if (page1Preview) URL.revokeObjectURL(page1Preview);
              if (page2Preview) URL.revokeObjectURL(page2Preview);
              setPage1Preview(null); setPage2Preview(null); setCurrentPage(1);
            }
            resetCropState();
          }
        }}>
          {mode === "multiCrop" ? <span>多题框选 <IconCheck size={14} /></span> : "多题框选"}
        </button>
        {/* Two-page toggle */}
        <button className="btn" style={{ fontSize: ".75rem" }} onClick={() => {
          if (mode === "twoPage") {
            setMode("single");
            setPage1Blob(null); setPage2Blob(null);
            if (page1Preview) URL.revokeObjectURL(page1Preview);
            if (page2Preview) URL.revokeObjectURL(page2Preview);
            setPage1Preview(null); setPage2Preview(null); setCurrentPage(1);
            resetCropState();
          } else {
            setMode("twoPage");
            if (mode === "multiCrop") {
              setMode("single");
              multiCrops.forEach(c => URL.revokeObjectURL(c.preview));
              setMultiCrops([]);
            }
            resetCropState();
          }
        }}>
          {mode === "twoPage" ? <span>双页合成 <IconCheck size={14} /></span> : "双页合成"}
        </button>
      </div>
      {mode === "twoPage" && <p style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>双页模式：拍第一页裁剪 → 拍第二页裁剪 → 自动合并上传</p>}

      <div style={{ display: "flex", gap: ".75rem" }}>
        <button className="btn btn-primary" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: ".3rem" }} onClick={() => cameraInputRef.current?.click()}><IconCamera size={16} /> 拍照</button>
        <button className="btn" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: ".3rem" }} onClick={() => fileInputRef.current?.click()}><IconImage size={16} /> 选择图片</button>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileInput} hidden />
      </div>

      <div
        onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()}
        className="card" style={{ borderStyle: "dashed", textAlign: "center", cursor: "pointer" }}
      >
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileInput} hidden />
        <div style={{ color: "var(--text-muted)", padding: "1.5rem 0" }}>
          <div style={{ fontSize: "2rem", marginBottom: ".5rem", display: "flex", justifyContent: "center" }}><IconCamera size={32} /></div>
          <div style={{ fontSize: ".875rem" }}>拖拽图片到这里</div>
          <div style={{ fontSize: ".75rem", marginTop: ".25rem" }}>或点击选择 (PNG / JPG, 最大 10MB)</div>
        </div>
      </div>

      <div className="card">
        <label style={{ fontSize: ".875rem", fontWeight: 500, display: "block", marginBottom: ".25rem" }}>你的答案（选填）</label>
        <input type="text" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="例如：C 或 False" style={{ width: "100%", boxSizing: "border-box" }} />
      </div>

      {state === "error" && errorMsg && (
        <div className="card" style={{ borderColor: "var(--red-text)", background: "var(--red-bg)", color: "var(--red-text)", fontSize: ".875rem" }}>
          {errorMsg}
          <button className="btn" style={{ marginLeft: ".5rem", fontSize: ".8rem" }} onClick={() => setState("idle")}>关闭</button>
        </div>
      )}

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
