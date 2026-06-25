export async function rotateImage(file: File, degrees: 90 | 180 | 270): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = URL.createObjectURL(file);
  });

  const canvas = document.createElement("canvas");

  if (degrees === 90 || degrees === 270) {
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
  } else {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
  }

  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  URL.revokeObjectURL(img.src);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob returned null"));
    }, "image/jpeg", 0.92);
  });
}

/** Resize image to max pixels while keeping aspect ratio */
export async function compressImage(file: File | Blob, maxDim = 1024): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = URL.createObjectURL(file);
  });

  const { naturalWidth: w, naturalHeight: h } = img;
  const ratio = Math.min(maxDim / w, maxDim / h, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob failed"));
    }, "image/jpeg", 0.85);
  });
}

export async function cropImage(
  image: HTMLImageElement,
  crop: { x: number; y: number; width: number; height: number }
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  canvas.width = crop.width * scaleX;
  canvas.height = crop.height * scaleY;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    crop.x * scaleX, crop.y * scaleY,
    crop.width * scaleX, crop.height * scaleY,
    0, 0, canvas.width, canvas.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      },
      "image/jpeg", 0.92
    );
  });
}

/** Merge two images vertically (for two-page questions) */
export async function mergeImagesVertical(blob1: Blob, blob2: Blob, maxWidth = 2048): Promise<Blob> {
  const loadImg = (blob: Blob) => new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image(); el.onload = () => resolve(el); el.onerror = reject;
    el.src = URL.createObjectURL(blob);
  });
  const [img1, img2] = await Promise.all([loadImg(blob1), loadImg(blob2)]);
  const scale = Math.min(maxWidth / Math.max(img1.naturalWidth, img2.naturalWidth), 1);
  const w1 = Math.round(img1.naturalWidth * scale), h1 = Math.round(img1.naturalHeight * scale);
  const w2 = Math.round(img2.naturalWidth * scale), h2 = Math.round(img2.naturalHeight * scale);
  const cw = Math.max(w1, w2), ch = h1 + h2;
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img1, (cw - w1) / 2, 0, w1, h1);
  ctx.drawImage(img2, (cw - w2) / 2, h1, w2, h2);
  URL.revokeObjectURL(img1.src); URL.revokeObjectURL(img2.src);
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("merge failed")), "image/jpeg", 0.9);
  });
}
