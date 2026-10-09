/**
 * Secure and memory-efficient file utilities for document handling,
 * image compression, and Base64 conversion.
 */
import { jsPDF } from 'jspdf';

export interface ProcessedDocument {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  base64: string;
  isImage: boolean;
  deskewAngle?: number;
  isDeskewed?: boolean;
  isBinarized?: boolean;
  binarizedDataUrl?: string;
  binarizedBase64?: string;
}

export interface DocumentPreprocessingOptions {
  enableDeskew?: boolean;
  enableIlluminationNormalization?: boolean;
  enableContrastEnhancement?: boolean;
  enableAdaptiveBinarization?: boolean;
  enableSharpening?: boolean;
  enableDespeckle?: boolean;
  preserveColorStamps?: boolean;
  maxDimension?: number;
  targetQuality?: number;
  maxDeskewAngle?: number;
}

export interface OcrPreprocessingResult {
  dataUrl: string;
  base64: string;
  width: number;
  height: number;
  deskewAngle: number;
  isDeskewed: boolean;
  illuminationNormalized: boolean;
  contrastEnhanced: boolean;
  sharpened: boolean;
  noiseReduced: boolean;
  binarizedDataUrl?: string;
  binarizedBase64?: string;
  processingTimeMs?: number;
}

/**
 * Detects document skew angle and rotates the canvas to level text lines.
 * Uses horizontal edge gradient projection profile variance across angles [-25°, +25°].
 * Efficiently computes projection profiles using coordinate transformations on active edge points.
 * Automatically samples document corner paper color to seamlessly blend rotated borders.
 */
export function detectAndDeskewCanvas(
  sourceCanvas: HTMLCanvasElement, 
  maxAngle: number = 25
): { canvas: HTMLCanvasElement; angle: number; isDeskewed: boolean } {
  try {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    if (sw < 50 || sh < 50) {
      return { canvas: sourceCanvas, angle: 0, isDeskewed: false };
    }

    // 1. Create a downsampled grayscale edge map for fast projection analysis
    const thumbMaxDim = 480;
    const scale = Math.min(thumbMaxDim / sw, thumbMaxDim / sh, 1);
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(sh * scale));

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = tw;
    thumbCanvas.height = th;
    const tctx = thumbCanvas.getContext('2d', { willReadFrequently: true });
    if (!tctx) return { canvas: sourceCanvas, angle: 0, isDeskewed: false };

    tctx.drawImage(sourceCanvas, 0, 0, tw, th);
    const imgData = tctx.getImageData(0, 0, tw, th);
    const d = imgData.data;

    // Convert to grayscale luminance
    const lum = new Uint8Array(tw * th);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      lum[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }

    // Compute vertical gradient (horizontal text line edges)
    // and collect coordinates of active edge points
    const edgeCoordsX: number[] = [];
    const edgeCoordsY: number[] = [];
    const edgeThreshold = 24;

    for (let y = 1; y < th - 1; y++) {
      const rowOffset = y * tw;
      const prevRow = (y - 1) * tw;
      const nextRow = (y + 1) * tw;
      for (let x = 1; x < tw - 1; x++) {
        const gradY = Math.abs(lum[nextRow + x] - lum[prevRow + x]);
        if (gradY > edgeThreshold) {
          edgeCoordsX.push(x);
          edgeCoordsY.push(y);
        }
      }
    }

    const numEdges = edgeCoordsX.length;
    if (numEdges < 250) {
      // Too few edge features to reliably determine skew
      return { canvas: sourceCanvas, angle: 0, isDeskewed: false };
    }

    const centerX = tw / 2;
    const centerY = th / 2;
    const profile = new Float64Array(th);

    const computeProfileVariance = (angleDeg: number): number => {
      const rad = (angleDeg * Math.PI) / 180;
      const sinA = Math.sin(rad);
      const cosA = Math.cos(rad);
      profile.fill(0);

      for (let i = 0; i < numEdges; i++) {
        const dx = edgeCoordsX[i] - centerX;
        const dy = edgeCoordsY[i] - centerY;
        // Project onto rotated vertical axis
        const rotY = Math.round(-dx * sinA + dy * cosA + centerY);
        if (rotY >= 0 && rotY < th) {
          profile[rotY]++;
        }
      }

      // Calculate variance of the row profile
      let sum = 0;
      for (let y = 0; y < th; y++) sum += profile[y];
      const mean = sum / th;
      let variance = 0;
      for (let y = 0; y < th; y++) {
        const diff = profile[y] - mean;
        variance += diff * diff;
      }
      return variance;
    };

    // 2. Coarse search [-maxAngle to +maxAngle in steps of 1.0 degree]
    let bestAngle = 0;
    let maxVariance = computeProfileVariance(0);
    const zeroVariance = maxVariance;

    const angleLimit = Math.min(30, Math.max(5, maxAngle));
    for (let a = -angleLimit; a <= angleLimit; a += 1) {
      if (a === 0) continue;
      const v = computeProfileVariance(a);
      if (v > maxVariance) {
        maxVariance = v;
        bestAngle = a;
      }
    }

    // 3. Fine search around bestAngle [-1.0 to +1.0 in steps of 0.1 degrees]
    let refinedAngle = bestAngle;
    const fineStart = Math.max(-angleLimit, bestAngle - 1);
    const fineEnd = Math.min(angleLimit, bestAngle + 1);

    for (let a = fineStart; a <= fineEnd; a += 0.1) {
      const v = computeProfileVariance(a);
      if (v > maxVariance) {
        maxVariance = v;
        refinedAngle = a;
      }
    }

    // 4. Threshold check: require meaningful variance improvement (> 8% peak over baseline)
    const varianceGain = zeroVariance > 0 ? maxVariance / zeroVariance : 1;
    const roundedAngle = Math.round(refinedAngle * 10) / 10;

    if (Math.abs(roundedAngle) < 0.3 || varianceGain < 1.08) {
      // Skew angle negligible or confidence low, keep original
      return { canvas: sourceCanvas, angle: 0, isDeskewed: false };
    }

    // 5. Correct skew on full-resolution canvas
    const rotRad = (-roundedAngle * Math.PI) / 180;
    const cosR = Math.abs(Math.cos(rotRad));
    const sinR = Math.abs(Math.sin(rotRad));

    const newW = Math.round(sw * cosR + sh * sinR);
    const newH = Math.round(sw * sinR + sh * cosR);

    const deskewedCanvas = document.createElement('canvas');
    deskewedCanvas.width = newW;
    deskewedCanvas.height = newH;
    const dctx = deskewedCanvas.getContext('2d', { willReadFrequently: true });
    if (!dctx) return { canvas: sourceCanvas, angle: 0, isDeskewed: false };

    // Sample border paper color to prevent contrasting edge seams
    let borderFill = '#ffffff';
    const sctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (sctx) {
      try {
        const c1 = sctx.getImageData(2, 2, 1, 1).data;
        const c2 = sctx.getImageData(Math.max(0, sw - 3), 2, 1, 1).data;
        const c3 = sctx.getImageData(2, Math.max(0, sh - 3), 1, 1).data;
        const c4 = sctx.getImageData(Math.max(0, sw - 3), Math.max(0, sh - 3), 1, 1).data;
        const rAvg = Math.round((c1[0] + c2[0] + c3[0] + c4[0]) / 4);
        const gAvg = Math.round((c1[1] + c2[1] + c3[1] + c4[1]) / 4);
        const bAvg = Math.round((c1[2] + c2[2] + c3[2] + c4[2]) / 4);
        if (rAvg > 160 && gAvg > 160 && bAvg > 160) {
          borderFill = `rgb(${rAvg},${gAvg},${bAvg})`;
        }
      } catch (_) {}
    }

    // Fill background with sampled clean paper color for rotated borders
    dctx.fillStyle = borderFill;
    dctx.fillRect(0, 0, newW, newH);

    // Apply rotation around center
    dctx.translate(newW / 2, newH / 2);
    dctx.rotate(rotRad);
    dctx.drawImage(sourceCanvas, -sw / 2, -sh / 2);

    return {
      canvas: deskewedCanvas,
      angle: roundedAngle,
      isDeskewed: true
    };
  } catch (err) {
    console.warn("Deskew error, keeping original:", err);
    return { canvas: sourceCanvas, angle: 0, isDeskewed: false };
  }
}

/**
 * Normalizes uneven illumination, removes phone shadows, corner vignettes, and flash glare.
 * Divides the document into an adaptive grid, samples the local paper background,
 * and flattens illumination across the page using smooth bilinear interpolation.
 */
export function normalizeDocumentIllumination(
  ctx: CanvasRenderingContext2D, 
  w: number, 
  h: number
): void {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  const gridCols = 16;
  const gridRows = 16;
  const cellW = Math.max(1, Math.floor(w / gridCols));
  const cellH = Math.max(1, Math.floor(h / gridRows));
  const bgLums: number[][] = [];

  // Sample 88th percentile luminance in each grid cell (representing paper background)
  for (let gy = 0; gy < gridRows; gy++) {
    bgLums[gy] = [];
    for (let gx = 0; gx < gridCols; gx++) {
      const startX = gx * cellW;
      const startY = gy * cellH;
      const endX = Math.min(w, startX + cellW);
      const endY = Math.min(h, startY + cellH);

      const samples: number[] = [];
      for (let y = startY; y < endY; y += 3) {
        const rowOff = y * w;
        for (let x = startX; x < endX; x += 3) {
          const idx = (rowOff + x) * 4;
          const lum = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
          samples.push(lum);
        }
      }

      if (samples.length > 0) {
        samples.sort((a, b) => a - b);
        const pIdx = Math.min(samples.length - 1, Math.floor(samples.length * 0.88));
        bgLums[gy][gx] = samples[pIdx];
      } else {
        bgLums[gy][gx] = 200;
      }
    }
  }

  // Smooth the grid values with 3x3 box filter to prevent boundary artifacts
  const smoothedBg: number[][] = [];
  for (let gy = 0; gy < gridRows; gy++) {
    smoothedBg[gy] = [];
    for (let gx = 0; gx < gridCols; gx++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = gy + dy;
        if (ny >= 0 && ny < gridRows) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx;
            if (nx >= 0 && nx < gridCols) {
              sum += bgLums[ny][nx];
              count++;
            }
          }
        }
      }
      smoothedBg[gy][gx] = sum / count;
    }
  }

  // Bilinear interpolation per pixel to flatten lighting
  const targetBg = 246;
  for (let y = 0; y < h; y++) {
    const gyFloat = (y / cellH) - 0.5;
    const gy0 = Math.max(0, Math.min(gridRows - 1, Math.floor(gyFloat)));
    const gy1 = Math.max(0, Math.min(gridRows - 1, gy0 + 1));
    const ty = Math.max(0, Math.min(1, gyFloat - gy0));
    const rowOffset = y * w;

    for (let x = 0; x < w; x++) {
      const gxFloat = (x / cellW) - 0.5;
      const gx0 = Math.max(0, Math.min(gridCols - 1, Math.floor(gxFloat)));
      const gx1 = Math.max(0, Math.min(gridCols - 1, gx0 + 1));
      const tx = Math.max(0, Math.min(1, gxFloat - gx0));

      const bg0 = smoothedBg[gy0][gx0] * (1 - tx) + smoothedBg[gy0][gx1] * tx;
      const bg1 = smoothedBg[gy1][gx0] * (1 - tx) + smoothedBg[gy1][gx1] * tx;
      const localBg = Math.max(45, bg0 * (1 - ty) + bg1 * ty);

      const factor = targetBg / localBg;
      const idx = (rowOffset + x) * 4;

      let r = d[idx] * factor;
      let g = d[idx + 1] * factor;
      let b = d[idx + 2] * factor;

      d[idx] = Math.min(255, Math.max(0, Math.round(r)));
      d[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      d[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Dynamic S-curve contrast enhancement & Laplacian text edge sharpening.
 * Enhances faint photocopies, carbon duplicate receipts, and dot-matrix invoices.
 */
export function enhanceDocumentContrastAndSharpen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  enableSharpening: boolean = true
): void {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 1. Calculate luminance histogram to determine dynamic range
  const hist = new Int32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    hist[lum]++;
  }

  const totalPixels = w * h;
  let count = 0;
  let p5 = 0;
  let p95 = 255;
  for (let i = 0; i < 256; i++) {
    count += hist[i];
    if (p5 === 0 && count >= totalPixels * 0.05) p5 = i;
    if (count >= totalPixels * 0.95) { p95 = i; break; }
  }

  const range = Math.max(40, p95 - p5);
  const contrastFactor = range < 120 ? 1.45 : range < 160 ? 1.30 : 1.18;

  // Apply tone curve stretching and background paper whitening
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    const isColor = (Math.max(r, g, b) - Math.min(r, g, b)) > 26;

    // Apply S-curve contrast centered at midpoint
    r = (r - 128) * contrastFactor + 128;
    g = (g - 128) * contrastFactor + 128;
    b = (b - 128) * contrastFactor + 128;

    // Paper whitening for non-color pixels (eliminates gray scanner tone)
    if (!isColor && r > 185 && g > 185 && b > 185) {
      r = r + (255 - r) * 0.78;
      g = g + (255 - g) * 0.78;
      b = b + (255 - b) * 0.78;
    }

    d[i] = Math.min(255, Math.max(0, Math.round(r)));
    d[i + 1] = Math.min(255, Math.max(0, Math.round(g)));
    d[i + 2] = Math.min(255, Math.max(0, Math.round(b)));
  }

  // 2. Laplacian text edge sharpening (unsharp masking)
  // Sharpens faint character boundaries, numbers, dates, and small print
  if (enableSharpening && w > 3 && h > 3) {
    const orig = new Uint8Array(d);
    const alpha = 0.38; // Ideal sharpness without ringing artifacts

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      const prevRow = (y - 1) * w;
      const nextRow = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = (row + x) * 4;
        const top = (prevRow + x) * 4;
        const btm = (nextRow + x) * 4;
        const lft = (row + x - 1) * 4;
        const rgt = (row + x + 1) * 4;

        for (let c = 0; c < 3; c++) {
          const centerVal = orig[idx + c];
          const laplacian = 4 * centerVal - (orig[top + c] + orig[btm + c] + orig[lft + c] + orig[rgt + c]);
          const sharpened = centerVal + alpha * laplacian;
          d[idx + c] = Math.min(255, Math.max(0, Math.round(sharpened)));
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Adaptive Sauvola Binarization with Integral Image Optimization.
 * Computes localized thresholding in O(1) time per pixel.
 * Yields razor-sharp character segmentation while preserving colored official stamps.
 * Includes morphological despeckle filter to clean isolated scanner noise.
 */
export function applyAdaptiveSauvolaBinarization(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  preserveColorStamps: boolean = true,
  enableDespeckle: boolean = true
): void {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 1. Build Integral Images: II (sum) and II2 (sum of squares)
  // Use Float64Array to prevent 32-bit integer overflow on large images
  const size = (w + 1) * (h + 1);
  const II = new Float64Array(size);
  const II2 = new Float64Array(size);
  const stride = w + 1;

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    const rowOffset = y * w;
    const iiRowOffset = (y + 1) * stride;
    const iiPrevRowOffset = y * stride;

    for (let x = 0; x < w; x++) {
      const idx = (rowOffset + x) * 4;
      const lum = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
      rowSum += lum;
      rowSumSq += lum * lum;

      const iiIdx = iiRowOffset + (x + 1);
      II[iiIdx] = II[iiPrevRowOffset + (x + 1)] + rowSum;
      II2[iiIdx] = II2[iiPrevRowOffset + (x + 1)] + rowSumSq;
    }
  }

  // 2. Adaptive Sauvola threshold per pixel
  const winRadius = Math.max(12, Math.min(36, Math.round(Math.max(w, h) / 50)));
  const k = 0.18; // Balanced for both heavy ink and faint dot-matrix invoices
  const R = 128;

  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - winRadius);
    const y2 = Math.min(h - 1, y + winRadius);
    const rowOffset = y * w;

    for (let x = 0; x < w; x++) {
      const idx = (rowOffset + x) * 4;
      const r = d[idx];
      const g = d[idx + 1];
      const b = d[idx + 2];

      // Check if pixel is a colored rubber stamp, blue ballpoint signature, or red seal
      if (preserveColorStamps) {
        const colorDiff = Math.max(r, g, b) - Math.min(r, g, b);
        if (colorDiff > 26) {
          // Keep original vivid color stamp pixel
          continue;
        }
      }

      const x1 = Math.max(0, x - winRadius);
      const x2 = Math.min(w - 1, x + winRadius);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      // O(1) rectangle query using integral images
      const idxA = y1 * stride + x1;
      const idxB = y1 * stride + (x2 + 1);
      const idxC = (y2 + 1) * stride + x1;
      const idxD = (y2 + 1) * stride + (x2 + 1);

      const sum = II[idxD] - II[idxB] - II[idxC] + II[idxA];
      const sumSq = II2[idxD] - II2[idxB] - II2[idxC] + II2[idxA];

      const mean = sum / count;
      const variance = Math.max(0, (sumSq / count) - (mean * mean));
      const stdDev = Math.sqrt(variance);

      // Sauvola threshold formula
      const threshold = mean * (1 + k * ((stdDev / R) - 1));
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum < threshold) {
        // Deep black text ink
        d[idx] = 12;
        d[idx + 1] = 12;
        d[idx + 2] = 16;
      } else {
        // Pure bleached paper white
        d[idx] = 255;
        d[idx + 1] = 255;
        d[idx + 2] = 255;
      }
    }
  }

  // 3. Morphological Despeckle / Salt-and-Pepper Noise Reduction
  if (enableDespeckle && w > 3 && h > 3) {
    const binCopy = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = (row + x) * 4;
        binCopy[row + x] = d[idx] < 128 ? 0 : 255;
      }
    }

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      const prevRow = (y - 1) * w;
      const nextRow = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const pIdx = row + x;
        const curr = binCopy[pIdx];
        const idx = pIdx * 4;

        // Skip color stamp pixels
        if (d[idx] !== d[idx + 1] || d[idx + 1] !== d[idx + 2]) continue;

        let whiteNeighbors = 0;
        if (binCopy[prevRow + x - 1] === 255) whiteNeighbors++;
        if (binCopy[prevRow + x] === 255) whiteNeighbors++;
        if (binCopy[prevRow + x + 1] === 255) whiteNeighbors++;
        if (binCopy[row + x - 1] === 255) whiteNeighbors++;
        if (binCopy[row + x + 1] === 255) whiteNeighbors++;
        if (binCopy[nextRow + x - 1] === 255) whiteNeighbors++;
        if (binCopy[nextRow + x] === 255) whiteNeighbors++;
        if (binCopy[nextRow + x + 1] === 255) whiteNeighbors++;

        if (curr === 0 && whiteNeighbors >= 7) {
          // Isolated black speckle on paper -> bleach to white
          d[idx] = 255;
          d[idx + 1] = 255;
          d[idx + 2] = 255;
        } else if (curr === 255 && whiteNeighbors <= 1) {
          // Isolated white pinhole inside dark ink stroke -> fill ink
          d[idx] = 12;
          d[idx + 1] = 12;
          d[idx + 2] = 16;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Robust master OCR preprocessing pipeline:
 * 1. Image Deskewing (detects and corrects tilt angle via projection profile variance)
 * 2. Adaptive Illumination Normalization (eliminates dark phone shadows & flash hot-spots)
 * 3. Dynamic Contrast & S-curve Sharpening (restores faint carbon copies and dot-matrix text)
 * 4. Adaptive Sauvola Binarization with Stamp Preservation (high-contrast character segmentation)
 */
export async function preprocessDocumentForOcr(
  imageSource: string | HTMLCanvasElement | File | Blob,
  options: DocumentPreprocessingOptions = {}
): Promise<OcrPreprocessingResult> {
  const {
    enableDeskew = true,
    enableIlluminationNormalization = true,
    enableContrastEnhancement = true,
    enableAdaptiveBinarization = true,
    enableSharpening = true,
    enableDespeckle = true,
    preserveColorStamps = true,
    maxDimension = 2048,
    targetQuality = 0.92,
    maxDeskewAngle = 25
  } = options;

  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return new Promise(async (resolve) => {
    try {
      let initialCanvas: HTMLCanvasElement;

      if (imageSource instanceof HTMLCanvasElement) {
        initialCanvas = imageSource;
      } else {
        let srcUrl = '';
        if (typeof imageSource === 'string') {
          if (imageSource.startsWith('data:') || imageSource.startsWith('blob:') || imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
            srcUrl = imageSource;
          } else {
            // Assume raw base64 string
            srcUrl = `data:image/jpeg;base64,${imageSource}`;
          }
        } else if ((imageSource as any) instanceof Blob) {
          srcUrl = URL.createObjectURL(imageSource);
        }

        const img = new Image();
        await new Promise<void>((imgResolve, imgReject) => {
          img.onload = () => imgResolve();
          img.onerror = () => imgReject(new Error('Image failed to load'));
          img.src = srcUrl;
        });

        let w = img.width;
        let h = img.height;
        if (w > maxDimension || h > maxDimension) {
          const ratio = Math.min(maxDimension / w, maxDimension / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        initialCanvas = document.createElement('canvas');
        initialCanvas.width = Math.max(1, w);
        initialCanvas.height = Math.max(1, h);
        const ictx = initialCanvas.getContext('2d', { willReadFrequently: true });
        if (!ictx) throw new Error('Could not create canvas context');
        ictx.drawImage(img, 0, 0, w, h);

        if (srcUrl.startsWith('blob:')) {
          URL.revokeObjectURL(srcUrl);
        }
      }

      // 1. Deskewing stage (projection profile variance analysis across tilt angles)
      let currentCanvas = initialCanvas;
      let detectedAngle = 0;
      let isDeskewed = false;

      if (enableDeskew) {
        const deskewRes = detectAndDeskewCanvas(currentCanvas, maxDeskewAngle);
        currentCanvas = deskewRes.canvas;
        detectedAngle = deskewRes.angle;
        isDeskewed = deskewRes.isDeskewed;
      }

      const cw = currentCanvas.width;
      const ch = currentCanvas.height;
      const ctx = currentCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Could not get working canvas context');

      // 2. Illumination Normalization stage (shadow lifting & glare elimination)
      if (enableIlluminationNormalization) {
        normalizeDocumentIllumination(ctx, cw, ch);
      }

      // 3. Contrast & Tone Curve Enhancement + Laplacian Sharpening stage
      if (enableContrastEnhancement) {
        enhanceDocumentContrastAndSharpen(ctx, cw, ch, enableSharpening);
      }

      // Enhanced visual representation (for UI preview, PDF document generation, and multimodal visual OCR)
      const enhancedDataUrl = currentCanvas.toDataURL('image/jpeg', targetQuality);
      const enhancedComma = enhancedDataUrl.indexOf(',');
      const enhancedBase64 = enhancedComma >= 0 ? enhancedDataUrl.substring(enhancedComma + 1) : '';

      // 4. Binarized representation (ideal for ultra-crisp character segmentation & low-light reads)
      let binarizedDataUrl: string | undefined;
      let binarizedBase64: string | undefined;

      if (enableAdaptiveBinarization) {
        const binCanvas = document.createElement('canvas');
        binCanvas.width = cw;
        binCanvas.height = ch;
        const bctx = binCanvas.getContext('2d', { willReadFrequently: true });
        if (bctx) {
          bctx.drawImage(currentCanvas, 0, 0);
          applyAdaptiveSauvolaBinarization(bctx, cw, ch, preserveColorStamps, enableDespeckle);
          binarizedDataUrl = binCanvas.toDataURL('image/jpeg', targetQuality);
          const binComma = binarizedDataUrl.indexOf(',');
          binarizedBase64 = binComma >= 0 ? binarizedDataUrl.substring(binComma + 1) : '';
        }
      }

      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

      resolve({
        dataUrl: enhancedDataUrl,
        base64: enhancedBase64,
        width: cw,
        height: ch,
        deskewAngle: detectedAngle,
        isDeskewed,
        illuminationNormalized: enableIlluminationNormalization,
        contrastEnhanced: enableContrastEnhancement,
        sharpened: enableSharpening,
        noiseReduced: enableDespeckle,
        binarizedDataUrl,
        binarizedBase64,
        processingTimeMs: Math.round(endTime - startTime)
      });
    } catch (err) {
      console.warn("Preprocessing pipeline fallback:", err);
      const fallbackUrl = typeof imageSource === 'string' ? imageSource : '';
      const fallbackComma = fallbackUrl.indexOf(',');
      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      resolve({
        dataUrl: fallbackUrl,
        base64: fallbackComma >= 0 ? fallbackUrl.substring(fallbackComma + 1) : '',
        width: 1000,
        height: 1000,
        deskewAngle: 0,
        isDeskewed: false,
        illuminationNormalized: false,
        contrastEnhanced: false,
        sharpened: false,
        noiseReduced: false,
        processingTimeMs: Math.round(endTime - startTime)
      });
    }
  });
}

/**
 * Scans and cleans an image using the robust document preprocessing pipeline:
 * - Image deskewing with horizontal line profile variance analysis
 * - Adaptive illumination normalization to eliminate dark shadows & vignettes
 * - Contrast & tone curve optimization for faint carbon copies & thermal slips
 * - Laplacian text sharpening and paper background whitening while preserving stamps
 */
export async function scanAndEnhanceDocumentImage(
  imageSource: string | HTMLCanvasElement,
  options?: DocumentPreprocessingOptions
): Promise<string> {
  const result = await preprocessDocumentForOcr(imageSource, options);
  return result.dataUrl;
}

/**
 * Converts a camera capture, base64 image, or File into a high-fidelity scanned PDF document
 */
export async function convertImageToPdf(
  imageSrc: string | File | Blob, 
  filename: string = 'scanned_doc.pdf',
  enhanceScan: boolean = true
): Promise<{ 
  pdfDataUrl: string; 
  pdfBase64: string; 
  name: string; 
  file: File; 
  size: number;
}> {
  // If imageSrc is File or Blob, convert to Data URL first
  let rawDataUrl: string;
  if (typeof imageSrc === 'string') {
    rawDataUrl = imageSrc;
  } else {
    rawDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(imageSrc);
    });
  }

  // Pre-process & enhance document scan (whitening paper, sharpening ink & stamps)
  const processedImageSrc = enhanceScan ? await scanAndEnhanceDocumentImage(rawDataUrl) : rawDataUrl;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = processedImageSrc;
    img.onload = () => {
      try {
        const isLandscape = img.width > img.height;
        const orientation = isLandscape ? 'landscape' : 'portrait';

        // Build document matching exact image dimensions (prevents pixel scaling blurring)
        const doc = new jsPDF({
          orientation,
          unit: 'px',
          format: [img.width, img.height]
        });
        doc.addImage(processedImageSrc, 'JPEG', 0, 0, img.width, img.height);
        
        const pdfDataUrl = doc.output('datauristring');
        const pdfBlob = doc.output('blob');
        const commaIdx = pdfDataUrl.indexOf(',');
        const pdfBase64 = commaIdx >= 0 ? pdfDataUrl.substring(commaIdx + 1) : '';
        
        // Ensure clean .pdf filename
        let cleanName = filename.replace(/\.[^/.]+$/, "");
        if (!cleanName.toLowerCase().startsWith('scanned_') && !cleanName.toLowerCase().includes('scan')) {
          cleanName = `Scanned_${cleanName}`;
        }
        const pdfFilename = `${cleanName}.pdf`;
        const pdfFile = new File([pdfBlob], pdfFilename, { type: 'application/pdf' });
        
        resolve({
          pdfDataUrl,
          pdfBase64,
          name: pdfFilename,
          file: pdfFile,
          size: pdfBlob.size
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for PDF conversion'));
  });
}

/**
 * Universal Scanner: Scans any camera picture and outputs a compiled PDF File and Data URL
 */
export async function scanCameraCaptureToPdf(
  input: string | File | Blob, 
  suggestedName?: string
): Promise<{ file: File; pdfDataUrl: string; pdfBase64: string; name: string; size: number }> {
  const baseName = suggestedName || `Scanned_Doc_${Date.now()}`;
  return await convertImageToPdf(input, baseName, true);
}

/**
 * Accurately detects MIME type and document nature from filename and declared type.
 * Prevents miscategorizing JPEGs without MIME as PDFs or vice versa.
 */
export function detectMimeType(file: { name?: string; type?: string }): { mimeType: string; isImage: boolean; isPdf: boolean } {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();

  // Check for image by MIME or extension (supporting jfif, tiff, heic, webp, png, bmp, etc.)
  if (
    type.startsWith('image/') ||
    /\.(jpe?g|jfif|png|webp|bmp|gif|heic|heif|tiff?)$/i.test(name)
  ) {
    let mime = type.startsWith('image/') ? type : 'image/jpeg';
    if (name.endsWith('.png')) mime = 'image/png';
    else if (name.endsWith('.webp')) mime = 'image/webp';
    else if (name.endsWith('.gif')) mime = 'image/gif';
    else if (name.endsWith('.bmp')) mime = 'image/bmp';
    else if (/\.(tiff?)$/i.test(name)) mime = 'image/tiff';
    return { mimeType: mime, isImage: true, isPdf: false };
  }

  // Check for PDF
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return { mimeType: 'application/pdf', isImage: false, isPdf: true };
  }

  return { 
    mimeType: type || (name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'), 
    isImage: false, 
    isPdf: type === 'application/pdf' || name.endsWith('.pdf') 
  };
}

/**
 * Compresses and enhances an image or PDF file to maximize OCR readability:
 * - High-resolution preservation (up to 2200px) so fine serials, GD entries, and stamps remain crisp.
 * - Adaptive shadow lifting for low-light smartphone captures.
 * - Dynamic contrast boost for faint photocopies, carbon duplicates, and dot-matrix receipts.
 * - High fidelity (0.92 quality) to avoid blocky compression artifacts around small numbers.
 */
export async function compressAndPrepareFile(file: File): Promise<ProcessedDocument> {
  const { mimeType: defaultMimeType, isImage } = detectMimeType(file);

  if (!isImage) {
    // For PDFs & documents, allow up to 20MB for inline AI extraction
    if (file.size > 20 * 1024 * 1024) {
      console.log(`Document ${file.name} (${Math.round(file.size / 1024)} KB) preserved locally without heavy inline Base64.`);
      return {
        name: file.name,
        type: defaultMimeType,
        size: file.size,
        dataUrl: '',
        base64: '',
        isImage: false,
      };
    }

    try {
      const base64 = await readAsBase64(file, 20 * 1024 * 1024);
      return {
        name: file.name,
        type: defaultMimeType,
        size: file.size,
        dataUrl: '', // Avoid duplicate multi-megabyte string in memory for PDFs
        base64,
        isImage: false,
      };
    } catch (err) {
      console.warn("Non-fatal PDF read warning:", err);
      return {
        name: file.name,
        type: defaultMimeType,
        size: file.size,
        dataUrl: '',
        base64: '',
        isImage: false,
      };
    }
  }

  // For images, optimize resolution to a crisp 2200px (ideal for Gemini multimodal document vision)
  return new Promise((resolve) => {
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(file);
    } catch (e) {
      console.warn("Could not create object URL for image:", e);
    }

    const img = new Image();
    const cleanup = () => {
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_) {}
      }
    };

    img.onerror = () => {
      cleanup();
      resolve({
        name: file.name,
        type: defaultMimeType,
        size: file.size,
        dataUrl: '',
        base64: '',
        isImage: true,
      });
    };

    img.onload = async () => {
      let canvas: HTMLCanvasElement | null = null;
      try {
        const maxDim = 1600; // Balanced clarity for OCR while safely preventing mobile OOM
        let { width, height } = img;

        // Scale down if image is larger than maxDim
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          resolve({
            name: file.name,
            type: defaultMimeType,
            size: file.size,
            dataUrl: '',
            base64: '',
            isImage: true,
          });
          return;
        }

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Run robust master OCR preprocessing pipeline on document/receipt images
        let prepResult: OcrPreprocessingResult | null = null;
        try {
          prepResult = await preprocessDocumentForOcr(canvas);
        } catch (_) {}

        const finalDataUrl = prepResult?.dataUrl || canvas.toDataURL('image/jpeg', 0.90);
        const commaIdx = finalDataUrl.indexOf(',');
        const compressedBase64 = commaIdx >= 0 ? finalDataUrl.substring(commaIdx + 1) : '';
        const approxSize = Math.round((compressedBase64.length * 3) / 4);

        // Explicitly release GPU texture memory
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;

        cleanup();
        resolve({
          name: file.name.replace(/\.[^/.]+$/, "") + ".jpg",
          type: 'image/jpeg',
          size: approxSize,
          dataUrl: finalDataUrl,
          base64: compressedBase64,
          isImage: true,
          deskewAngle: prepResult?.deskewAngle,
          isDeskewed: prepResult?.isDeskewed,
          isBinarized: !!prepResult?.binarizedDataUrl,
          binarizedDataUrl: prepResult?.binarizedDataUrl,
          binarizedBase64: prepResult?.binarizedBase64,
        });
      } catch (canvasErr) {
        if (canvas) {
          try {
            canvas.width = 0;
            canvas.height = 0;
          } catch (_) {}
        }
        cleanup();
        console.warn("Canvas compression fallback:", canvasErr);
        resolve({
          name: file.name,
          type: defaultMimeType,
          size: file.size,
          dataUrl: '',
          base64: '',
          isImage: true,
        });
      }
    };

    if (objectUrl) {
      img.src = objectUrl;
    } else {
      // Fallback to FileReader if objectUrl failed
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = (e.target?.result as string) || '';
      };
      reader.onerror = () => {
        resolve({
          name: file.name,
          type: defaultMimeType,
          size: file.size,
          dataUrl: '',
          base64: '',
          isImage: true,
        });
      };
      reader.readAsDataURL(file);
    }
  });
}

/**
 * Safely reads a File as raw Base64 string with size limit and timeout
 */
export function readAsBase64(file: File, maxSizeBytes: number = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve) => {
    if (file.size > maxSizeBytes) {
      console.warn(`File ${file.name} exceeds safe memory limit for Base64 (${Math.round(file.size / 1024)} KB).`);
      resolve('');
      return;
    }

    const reader = new FileReader();
    const timeout = setTimeout(() => {
      try {
        reader.abort();
      } catch (_) {}
      resolve('');
    }, 10000); // 10s safeguard

    reader.onload = () => {
      clearTimeout(timeout);
      try {
        const result = (reader.result as string) || '';
        const commaIdx = result.indexOf(',');
        const base64 = commaIdx >= 0 ? result.substring(commaIdx + 1) : result;
        resolve(base64);
      } catch (e) {
        console.warn("Base64 extraction warning:", e);
        resolve('');
      }
    };

    reader.onerror = (error) => {
      clearTimeout(timeout);
      console.warn("FileReader error, handled safely:", error);
      resolve('');
    };

    reader.onabort = () => {
      clearTimeout(timeout);
      resolve('');
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Safely reads a Blob as raw Base64 string
 */
export function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    const timeout = setTimeout(() => {
      try { reader.abort(); } catch (_) {}
      resolve('');
    }, 12000);

    reader.onload = () => {
      clearTimeout(timeout);
      try {
        const result = (reader.result as string) || '';
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.substring(commaIdx + 1) : result);
      } catch (_) {
        resolve('');
      }
    };
    reader.onerror = () => {
      clearTimeout(timeout);
      resolve('');
    };
    reader.onabort = () => {
      clearTimeout(timeout);
      resolve('');
    };
    reader.readAsDataURL(blob);
  });
}

import { exportTableToExcel } from './excelExportService';

/**
 * Generates and triggers download of an Excel (.xlsx) file (replaces legacy CSV with native Excel)
 */
export function exportCSVFile(filename: string, headers: string[], rows: (string | number)[][]): void {
  const xlsxFilename = filename.toLowerCase().endsWith('.xlsx') 
    ? filename 
    : `${filename.replace(/\.csv$/i, '')}.xlsx`;
  exportTableToExcel(xlsxFilename, 'Report', headers, rows);
}

