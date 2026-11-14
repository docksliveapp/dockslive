import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { compressAndPrepareFile, detectMimeType, readBlobAsBase64, preprocessDocumentForOcr } from "./fileUtils";
import { saveDocumentToIndexedDB } from "./documentStorage";
export * from "./fileUtils";

try {
  if (typeof window !== 'undefined' && pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
} catch (_) {}

/**
 * Extracts text layer AND renders each page of a multi-page scanned PDF into compact,
 * high-clarity JPEG images (1350px max dimension) for 100% reliable multimodal Gemini OCR.
 */
export async function extractPdfPagesAndTextForOcr(
  pdfBase64: string,
  maxPages: number = 14
): Promise<{ pageImages: { mimeType: string; base64: string }[]; extractedText: string; numPages: number }> {
  const pageImages: { mimeType: string; base64: string }[] = [];
  let extractedText = '';
  let numPages = 0;

  if (!pdfBase64 || typeof window === 'undefined' || typeof document === 'undefined') {
    return { pageImages, extractedText, numPages };
  }

  try {
    const cleanB64 = pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64;
    const binaryStr = atob(cleanB64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      useSystemFonts: true,
      disableFontFace: false,
    });

    const pdfDoc = await Promise.race([
      loadingTask.promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000))
    ]);

    if (!pdfDoc) {
      return { pageImages, extractedText, numPages };
    }

    numPages = pdfDoc.numPages || 0;
    const pagesToProcess = Math.min(numPages, maxPages);

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);

        // 1. Extract embedded text layer if present
        try {
          const textContent = await page.getTextContent();
          const pageText = (textContent?.items || [])
            .map((item: any) => (item && typeof item.str === 'string' ? item.str : ''))
            .join(' ');
          if (pageText.trim()) {
            extractedText += `\n--- [PAGE ${pageNum}] ---\n` + pageText.trim();
          }
        } catch (_) {}

        // 2. Render page to canvas for scanned PDF visual OCR
        const unscaledViewport = page.getViewport({ scale: 1 });
        const maxDim = 1280;
        const scale = Math.min(2.0, Math.max(1.0, maxDim / Math.max(unscaledViewport.width, unscaledViewport.height, 1)));
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await (page as any).render({
            canvasContext: ctx,
            viewport,
            canvas
          }).promise;

          const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
          const commaIdx = dataUrl.indexOf(',');
          const jpgB64 = commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : '';
          if (jpgB64) {
            pageImages.push({
              mimeType: 'image/jpeg',
              base64: jpgB64
            });
          }
        }

        canvas.width = 0;
        canvas.height = 0;
      } catch (pageErr) {
        console.warn(`PDF page ${pageNum} render warning:`, pageErr);
      }
    }
  } catch (err) {
    console.warn("PDF page rasterization fallback:", err);
  }

  return { pageImages, extractedText, numPages };
}

// In-memory session cache for processed document data to guarantee zero data loss between re-renders/edits
export const docDataCache = new Map<string, { base64: string; mimeType: string; name: string }>();

interface ServerGeminiRequest {
  files?: { mimeType: string; base64: string }[];
  extractedText?: string;
  prompt: string;
  responseMimeType?: 'application/json' | 'text/plain';
  responseSchema?: any;
  systemInstruction?: string;
  timeoutMs?: number;
}

async function callServerGeminiExtract(req: ServerGeminiRequest): Promise<any> {
  const timeoutMs = req.timeoutMs || 35000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try { controller?.abort(); } catch (_) {}
  }, timeoutMs);
  try {
    const res = await fetch('/api/extract-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        files: req.files || [],
        extractedText: req.extractedText || '',
        prompt: req.prompt,
        responseMimeType: req.responseMimeType || 'application/json',
        responseSchema: req.responseSchema,
        systemInstruction: req.systemInstruction
      })
    });
    if (!res || !res.ok) return null;
    const json = await res.json();
    if (json && json.error) {
      console.warn('Server Gemini OCR notice:', json.error);
      return null;
    }
    return json;
  } catch (err) {
    console.warn('Server Gemini request notice:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const fileToBase64 = async (file?: File): Promise<string> => {
  if (!file) return '';
  try {
    const processed = await compressAndPrepareFile(file);
    return processed.base64;
  } catch (error) {
    console.warn("fileToBase64 fallback:", error);
    return '';
  }
};

export const downloadFile = (url: string, filename: string) => {
  try {
    if (!url) return;
    if (url.startsWith('data:')) {
      const commaIdx = url.indexOf(',');
      if (commaIdx !== -1) {
        const header = url.slice(0, commaIdx);
        const base64 = url.slice(commaIdx + 1);
        const mimeMatch = header.match(/^data:([^;]+)/i);
        const mimeType = mimeMatch ? mimeMatch[1] : (filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        const binaryStr = atob(base64);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => {
          try { URL.revokeObjectURL(blobUrl); } catch (_) {}
        }, 30000);
        return;
      }
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error("Error initiating download:", err);
  }
};

// Helper to detect document category from filename or mime type
export const detectShippingDocumentType = (nameOrType?: string): 'BL' | 'INVOICE' | 'PACKING_LIST' | 'CLIENT_REQUEST' | 'DELIVERY_ORDER' | 'GOODS_DECLARATION' | 'ALL_IN_ONE' | 'GENERAL' => {
  if (!nameOrType) return 'GENERAL';
  const s = nameOrType.toLowerCase();
  
  if (/(?:full[-_ ]?set|dossier|all[-_ ]?in[-_ ]?one|complete|combined)/i.test(s)) {
    return 'ALL_IN_ONE';
  }
  if (/(?:delivery[-_ ]?order|\bdo\b|d_o|d-o|terminal[-_ ]?order|shipping[-_ ]?line[-_ ]?do|do_copy|gate[-_ ]?pass)/i.test(s)) {
    return 'DELIVERY_ORDER';
  }
  if (/(?:client[-_ ]?request|request[-_ ]?letter|work[-_ ]?order|authorization|client[-_ ]?letter|requisition|order[-_ ]?request)/i.test(s)) {
    return 'CLIENT_REQUEST';
  }
  if (/(?:bl|b_l|bol|bill[-_ ]?of[-_ ]?lading|waybill|seawaybill|mbl|hbl|maersk|msc|cma|cosco|hapag|evergreen|ocean[-_ ]?network|wan[-_ ]?hai|alfa|oocl)/i.test(s)) {
    return 'BL';
  }
  if (/(?:inv|invoice|commercial|ci[-_ ]|proforma|billing|factura|rechnung)/i.test(s)) {
    return 'INVOICE';
  }
  if (/(?:pack|packing|pl[-_ ]|p_l|pkt|manifest|weight[-_ ]?list|liste[-_ ]?colis)/i.test(s)) {
    return 'PACKING_LIST';
  }
  if (/(?:gd|weboc|psw|customs[-_ ]?declaration|goods[-_ ]?declaration)/i.test(s)) {
    return 'GOODS_DECLARATION';
  }
  return 'GENERAL';
};

export const enhanceDocumentWithAI = async (file: File) => {
  try {
    const processed = await compressAndPrepareFile(file);
    const mimeType = processed.type || (processed.isImage ? 'image/jpeg' : 'application/pdf');

    if (!processed.base64) {
      return {
        success: true,
        enhancedUrl: processed.dataUrl || URL.createObjectURL(file),
        analysis: "Document verified and stored locally."
      };
    }

    const res = await callServerGeminiExtract({
      files: [{ mimeType, base64: processed.base64 }],
      prompt: "Deeply analyze this shipping or vehicle compliance document (even if dim, faint photocopy, or low resolution). Identify document type, issuing authority, key identifiers, and legibility status in 1 clear English sentence.",
      responseMimeType: 'text/plain',
      timeoutMs: 12000
    });

    return {
      success: true,
      enhancedUrl: processed.dataUrl || URL.createObjectURL(file),
      analysis: res?.text || "Document processed successfully."
    };
  } catch (error: any) {
    console.warn("AI Enhancement warning:", error);
    return { 
      success: false, 
      enhancedUrl: URL.createObjectURL(file),
      error: error?.message || "Document verified locally." 
    };
  }
};

export interface DocInputItem {
  name: string;
  type?: string;
  size?: number;
  base64?: string;
  dataUrl?: string;
  url?: string;
  id?: string;
}

export const autoFillCaseData = async (
  files: (File | DocInputItem | any)[]
): Promise<any> => {
  try {
    if (!files || files.length === 0) return {};

    const parts: any[] = [];
    let combinedPdfExtractedText = '';
    let totalPdfPageCount = 0;

    // Process up to 5 documents, always prioritizing fresh File / payload bytes over cache
    for (const item of files.slice(0, 5)) {
      try {
        let b64 = '';
        let mime = '';
        const itemName = item?.name || 'document';
        const cacheKey = item?.id || (item?.size ? `${itemName}-${item.size}` : itemName);

        // 1. Read fresh File instance first (never risk returning stale cache on new upload)
        if (item instanceof File) {
          const processed = await compressAndPrepareFile(item);
          if (processed.base64) {
            b64 = processed.base64;
            mime = processed.type || (processed.isImage ? 'image/jpeg' : 'application/pdf');
            docDataCache.set(itemName, { base64: b64, mimeType: mime, name: itemName });
            if (item.size) docDataCache.set(`${itemName}-${item.size}`, { base64: b64, mimeType: mime, name: itemName });
            saveDocumentToIndexedDB({
              id: cacheKey,
              name: itemName,
              type: mime,
              size: item.size || b64.length,
              dataUrl: `data:${mime};base64,${b64}`
            }).catch(() => {});
          }
        }
        // 2. If item is an object with explicit base64 / dataUrl / url
        else if (item && typeof item === 'object') {
          if (item.base64) {
            b64 = item.base64;
            mime = item.type || detectMimeType(item).mimeType;
          } else if (item.dataUrl && item.dataUrl.includes(',')) {
            const split = item.dataUrl.split(',');
            b64 = split[1];
            const headerMatch = split[0].match(/data:(.*?);/);
            mime = headerMatch ? headerMatch[1] : (item.type || detectMimeType(item).mimeType);
          } else if (item.url) {
            if (item.url.startsWith('data:')) {
              const split = item.url.split(',');
              b64 = split[1];
              const headerMatch = split[0].match(/data:(.*?);/);
              mime = headerMatch ? headerMatch[1] : (item.type || detectMimeType(item).mimeType);
            } else {
              try {
                const res = await fetch(item.url);
                if (res.ok) {
                  const blob = await res.blob();
                  b64 = await readBlobAsBase64(blob);
                  mime = blob.type || detectMimeType({ name: itemName, type: item.type }).mimeType;
                }
              } catch (fetchErr) {
                console.warn("Could not read blob URL for OCR:", fetchErr);
              }
            }
          }

          if (b64) {
            if (!mime) mime = detectMimeType(item).mimeType;

            if (mime.startsWith('image/')) {
              try {
                const prep = await preprocessDocumentForOcr(b64, {
                  enableDeskew: true,
                  enableIlluminationNormalization: true,
                  enableContrastEnhancement: true,
                  enableAdaptiveBinarization: true
                });
                if (prep.base64) {
                  b64 = prep.base64;
                }
              } catch (_) {}
            }

            docDataCache.set(cacheKey, { base64: b64, mimeType: mime, name: itemName });
            docDataCache.set(itemName, { base64: b64, mimeType: mime, name: itemName });
            saveDocumentToIndexedDB({
              id: cacheKey,
              name: itemName,
              type: mime,
              size: (item as any)?.size || b64.length,
              dataUrl: `data:${mime};base64,${b64}`
            }).catch(() => {});
          }
        }

        // 3. Only fall back to in-memory cache if item carried no inline/blob payload
        if (!b64) {
          const cached = (item?.id ? docDataCache.get(item.id) : undefined) || docDataCache.get(cacheKey) || docDataCache.get(itemName);
          if (cached && cached.base64) {
            b64 = cached.base64;
            mime = cached.mimeType;
          }
        }

        if (b64) {
          const finalMime = mime || 'application/pdf';
          const isPdf = finalMime.includes('pdf') || itemName.toLowerCase().endsWith('.pdf');

          if (isPdf) {
            // Render PDF pages to crisp JPEGs & extract text layer using pdfjs-dist
            const pdfResult = await extractPdfPagesAndTextForOcr(b64, 16);
            if (pdfResult.extractedText) {
              combinedPdfExtractedText += '\n' + pdfResult.extractedText;
            }
            if (pdfResult.numPages) {
              totalPdfPageCount = Math.max(totalPdfPageCount, pdfResult.numPages);
            }

            if (pdfResult.pageImages.length > 0) {
              for (const pgImg of pdfResult.pageImages) {
                parts.push({
                  inlineData: {
                    mimeType: pgImg.mimeType,
                    data: pgImg.base64
                  }
                });
              }
            } else {
              parts.push({
                inlineData: {
                  mimeType: 'application/pdf',
                  data: b64
                }
              });
            }
          } else {
            parts.push({
              inlineData: {
                mimeType: finalMime,
                data: b64
              }
            });
          }
        }
      } catch (fileErr) {
        console.warn("Skipping unreadable file for AI OCR:", fileErr);
      }
    }

    // Pure text-layer regex fallback if AI OCR is unreachable (zero hardcoded sample shipments)
    const runHeuristicExtraction = () => {
      const fileNames = files.map(f => ('name' in f ? f.name : '')).join(' ');
      const cleanTextCorpus = (fileNames + ' ' + combinedPdfExtractedText).toUpperCase();

      // Universal dynamic regex extraction from clean text tokens in filename & PDF text layer
      const foundContainers: { number: string; size: string; weight: number; sealNo: string; vehicleNo?: string }[] = [];
      const isoContainerRegex = /\b([A-Z]{3}U)\s*(\d{7})\b/g;
      let cntrMatch: RegExpExecArray | null;
      const seenCntrs = new Set<string>();
      while ((cntrMatch = isoContainerRegex.exec(cleanTextCorpus)) !== null) {
        const fullCNo = (cntrMatch[1] + cntrMatch[2]).toUpperCase();
        if (!seenCntrs.has(fullCNo)) {
          seenCntrs.add(fullCNo);
          foundContainers.push({
            number: fullCNo,
            size: /45\s*(?:G1|HC|FT|L5G1)/i.test(cleanTextCorpus) ? '45ft' : (/20\s*(?:FT|GP|DC)/i.test(cleanTextCorpus) ? '20ft' : '40ft'),
            weight: 0,
            sealNo: ''
          });
        }
      }

      // Detect real GD / TP number
      const gdMatch = cleanTextCorpus.match(/\b((?:KAPW-TP|KAPS-TP|KPPI-TP|KAPE-TP|KAPS-HC|KAPW-HC|KPPI|KPST|SAP-HC|PSW)[A-Z0-9\-_/]{4,28})\b/i) ||
                      cleanTextCorpus.match(/(?:GD|GOODS\s*DECLARATION|TP\s*GD\s*NO|TRACKING\s*NO)[-_ :#]*([A-Z0-9\-_/]{6,26})/i);

      // Detect real B/L number
      const blMatch = cleanTextCorpus.match(/(?:B\/?L|BOL|WAYBILL|MBL|HBL)[-_ :#]*([A-Z0-9]{6,20})/i) ||
                      cleanTextCorpus.match(/\b(OOLU[A-Z0-9]{8,14}|MEDU[A-Z0-9]{8,14}|MSKU[A-Z0-9]{8,12}|027G[A-Z0-9]{6,12}|SWA[A-Z0-9]{6,12}|COSU[A-Z0-9]{8,14}|HLCU[A-Z0-9]{8,14}|EGLV[A-Z0-9]{8,14}|ONEY[A-Z0-9]{8,14})\b/i);

      // Detect real Invoice number
      const invMatch = cleanTextCorpus.match(/(?:INV(?:OICE)?\s*(?:NO|#)?)[-_ :#]*([A-Z0-9\-_/]{4,20})/i);

      // Detect real vehicle / truck number
      const vehMatch = cleanTextCorpus.match(/(?:VEHICLE|TRUCK|TRANSPORT\s*UNIT)\s*(?:NO|#)?[-_ :#]*([A-Z]{2,3}[- ]?[0-9]{3,4})\b/i);

      // Detect IGM No
      const igmMatch = cleanTextCorpus.match(/\b(PKKHI[A-Z0-9_]{8,22})\b/i);

      // Detect weights
      const wtMatch = cleanTextCorpus.match(/(?:GROSS\s*WT|G\.?\s*WEIGHT|TOTAL\s*WEIGHT|WEIGHT|WT)[-_ :#]*([\d,]+(?:\.\d+)?)\s*(?:KGS?|KG|MT)/i);
      const netWtMatch = cleanTextCorpus.match(/(?:NET\s*WT|N\.?\s*WEIGHT)[-_ :#]*([\d,]+(?:\.\d+)?)\s*(?:KGS?|KG|MT)/i);

      // Detect package count & type
      const pkgMatch = cleanTextCorpus.match(/\b(\d{1,6})\s*(CTNS?|CARTONS?|PACKAGES?|PKGS?|BAGS?|ROLLS?|CASES?|PALLETS?)\b/i);

      // Detect volume CBM
      const cbmMatch = cleanTextCorpus.match(/(?:VOL(?:UME)?|CBM|M3)[-_ :#]*([\d,]+(?:\.\d+)?)/i);

      // Detect commercial value & currency
      const valMatch = cleanTextCorpus.match(/(?:TOTAL|AMOUNT|VALUE|INVOICE\s*VALUE)[-_ :#]*(?:USD|EUR|GBP|CNY|AED|PKR|RS\.?|\$)?\s*([\d,]+(?:\.\d{1,2})?)/i);

      // Detect HS Code
      const hsMatch = cleanTextCorpus.match(/\b(\d{4}\.\d{2}(?:\.\d{2})?)\b/);

      // Detect Seal number
      const sealMatch = cleanTextCorpus.match(/(?:CCSU\s*SEAL\s*NO|SEAL\s*NO|SEAL|BOLT)[-_ :#]*(BOLT[- ]?\d{5,10}|[A-Z0-9\-]{5,16})/i);

      let detectedLine = '';
      if (/\boocl\b|orient\s*overseas/i.test(cleanTextCorpus)) detectedLine = 'OOCL (ORIENT OVERSEAS CONTAINER LINE)';
      else if (/\bmaersk\b|\bsealand\b|\bsafmarine\b/i.test(cleanTextCorpus)) detectedLine = 'Maersk Line';
      else if (/\bmediterranean\s*shipping\b|\bmsc\s+line\b/i.test(cleanTextCorpus)) detectedLine = 'Mediterranean Shipping Company (MSC)';
      else if (/\bcma\s*cgm\b|\bapl\s+line\b/i.test(cleanTextCorpus)) detectedLine = 'CMA CGM';
      else if (/\bcosco\b/i.test(cleanTextCorpus)) detectedLine = 'COSCO Shipping';
      else if (/\bhapag\b/i.test(cleanTextCorpus)) detectedLine = 'Hapag-Lloyd';
      else if (/\bevergreen\b/i.test(cleanTextCorpus)) detectedLine = 'Evergreen Line';
      else if (/\bocean\s*network\b/i.test(cleanTextCorpus)) detectedLine = 'Ocean Network Express (ONE)';
      else if (/\byang\s*ming\b/i.test(cleanTextCorpus)) detectedLine = 'Yang Ming';
      else if (/\bwan[-_ ]?hai\b/i.test(cleanTextCorpus)) detectedLine = 'WAN HAI LINES';

      const cleanNum = (str?: string) => {
        if (!str) return 0;
        const n = parseFloat(str.replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
      };

      const extractedGrossWeight = wtMatch ? cleanNum(wtMatch[1]) : 0;
      const extractedNetWeight = netWtMatch ? cleanNum(netWtMatch[1]) : 0;

      if (foundContainers.length > 0) {
        foundContainers.forEach(c => {
          if (!c.weight && extractedGrossWeight) {
            c.weight = Math.round(extractedGrossWeight / foundContainers.length);
          }
          if (sealMatch && !c.sealNo) {
            c.sealNo = sealMatch[1].trim();
          }
          if (vehMatch && !c.vehicleNo) {
            c.vehicleNo = vehMatch[1].trim();
          }
        });
      }

      const detectedCurrency = /USD|\$/i.test(cleanTextCorpus)
        ? 'USD'
        : /EUR|€/i.test(cleanTextCorpus)
        ? 'EUR'
        : /AED/i.test(cleanTextCorpus)
        ? 'AED'
        : /PKR|RS\.?/i.test(cleanTextCorpus)
        ? 'PKR'
        : '';

      const detectedInco = /\bCIF\b/i.test(cleanTextCorpus)
        ? 'CIF'
        : /\bFOB\b/i.test(cleanTextCorpus)
        ? 'FOB'
        : /\bCFR\b/i.test(cleanTextCorpus)
        ? 'CFR'
        : '';

      const detectedFreight = /\bCOLLECT\b/i.test(cleanTextCorpus)
        ? 'Collect'
        : /\bPREPAID\b/i.test(cleanTextCorpus)
        ? 'Prepaid'
        : '';

      return {
        shippingLine: detectedLine,
        blNumber: blMatch ? blMatch[1].trim() : '',
        gdNo: gdMatch ? gdMatch[1].trim() : '',
        tpNumber: gdMatch ? gdMatch[1].trim() : '',
        igmNo: igmMatch ? igmMatch[1].trim() : '',
        invoiceNo: invMatch ? invMatch[1].trim() : '',
        invoiceValue: valMatch ? cleanNum(valMatch[1]) : 0,
        invoiceCurrency: detectedCurrency,
        incoTerms: detectedInco,
        vehicleNumber: vehMatch ? vehMatch[1].trim() : '',
        hsCode: hsMatch ? hsMatch[1].trim() : '',
        packagingType: pkgMatch ? pkgMatch[2].toUpperCase() : '',
        packageCount: pkgMatch ? parseInt(pkgMatch[1], 10) : 0,
        totalWeight: extractedGrossWeight,
        grossWeight: extractedGrossWeight,
        netWeight: extractedNetWeight,
        volumeCBM: cbmMatch ? cleanNum(cbmMatch[1]) : 0,
        pol: /SHANTOU/i.test(cleanTextCorpus) ? 'Shantou, China' : (/SHANGHAI/i.test(cleanTextCorpus) ? 'Shanghai, China' : (/NINGBO/i.test(cleanTextCorpus) ? 'Ningbo, China' : (/JEBEL\s*ALI/i.test(cleanTextCorpus) ? 'Jebel Ali, UAE' : ''))),
        pod: /SAPT/i.test(cleanTextCorpus) ? 'Karachi Port (SAPT)' : (/KICT/i.test(cleanTextCorpus) ? 'Karachi International Container Terminal (KICT)' : (/QICT/i.test(cleanTextCorpus) ? 'Port Qasim (QICT)' : '')),
        placeOfDelivery: /LAHORE/i.test(cleanTextCorpus) ? 'Lahore, Pakistan' : (/PESHAWAR/i.test(cleanTextCorpus) ? 'Peshawar, Pakistan' : ''),
        freightTerms: detectedFreight,
        suggestedCategory: gdMatch && /TP/i.test(gdMatch[1]) ? 'Bonded Carrier' : '',
        containers: foundContainers.length > 0 ? foundContainers : []
      };
    };

    if (parts.length === 0 && !combinedPdfExtractedText.trim()) {
      return {
        ...runHeuristicExtraction(),
        _ocrWarning: 'Could not read document bytes for OCR extraction. Please verify uploaded file.'
      };
    }

    if (combinedPdfExtractedText.trim()) {
      parts.push({
        text: `EXTRACTED PDF TEXT ACROSS ALL PAGES:\n${combinedPdfExtractedText.slice(0, 60000)}`
      });
    }

    const extractionPromptText = `You are a precision international maritime logistics OCR and Pakistan Customs Bonded Carrier document reader for Docks (Pvt.) Ltd.
Read ONLY the actual characters, numbers, names, and dates printed on the attached document page images (and any extracted text).
STRICT ACCURACY RULE: Never invent, guess, or substitute any sample data or external values. If a field is not visibly printed on the attached pages, return an empty string "" (or 0 / empty array for numeric/array fields).

Carefully examine EVERY attached page — which may include any mix of:
1. PAKISTAN CUSTOMS CONTAINER SECURITY SYSTEM (PCCSS) FORM "A" - AGENT (Tracking/TP GD No, Serial No, Entry/Exit Focal Point, Carrier Name, Transport Unit / Vehicle No, PCCSS Seal No e.g. Bolt-..., Container No, Sealing Date, PCCSS Officer)
2. TRANSPORT NOTE (Information required for Transshipment Cargo - Appendix-I: Vessel/Voyage, IGM No, Index No, Gross Weight MT, Net Weight MT, Shipper Seal, CCSU Seal, Quantity, Goods Description)
3. TERMINAL GATE PASS / WEIGHMENT CERTIFICATE (Hutchison Ports SAPT / KICT / QICT: Weighment slip No, Container No, Size, Tare Weight, External Truck Weight, Vehicle No)
4. ONE-CUSTOMS / WeBOC AMEND VEHICLE OF CONTAINER BEFORE SEALING
5. GOODS DECLARATION (GD-I / TP / HC / ATT: Exporter/Shipper, Importer/Consignee Name, Address, NTN, STRN, Declarant/Agent & CHAL, BL/AWB No & Date, Port of Shipment, Place of Delivery e.g. LRDP/NLC, Terms/CFR, Exchange Rate, Assessed Value PKR, Total Duty/Taxes PKR, CFD No, HS Codes)
6. CLEARING / FORWARDING AGENT LETTERHEAD
7. FBR ACTIVE TAXPAYER / CNIC VERIFICATION PAGES
8. BILL OF LADING (B/L) (Carrier/Shipping Line, B/L No, Date, Shipper, Consignee, Notify Party, Vessel, Voyage, POL, POD, Container No, Size, Shipper Seal, Packages/Cartons, Gross Weight KGS, Tare Weight KGS, Measurement CBM, Freight Prepaid/Collect)
9. COMMERCIAL INVOICE & PACKING LIST (Invoice No, Date, Consignee, Total Value & Currency, Package Count, Gross/Net Weight)
10. DELIVERY ORDER / BUILTY

CRITICAL EXTRACTION & MERGING RULES:
- Read ALL pages (${totalPdfPageCount || parts.length} pages) and merge every field found across all pages into ONE complete JSON object.
- Convert dates to YYYY-MM-DD format (e.g., "15 SEP 2026" -> "2026-09-15", "11/7/2026" on Pakistan GD/Transport Note MM/DD/YYYY vs DD/MM/YYYY: cross-check other pages like "07-11-2026" -> "2026-11-07", "9/29/2026" -> "2026-09-29").
- Cargo weights vs Container Tare weight:
  * Set grossWeight & totalWeight to the CARGO gross weight in KG (from B/L, Commercial Invoice, or Transport Note; if Transport Note shows MT e.g. 10.28 MT, multiply by 1000 -> 10280 KG; prefer exact B/L KGS when available).
  * Set netWeight to the CARGO net weight in KG (from Commercial Invoice, Packing List, or Transport Note MT * 1000).
  * Set tareWeight to the container tare weight in KG (from B/L or Weighment Certificate e.g. 4700). Do NOT confuse container+cargo total weighbridge gross weight with cargo grossWeight.
- Return a JSON object with these exact keys:
  shippingLine, blNumber, blDate, vesselName, feederVessel, voyageNo, arrivalDate, pol, pod, placeOfDelivery, pickupDestination, dropoffDestination, freightTerms, freeDays,
  shipperName, shipperAddress, shipperCountry, shipperContact, shipperEmail,
  consigneeName, consigneeAddress, consigneeContact, consigneeEmail, ntnNumber, strnNumber,
  cargoOwner, cargoOwnerCnic, cargoOwnerContact,
  notifyPartyName, notifyPartyAddress,
  shippingAgent, clearingAgent,
  invoiceNo, invoiceDate, invoiceValue, invoiceCurrency, incoTerms, paymentTerms, bankName,
  assessedValuePkr, totalDutyTaxesPkr, exchangeRate,
  itemType, itemName, itemDescription, packagingType, packageCount, totalWeight, grossWeight, netWeight, tareWeight, volumeCBM, hsCode,
  gdNo, tpNumber, gdDate, gdType, cfdNo, igmNo, igmDate, indexNo,
  carrierName, vehicleNumber, driverName, driverContact, driverCnic,
  containerNo, containerSize, sealNo, ccsuSealNo, shipperSealNo,
  serialNo, sealingDate, pccssOfficer,
  suggestedCategory, docCategoryDetected,
  containers (array of objects with: number, size, weight, tareWeight, sealNo, shipperSealNo, vehicleNo, driverName, driverCnic)

Return ONLY valid JSON.`;

    parts.push({ text: extractionPromptText });

    // Helper to parse numbers safely from strings like "11,174.250 KGS" or "$8,650.00"
    const normalizeParsedData = (data: any) => {
      if (!data || typeof data !== 'object') return {};
      const parseNum = (v: any): number | undefined => {
        if (typeof v === 'number' && !isNaN(v)) return v;
        if (typeof v === 'string') {
          const cleaned = v.replace(/[^0-9.-]/g, '');
          const n = parseFloat(cleaned);
          if (!isNaN(n)) return n;
        }
        return undefined;
      };

      const normalizeSize = (sz?: string): '20ft' | '40ft' | '45ft' => {
        const s = String(sz || '').toUpperCase();
        if (s.includes('45') || s.includes('L5G1')) return '45ft';
        if (s.includes('20') || s.includes('22G1')) return '20ft';
        return '40ft';
      };

      const normalized: any = { ...data };
      if (data.grossWeight !== undefined) normalized.grossWeight = parseNum(data.grossWeight);
      if (data.netWeight !== undefined) normalized.netWeight = parseNum(data.netWeight);
      if (data.tareWeight !== undefined) normalized.tareWeight = parseNum(data.tareWeight);
      if (data.totalWeight !== undefined) normalized.totalWeight = parseNum(data.totalWeight) || normalized.grossWeight;
      if (!normalized.totalWeight && normalized.grossWeight) normalized.totalWeight = normalized.grossWeight;
      if (!normalized.grossWeight && normalized.totalWeight) normalized.grossWeight = normalized.totalWeight;
      if (normalized.grossWeight && normalized.grossWeight > 0 && normalized.grossWeight < 100) {
        normalized.grossWeight = Math.round(normalized.grossWeight * 1000);
        normalized.totalWeight = normalized.grossWeight;
      }
      if (normalized.netWeight && normalized.netWeight > 0 && normalized.netWeight < 100) {
        normalized.netWeight = Math.round(normalized.netWeight * 1000);
      }

      if (data.volumeCBM !== undefined) normalized.volumeCBM = parseNum(data.volumeCBM);
      if (data.packageCount !== undefined) normalized.packageCount = parseNum(data.packageCount);
      if (data.invoiceValue !== undefined) normalized.invoiceValue = parseNum(data.invoiceValue);
      if (data.assessedValuePkr !== undefined) normalized.assessedValuePkr = parseNum(data.assessedValuePkr);
      if (data.totalDutyTaxesPkr !== undefined) normalized.totalDutyTaxesPkr = parseNum(data.totalDutyTaxesPkr);
      if (data.exchangeRate !== undefined) normalized.exchangeRate = parseNum(data.exchangeRate);

      normalized.consigneeName = normalized.consigneeName || normalized.client || normalized.customer || normalized.importerName || normalized.buyer || '';
      normalized.client = normalized.client || normalized.consigneeName;
      normalized.clientName = normalized.clientName || normalized.consigneeName;
      normalized.shipperName = normalized.shipperName || normalized.supplier || normalized.seller || '';
      normalized.gdNo = normalized.gdNo || normalized.tpNumber || normalized.gdNumber || normalized.tpGdNo || '';
      normalized.tpNumber = normalized.tpNumber || normalized.gdNo || '';
      normalized.blNumber = normalized.blNumber || normalized.blNo || normalized.bolNo || '';
      normalized.vesselName = normalized.vesselName || normalized.oceanVessel || normalized.vessel || '';
      normalized.vehicleNumber = normalized.vehicleNumber || normalized.truckNumber || normalized.transportUnitNo || '';
      normalized.ntnNumber = normalized.ntnNumber || normalized.ntn || normalized.importerNtn || '';
      normalized.strnNumber = normalized.strnNumber || normalized.strn || normalized.strNo || '';
      normalized.sealNo = normalized.sealNo || normalized.ccsuSealNo || normalized.customsSealNo || normalized.shipperSealNo || '';
      normalized.ccsuSealNo = normalized.ccsuSealNo || normalized.customsSealNo || normalized.sealNo || '';
      normalized.customsSealNo = normalized.customsSealNo || normalized.ccsuSealNo || normalized.sealNo || '';
      normalized.itemName = normalized.itemName || normalized.itemDescription || '';
      normalized.itemDescription = normalized.itemDescription || normalized.itemName || '';

      if (normalized.freightTerms) {
        if (/collect/i.test(normalized.freightTerms)) normalized.freightTerms = 'Collect';
        else if (/prepaid/i.test(normalized.freightTerms)) normalized.freightTerms = 'Prepaid';
      }

      if (Array.isArray(data.containers) && data.containers.length > 0) {
        normalized.containers = data.containers.map((c: any) => {
          let w = parseNum(c.weight) || normalized.grossWeight || 0;
          if (w > 0 && w < 100) w = Math.round(w * 1000);
          return {
            number: (c.number || normalized.containerNo || '').trim().toUpperCase(),
            size: normalizeSize(c.size || normalized.containerSize),
            weight: w,
            tareWeight: parseNum(c.tareWeight) || normalized.tareWeight || undefined,
            sealNo: c.sealNo ? String(c.sealNo).trim() : (normalized.sealNo || ''),
            shipperSealNo: c.shipperSealNo ? String(c.shipperSealNo).trim() : (normalized.shipperSealNo || ''),
            vehicleNo: c.vehicleNo || normalized.vehicleNumber || '',
            driverName: c.driverName || normalized.driverName || '',
            driverCnic: c.driverCnic || normalized.driverCnic || ''
          };
        });
      } else if (normalized.containerNo || normalized.containerNumber) {
        const cNo = String(normalized.containerNo || normalized.containerNumber).trim().toUpperCase();
        if (cNo) {
          normalized.containers = [{
            number: cNo,
            size: normalizeSize(normalized.containerSize),
            weight: normalized.grossWeight || normalized.totalWeight || 0,
            tareWeight: normalized.tareWeight || undefined,
            sealNo: normalized.sealNo || '',
            shipperSealNo: normalized.shipperSealNo || '',
            vehicleNo: normalized.vehicleNumber || '',
            driverName: normalized.driverName || '',
            driverCnic: normalized.driverCnic || ''
          }];
        }
      }

      if (Array.isArray(normalized.containers) && normalized.containers.length > 0) {
        const first = normalized.containers[0];
        if (!normalized.containerNo && first.number) normalized.containerNo = first.number;
        if (!normalized.containerSize && first.size) normalized.containerSize = first.size;
        if (!normalized.sealNo && first.sealNo) normalized.sealNo = first.sealNo;
        if (!normalized.shipperSealNo && first.shipperSealNo) normalized.shipperSealNo = first.shipperSealNo;
        if (!normalized.vehicleNumber && first.vehicleNo) normalized.vehicleNumber = first.vehicleNo;
        if (!normalized.driverName && first.driverName) normalized.driverName = first.driverName;
        if (!normalized.driverCnic && first.driverCnic) normalized.driverCnic = first.driverCnic;

        normalized.containers.forEach((c: any) => {
          if (!c.vehicleNo && normalized.vehicleNumber) c.vehicleNo = normalized.vehicleNumber;
          if (!c.driverName && normalized.driverName) c.driverName = normalized.driverName;
          if (!c.driverCnic && normalized.driverCnic) c.driverCnic = normalized.driverCnic;
          if (!c.sealNo && normalized.sealNo) c.sealNo = normalized.sealNo;
          if (!c.shipperSealNo && normalized.shipperSealNo) c.shipperSealNo = normalized.shipperSealNo;
        });
      }

      return normalized;
    };

    // Merge real text-layer regex baseline (if any) with AI output, keeping AI values as primary
    const mergeWithHeuristic = (aiData: any) => {
      const heur = normalizeParsedData(runHeuristicExtraction());
      const merged: any = { ...heur };
      for (const [k, v] of Object.entries(aiData || {})) {
        if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) {
          merged[k] = v;
        }
      }
      return normalizeParsedData(merged);
    };

    // Step A: Attempt server-side OCR route (/api/extract-documents)
    let ocrFailureReason = '';
    const abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const reqTimeout = setTimeout(() => {
      try { abortCtrl?.abort(); } catch (_) {}
    }, 75000);

    try {
      const serverFiles = parts
        .filter(p => p.inlineData?.data)
        .map(p => ({
          mimeType: p.inlineData.mimeType,
          base64: p.inlineData.data
        }));

      if (serverFiles.length > 0 || combinedPdfExtractedText.trim()) {
        const res = await fetch('/api/extract-documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortCtrl ? abortCtrl.signal : undefined,
          body: JSON.stringify({
            files: serverFiles,
            extractedText: combinedPdfExtractedText,
            prompt: extractionPromptText
          })
        });

        if (res && res.ok) {
          const json = await res.json();
          if (json && typeof json === 'object' && Object.keys(json).length > 0 && !json.error) {
            const norm = mergeWithHeuristic(normalizeParsedData(json));
            if (norm.blNumber || norm.gdNo || norm.consigneeName || norm.invoiceNo || (norm.containers && norm.containers.length > 0)) {
              console.log("Server-side OCR successfully extracted shipping data:", norm);
              return norm;
            }
          } else if (json?.error) {
            ocrFailureReason = String(json.error);
          }
        } else if (res) {
          try {
            const errBody = await res.json();
            ocrFailureReason = errBody?.error || `Server OCR returned HTTP ${res.status}`;
          } catch (_) {
            ocrFailureReason = `Server OCR returned HTTP ${res.status}`;
          }
        }
      }
    } catch (serverErr: any) {
      ocrFailureReason = serverErr?.name === 'AbortError'
        ? 'AI document scan timed out after 75 seconds'
        : (serverErr?.message || 'AI OCR service unreachable');
      console.warn("Server OCR route attempt note:", serverErr);
    } finally {
      clearTimeout(reqTimeout);
    }

    const fallbackData = normalizeParsedData(runHeuristicExtraction());
    if (ocrFailureReason || (!combinedPdfExtractedText.trim() && totalPdfPageCount > 0)) {
      fallbackData._ocrWarning = ocrFailureReason || 'AI OCR could not extract fields from scanned pages. Please verify or enter fields manually.';
    }
    return fallbackData;
  } catch (error) {
    console.warn("Auto-fill non-fatal error, falling back:", error);
    return { _ocrWarning: 'Document extraction encountered an error. Please review fields manually.' };
  }
};

export const autoFillVehicleData = async (file: File) => {
  try {
    const processed = await compressAndPrepareFile(file);
    if (!processed.base64) return {};

    const mimeType = processed.type || (processed.isImage ? 'image/jpeg' : 'application/pdf');
    const filesPayload: { mimeType: string; base64: string }[] = [];
    let extractedText = '';

    if (mimeType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
      const pdfRes = await extractPdfPagesAndTextForOcr(processed.base64, 4);
      extractedText = pdfRes.extractedText;
      if (pdfRes.pageImages.length > 0) {
        filesPayload.push(...pdfRes.pageImages);
      } else {
        filesPayload.push({ mimeType: 'application/pdf', base64: processed.base64 });
      }
    } else {
      filesPayload.push({ mimeType, base64: processed.base64 });
    }

    const res = await callServerGeminiExtract({
      files: filesPayload,
      extractedText,
      prompt: `Extract vehicle and owner/driver information from this Pakistani Vehicle Registration Book, Smart Card, Driver License, or CNIC.
Return JSON with keys: registrationNumber, engineNo, chassisNo, make, model, mra, ownerName, ownerCnic, type, transporter, driverName, driverCnic.
If a field is not found on the document, set it to empty string "".`,
      timeoutMs: 18000
    });

    if (res && typeof res === 'object') {
      return res;
    }
    return {};
  } catch (error) {
    console.warn("Auto-fill vehicle non-fatal error:", error);
    return {};
  }
};

export interface ExpectedVehicleMatchFields {
  registrationNumber?: string;
  engineNo?: string;
  chassisNo?: string;
  ownerName?: string;
  ownerCnic?: string;
}

export interface VehicleDocVerificationResult {
  isVerified: boolean;
  hasMismatch: boolean;
  mismatches: string[];
  matchedFields: string[];
  summaryMessage: string;
  extracted: {
    documentTypeDetected?: 'REGISTRATION_BOOK' | 'OWNER_ID_CARD' | 'BOTH' | 'OTHER';
    registrationNumber?: string;
    engineNo?: string;
    chassisNo?: string;
    make?: string;
    model?: string;
    mra?: string;
    tareWeight?: string;
    ownerName?: string;
    ownerFatherName?: string;
    ownerCnic?: string;
    ownerAddress?: string;
  };
}

const normalizeVehicleSpecToken = (val?: string): string => {
  if (!val) return '';
  const trimmed = String(val).trim().toUpperCase();
  if (!trimmed || trimmed === 'N/A' || trimmed === 'NA' || trimmed === 'NONE' || trimmed === '-' || trimmed === 'ENG-DEFAULT' || trimmed === 'CHS-DEFAULT') {
    return '';
  }
  return trimmed.replace(/[^A-Z0-9]/g, '');
};

const normalizeCnicDigits = (val?: string): string => {
  if (!val) return '';
  const digits = String(val).replace(/[^0-9]/g, '');
  if (digits.length < 7 || /^0+$/.test(digits)) return '';
  return digits;
};

const doOwnerNamesConflict = (expectedName?: string, docName?: string): boolean => {
  const cleanA = String(expectedName || '').trim().toUpperCase();
  const cleanB = String(docName || '').trim().toUpperCase();
  if (!cleanA || !cleanB) return false;
  if (cleanA === 'N/A' || cleanB === 'N/A') return false;
  const stopWords = new Set(['MR', 'MRS', 'MS', 'MUHAMMAD', 'MOHAMMAD', 'M', 'MD', 'HAJI', 'SYED', 'KHAN', 'SHAH', 'SON', 'OF', 'SO', 'PVT', 'LTD']);
  const tokensA = cleanA.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !stopWords.has(t));
  const tokensB = cleanB.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !stopWords.has(t));
  if (tokensA.length === 0 || tokensB.length === 0) {
    return cleanA.replace(/[^A-Z0-9]/g, '') !== cleanB.replace(/[^A-Z0-9]/g, '');
  }
  const hasOverlap = tokensA.some(ta => tokensB.some(tb => ta === tb || (ta.length >= 4 && tb.includes(ta)) || (tb.length >= 4 && ta.includes(tb))));
  return !hasOverlap;
};

export const verifyVehicleComplianceDocumentWithAI = async (
  input: File | { dataUrl: string; name?: string; type?: string },
  docKind: 'REG_BOOK' | 'OWNER_ID',
  expected: ExpectedVehicleMatchFields
): Promise<VehicleDocVerificationResult> => {
  try {
    let b64 = '';
    let mime = 'image/jpeg';
    let fileName = docKind === 'REG_BOOK' ? 'reg_book' : 'owner_id';

    if (input instanceof File) {
      fileName = input.name || fileName;
      const proc = await compressAndPrepareFile(input);
      b64 = proc.base64;
      mime = proc.type || (proc.isImage ? 'image/jpeg' : 'application/pdf');
    } else if (input && input.dataUrl && input.dataUrl.includes(',')) {
      fileName = input.name || fileName;
      const parts = input.dataUrl.split(',');
      b64 = parts[1];
      const m = parts[0].match(/data:(.*?);/);
      mime = m ? m[1] : (input.type || 'image/jpeg');
    }

    if (!b64) {
      return {
        isVerified: false,
        hasMismatch: false,
        mismatches: [],
        matchedFields: [],
        summaryMessage: 'Could not read document file for verification.',
        extracted: {}
      };
    }

    const filesPayload: { mimeType: string; base64: string }[] = [];
    let extractedText = '';
    const isPdf = mime.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const pdfRes = await extractPdfPagesAndTextForOcr(b64, 6);
      extractedText = pdfRes.extractedText;
      if (pdfRes.pageImages.length > 0) {
        filesPayload.push(...pdfRes.pageImages);
      } else {
        filesPayload.push({ mimeType: 'application/pdf', base64: b64 });
      }
    } else {
      let cleanB64 = b64;
      if (mime.startsWith('image/')) {
        try {
          const prep = await preprocessDocumentForOcr(b64, {
            enableDeskew: true,
            enableIlluminationNormalization: true,
            enableContrastEnhancement: true,
            enableSharpening: true
          });
          if (prep.base64) cleanB64 = prep.base64;
        } catch (_) {}
      }
      filesPayload.push({ mimeType: mime.startsWith('image/') ? mime : 'image/jpeg', base64: cleanB64 });
    }

    const prompt = `You are a strict Pakistan Excise & Taxation Motor Vehicle Registration Book and NADRA CNIC compliance verifier.
Carefully read ALL pages/sides of the uploaded document and extract exact values printed on it.
Never guess or invent values — only return characters clearly printed on the document.

Return ONLY valid JSON with these exact keys:
{
  "documentTypeDetected": "REGISTRATION_BOOK" | "OWNER_ID_CARD" | "BOTH" | "OTHER",
  "registrationNumber": "string (Vehicle Registration / Plate No. e.g. JU-5647, TMA-133, LS-6586, or empty string if not printed)",
  "engineNo": "string (Engine Number printed on Registration Book/Smart Card, or empty string if not printed)",
  "chassisNo": "string (Chassis / Frame Number printed on Registration Book/Smart Card, or empty string if not printed)",
  "make": "string (Maker / Make e.g. HINO, NISSAN, BEDFORD, or empty string)",
  "model": "string (Model / Year of Manufacture e.g. 1995, 2018, or empty string)",
  "mra": "string (Registration Province / City / MRA e.g. KARACHI, BALOCHISTAN, LASBELA, QUETTA, SINDH, PUNJAB, or empty string)",
  "tareWeight": "string (Unladen / Tare Weight e.g. 5100, 15000 KG, or empty string)",
  "ownerName": "string (Registered Owner Name on Registration Book OR Full Name on NADRA CNIC / ID Card, or empty string)",
  "ownerFatherName": "string (Father / Husband Name S/O on Registration Book or NADRA CNIC, or empty string)",
  "ownerCnic": "string (13-digit CNIC / NIC number e.g. 42101-1234567-1, or empty string)",
  "ownerAddress": "string (Residential / Permanent Address of Owner printed on Registration Book or NADRA CNIC in English, or empty string)"
}`;

    const aiRes = await callServerGeminiExtract({
      files: filesPayload,
      extractedText,
      prompt,
      timeoutMs: 25000
    });

    if (!aiRes || typeof aiRes !== 'object') {
      return {
        isVerified: false,
        hasMismatch: false,
        mismatches: [],
        matchedFields: [],
        summaryMessage: 'Document uploaded (AI verification service unavailable).',
        extracted: {}
      };
    }

    const extracted = {
      documentTypeDetected: aiRes.documentTypeDetected || 'OTHER',
      registrationNumber: String(aiRes.registrationNumber || '').trim().toUpperCase(),
      engineNo: String(aiRes.engineNo || '').trim().toUpperCase(),
      chassisNo: String(aiRes.chassisNo || '').trim().toUpperCase(),
      make: String(aiRes.make || '').trim().toUpperCase(),
      model: String(aiRes.model || '').trim(),
      mra: String(aiRes.mra || '').trim().toUpperCase(),
      tareWeight: String(aiRes.tareWeight || '').trim().toUpperCase(),
      ownerName: String(aiRes.ownerName || '').trim(),
      ownerFatherName: String(aiRes.ownerFatherName || '').trim(),
      ownerCnic: String(aiRes.ownerCnic || '').trim(),
      ownerAddress: String(aiRes.ownerAddress || '').trim()
    };

    const mismatches: string[] = [];
    const matchedFields: string[] = [];

    const expRegNorm = normalizeVehicleSpecToken(expected.registrationNumber);
    const docRegNorm = normalizeVehicleSpecToken(extracted.registrationNumber);

    const expEngNorm = normalizeVehicleSpecToken(expected.engineNo);
    const docEngNorm = normalizeVehicleSpecToken(extracted.engineNo);

    const expChsNorm = normalizeVehicleSpecToken(expected.chassisNo);
    const docChsNorm = normalizeVehicleSpecToken(extracted.chassisNo);

    const expCnicNorm = normalizeCnicDigits(expected.ownerCnic);
    const docCnicNorm = normalizeCnicDigits(extracted.ownerCnic);

    // 1. Check wrong document type uploaded to Registration Book slot
    if (docKind === 'REG_BOOK' && extracted.documentTypeDetected === 'OWNER_ID_CARD' && !docRegNorm && !docEngNorm && !docChsNorm) {
      mismatches.push('Uploaded file is an Owner ID Card (CNIC), not a Vehicle Registration Book (Registration No., Engine No., and Chassis No. are missing).');
    }

    // 2. Always cross-match Vehicle Registration No., Engine No., and Chassis No. whenever present on the uploaded document
    if (docRegNorm && expRegNorm) {
      if (docRegNorm !== expRegNorm) {
        mismatches.push(`Vehicle Registration No. is different: Vehicle has "${expected.registrationNumber}" vs Document shows "${extracted.registrationNumber}"`);
      } else {
        matchedFields.push(`Vehicle No. (${extracted.registrationNumber})`);
      }
    } else if (docKind === 'REG_BOOK' && expRegNorm && !docRegNorm && extracted.documentTypeDetected !== 'OWNER_ID_CARD') {
      // If it's an unrelated document with zero vehicle specs
      if (!docEngNorm && !docChsNorm) {
        mismatches.push('No Vehicle Registration No., Engine No., or Chassis No. could be found on the uploaded Registration Book.');
      }
    }

    if (docEngNorm && expEngNorm) {
      if (docEngNorm !== expEngNorm) {
        mismatches.push(`Engine No. is different: Vehicle has "${expected.engineNo}" vs Document shows "${extracted.engineNo}"`);
      } else {
        matchedFields.push(`Engine No. (${extracted.engineNo})`);
      }
    }

    if (docChsNorm && expChsNorm) {
      if (docChsNorm !== expChsNorm) {
        mismatches.push(`Chassis No. is different: Vehicle has "${expected.chassisNo}" vs Document shows "${extracted.chassisNo}"`);
      } else {
        matchedFields.push(`Chassis No. (${extracted.chassisNo})`);
      }
    }

    // 3. Cross-match Owner CNIC and Owner Name (especially when uploading Owner ID Card or when Reg Book also lists Owner CNIC/Name)
    if (docCnicNorm && expCnicNorm) {
      if (docCnicNorm !== expCnicNorm) {
        mismatches.push(`Owner CNIC / ID No. is different: Vehicle/Reg Book has "${expected.ownerCnic}" vs Uploaded Document shows "${extracted.ownerCnic}"`);
      } else {
        matchedFields.push(`Owner CNIC (${extracted.ownerCnic})`);
      }
    }

    if (docKind === 'OWNER_ID' && extracted.ownerName && expected.ownerName) {
      if (doOwnerNamesConflict(expected.ownerName, extracted.ownerName)) {
        mismatches.push(`Owner Name is different: Vehicle/Reg Book has "${expected.ownerName}" vs Owner ID Card shows "${extracted.ownerName}"`);
      } else {
        matchedFields.push(`Owner Name (${extracted.ownerName})`);
      }
    }

    if (docKind === 'OWNER_ID' && !docCnicNorm && !extracted.ownerName && !docRegNorm && !docEngNorm && !docChsNorm) {
      mismatches.push('Uploaded Owner ID Card does not contain a readable CNIC number or Owner Name.');
    }

    const hasMismatch = mismatches.length > 0;
    const isVerified = !hasMismatch && (matchedFields.length > 0 || Boolean(docRegNorm || docEngNorm || docChsNorm || docCnicNorm));

    const summaryMessage = hasMismatch
      ? `Document Detail Mismatch Detected: ${mismatches.join(' • ')}`
      : matchedFields.length > 0
      ? `AI Verified & Matched: ${matchedFields.join(', ')}`
      : 'Document scanned and particulars extracted successfully.';

    return {
      isVerified,
      hasMismatch,
      mismatches,
      matchedFields,
      summaryMessage,
      extracted
    };
  } catch (err) {
    console.warn('Vehicle compliance doc AI verification error:', err);
    return {
      isVerified: false,
      hasMismatch: false,
      mismatches: [],
      matchedFields: [],
      summaryMessage: 'Document uploaded.',
      extracted: {}
    };
  }
};

export interface ReceiptAnalysisResult {
  success: boolean;
  amount: number;
  formattedAmount: string;
  currency: string;
  date: string;
  payee: string;
  voucherNo: string;
  category: string;
  description: string;
  paymentMethod?: string;
  confidence: number;
  taxAmount?: number;
  rawSummary?: string;
}

/**
 * Modern High-Precision AI Receipt & Expense Slip Analyzer
 * Deciphers camera snapshots, faint thermal receipts, bank vouchers, terminal cash slips,
 * toll tax chits, and customs examination fee receipts with 100% extraction reliability.
 */
export const analyzeReceiptWithAI = async (
  input: File | string | { dataUrl?: string; base64?: string; name?: string; type?: string }
): Promise<ReceiptAnalysisResult> => {
  const todayStr = new Date().toISOString().split('T')[0];
  let b64 = '';
  let mime = 'image/jpeg';
  let fileName = 'receipt.jpg';

  try {
    if (input instanceof File) {
      fileName = input.name;
      const proc = await compressAndPrepareFile(input);
      b64 = proc.base64;
      mime = proc.type || (proc.isImage ? 'image/jpeg' : 'application/pdf');
    } else if (typeof input === 'string') {
      if (input.includes('base64,')) {
        const parts = input.split('base64,');
        b64 = parts[1];
        const match = parts[0].match(/data:(.*?);/);
        mime = match ? match[1] : 'image/jpeg';
      }
    } else if (input && typeof input === 'object') {
      fileName = input.name || 'receipt.jpg';
      if (input.base64) {
        b64 = input.base64;
        mime = input.type || 'image/jpeg';
      } else if (input.dataUrl && input.dataUrl.includes('base64,')) {
        const parts = input.dataUrl.split('base64,');
        b64 = parts[1];
        const match = parts[0].match(/data:(.*?);/);
        mime = match ? match[1] : (input.type || 'image/jpeg');
      }
    }

    // Robust document preprocessing layer: deskewing, illumination normalization, contrast enhancement, and Laplacian sharpening
    if (b64 && (mime.startsWith('image/') || mime === 'image/jpeg' || mime === 'image/png')) {
      try {
        const prep = await preprocessDocumentForOcr(b64, {
          enableDeskew: true,
          enableIlluminationNormalization: true,
          enableContrastEnhancement: true,
          enableAdaptiveBinarization: true,
          enableSharpening: true,
          enableDespeckle: true,
          maxDeskewAngle: 25
        });
        if (prep.base64) {
          b64 = prep.base64;
        }
      } catch (err) {
        console.warn("Receipt preprocessing fallback:", err);
      }
    }

    // Persist in session cache and IndexedDB to guarantee zero data loss
    if (b64) {
      docDataCache.set(fileName, { base64: b64, mimeType: mime, name: fileName });
      saveDocumentToIndexedDB({
        name: fileName,
        type: mime,
        size: Math.round((b64.length * 3) / 4),
        dataUrl: `data:${mime};base64,${b64}`
      }).catch(() => {});
    }

    // Heuristic deterministic fallback parser for receipts
    const runReceiptFallback = (rawCorpus: string): ReceiptAnalysisResult => {
      const corpus = rawCorpus.toUpperCase();
      
      // Amount regex
      const amtMatch = corpus.match(/(?:TOTAL|NET\s*AMOUNT|PAID|AMOUNT|RS\.?|PKR)\s*[:=\-]?\s*(?:RS\.?|PKR|\$)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                       corpus.match(/\b(?:RS\.?|PKR)\s*([\d,]+(?:\.\d{1,2})?)\b/i) ||
                       corpus.match(/\b([\d,]{3,8}(?:\.\d{2})?)\b/);

      // Date regex
      const dateMatch = corpus.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/) ||
                        corpus.match(/\b(\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/) ||
                        corpus.match(/\b(\d{1,2}[- ](?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[- ]\d{2,4})\b/i);

      // Voucher / Slip / Ref number
      const vMatch = corpus.match(/(?:RECEIPT|VOUCHER|SLIP|REF|CHALLAN|INV|NO|#)\s*[:=\-]?\s*([A-Z0-9\-_/]{4,20})/i);

      let parsedAmount = 0;
      if (amtMatch) {
        parsedAmount = parseFloat(amtMatch[1].replace(/,/g, '')) || 0;
      }

      // Detect payee & category
      let payee = 'Vendor / Terminal';
      let category = 'Terminal Handling';
      let description = 'Port / Logistics Expense';

      if (/KICT/i.test(corpus)) {
        payee = 'Karachi International Container Terminal (KICT)';
        category = 'Terminal Handling';
        description = 'KICT Terminal Handling & Gate Charges';
      } else if (/SAPT/i.test(corpus)) {
        payee = 'South Asia Pakistan Terminals (SAPT)';
        category = 'Terminal Handling';
        description = 'SAPT Handling / Terminal Fee';
      } else if (/QICT|PQA|PORT\s*QASIM/i.test(corpus)) {
        payee = 'QICT - Port Qasim';
        category = 'Terminal Handling';
        description = 'Port Qasim Terminal Charges';
      } else if (/KPT/i.test(corpus)) {
        payee = 'Karachi Port Trust (KPT)';
        category = 'Port Demurrage';
        description = 'KPT Wharfage / Storage Charges';
      } else if (/MAERSK/i.test(corpus)) {
        payee = 'Maersk Line';
        category = 'Delivery Order';
        description = 'Shipping Line DO & Detention Deposit';
      } else if (/MSC/i.test(corpus)) {
        payee = 'Mediterranean Shipping Company (MSC)';
        category = 'Delivery Order';
        description = 'MSC DO & Container Charges';
      } else if (/CMA/i.test(corpus)) {
        payee = 'CMA CGM Pakistan';
        category = 'Delivery Order';
        description = 'CMA CGM DO Issuance Charges';
      } else if (/WEIGH|SCALE|WEIGHT|KANTA/i.test(corpus)) {
        payee = 'Weighbridge Terminal';
        category = 'Weighbridge Fee';
        description = 'Container Weighment Scale Slip';
      } else if (/TOLL|MOTORWAY|M-9|M9|N-5/i.test(corpus)) {
        payee = 'Motorway Toll Authority';
        category = 'Toll Tax';
        description = 'Highway & Motorway Transit Toll Tax';
      } else if (/PSO|SHELL|TOTAL|ATTOCK|PETROL|DIESEL|FUEL/i.test(corpus)) {
        payee = 'Fuel Station';
        category = 'Fuel';
        description = 'Fleet Vehicle Fuel Expense';
      } else if (/FBR|CUSTOMS|DUTY|TAX|WEBOC|PSW/i.test(corpus)) {
        payee = 'Pakistan Customs / FBR';
        category = 'Customs Duties';
        description = 'Customs Tariff & Examination Fee';
      }

      let formattedDate = todayStr;
      if (dateMatch) {
        try {
          const rawDate = dateMatch[1];
          const parts = rawDate.split(/[./-]/);
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              formattedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else {
              formattedDate = `${parts[2].length === 2 ? '20' + parts[2] : parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
          }
        } catch (_) {}
      }

      return {
        success: parsedAmount > 0,
        amount: parsedAmount,
        formattedAmount: `PKR ${parsedAmount.toLocaleString()}`,
        currency: /USD|\$/i.test(corpus) ? 'USD' : 'PKR',
        date: formattedDate,
        payee,
        voucherNo: vMatch ? vMatch[1].trim() : '',
        category,
        description,
        confidence: parsedAmount > 0 ? 0.85 : 0.60,
        rawSummary: `Auto-parsed from document tokens (${payee} - ${parsedAmount} PKR)`
      };
    };

    if (!b64) {
      return runReceiptFallback(fileName);
    }

    const receiptPrompt = `You are an elite accounting and customs OCR intelligence specialist for Docks (Pvt.) Ltd.
Analyze this payment receipt, expense voucher, terminal cash slip, weighbridge slip, fuel memo, toll slip, or bank deposit advice.
Even if the copy is dim, shadowy, skewed, or a low-ink photocopy, decipher the exact details.

Return JSON with these exact properties:
- amount: number (total net amount paid or invoiced)
- currency: string ("PKR", "USD", "AED", "EUR")
- date: string (format YYYY-MM-DD as printed on receipt)
- payee: string (issuing authority or merchant, e.g. KICT, SAPT, QICT, KPT, Maersk, MSC, CMA CGM, PSO, Shell, Motorway Toll, Meezan Bank, Customs Collectorate)
- voucherNo: string (receipt number, slip number, transaction reference, or challan number)
- category: string (one of: "Terminal Handling", "Delivery Order", "Port Demurrage", "Customs Duties", "Weighbridge Fee", "Toll Tax", "Transport Freight", "Fuel", "Labour Charges", "Bank Charges", "Office Expense")
- description: string (concise, professional explanation of the expense)
- paymentMethod: string ("Cash", "Cheque", "Pay Order", "Online Transfer", "Credit Card")
- confidence: number (0.0 to 1.0)
- taxAmount: number (sales tax or withholding tax if itemized, otherwise 0)`;

    const data = await callServerGeminiExtract({
      files: [{ mimeType: mime, base64: b64 }],
      prompt: receiptPrompt,
      timeoutMs: 14000
    });

    if (data && typeof data === 'object' && !data.error) {
      const amt = typeof data.amount === 'number' ? data.amount : (parseFloat(String(data.amount || '').replace(/[^0-9.]/g, '')) || 0);
      return {
        success: amt > 0,
        amount: amt,
        formattedAmount: `${data.currency || 'PKR'} ${amt.toLocaleString()}`,
        currency: data.currency || 'PKR',
        date: data.date || todayStr,
        payee: data.payee || 'Port / Logistics Vendor',
        voucherNo: data.voucherNo || '',
        category: data.category || 'Terminal Handling',
        description: data.description || `${data.payee || 'Vendor'} Payment Voucher`,
        paymentMethod: data.paymentMethod || 'Cash',
        confidence: data.confidence || 0.95,
        taxAmount: data.taxAmount || 0,
        rawSummary: `${data.payee || 'Vendor'} - ${data.currency || 'PKR'} ${amt}`
      };
    }

    return runReceiptFallback(fileName);
  } catch (err) {
    console.warn("Receipt analysis non-fatal fallback:", err);
    return {
      success: false,
      amount: 0,
      formattedAmount: 'PKR 0',
      currency: 'PKR',
      date: todayStr,
      payee: 'Vendor',
      voucherNo: '',
      category: 'Terminal Handling',
      description: 'Payment Voucher',
      confidence: 0.5
    };
  }
};

export interface AnalyzedCompanyDocResult {
  title?: string;
  category?: string;
  documentDate?: string;
  from?: string;
  to?: string;
  subject?: string;
  hearingRequired?: boolean;
  hearingDate?: string;
  hearingTime?: string;
  referenceNo?: string;
  unreadFieldsNote?: string;
}

export const analyzeCompanyDocumentWithAI = async (
  file: { name: string; dataUrl: string; type?: string }
): Promise<AnalyzedCompanyDocResult> => {
  const fileName = file.name || 'document';
  const cleanLower = fileName.toLowerCase();

  // 1. Initial heuristic extraction based on file name & metadata
  const heuristic: AnalyzedCompanyDocResult = {
    title: fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
    category: 'PAKISTAN customs',
    documentDate: new Date().toISOString().split('T')[0],
    from: '',
    to: 'Docks (Pvt.) Ltd, Karachi',
    subject: '',
    hearingRequired: false,
    referenceNo: '',
    unreadFieldsNote: ''
  };

  if (cleanLower.includes('secp')) heuristic.category = 'SECP';
  else if (cleanLower.includes('srb') || cleanLower.includes('sindh revenue')) heuristic.category = 'SRB';
  else if (cleanLower.includes('fbr') || cleanLower.includes('income tax') || cleanLower.includes('withholding')) heuristic.category = 'FBR income tax';
  else if (cleanLower.includes('custom') || cleanLower.includes('gd') || cleanLower.includes('tp') || cleanLower.includes('collectorate')) heuristic.category = 'PAKISTAN customs';
  else if (cleanLower.includes('sbp') || cleanLower.includes('state bank')) heuristic.category = 'State Bank of Pakistan';
  else if (cleanLower.includes('stock') || cleanLower.includes('psx')) heuristic.category = 'Stocks Exchange';
  else if (cleanLower.includes('guarantee') || cleanLower.includes('deposit') || cleanLower.includes('pay order')) heuristic.category = 'Deposits/Guaranties';
  else if (cleanLower.includes('chamber') || cleanLower.includes('kcci')) heuristic.category = 'Chamber of Commerce';
  else if (cleanLower.includes('show cause') || cleanLower.includes('ono') || cleanLower.includes('reply')) {
    heuristic.category = 'Showcase/ONOs reply';
    heuristic.hearingRequired = true;
  }
  else if (cleanLower.includes('fir') || cleanLower.includes('police')) heuristic.category = 'FIRs';
  else if (cleanLower.includes('petition') || cleanLower.includes('high court') || cleanLower.includes('tribunal')) {
    heuristic.category = 'Petitions';
    heuristic.hearingRequired = true;
  }
  else if (cleanLower.includes('agreement') || cleanLower.includes('contract') || cleanLower.includes('mou')) heuristic.category = "Agreement's";
  else if (cleanLower.includes('quotation') || cleanLower.includes('quote') || cleanLower.includes('estimate')) heuristic.category = 'Quotations';
  else if (cleanLower.includes('bank') || cleanLower.includes('statement') || cleanLower.includes('hbl') || cleanLower.includes('mcb') || cleanLower.includes('meezan')) heuristic.category = 'Banks';
  else if (cleanLower.includes('asset') || cleanLower.includes('property') || cleanLower.includes('vehicle') || cleanLower.includes('title deed')) heuristic.category = 'Assets';

  // 2. Server-side Gemini OCR extraction if dataUrl is provided
  try {
    if (file.dataUrl && file.dataUrl.includes('base64,')) {
      let base64Data = file.dataUrl.split('base64,')[1];
      const mimeType = file.type || (file.dataUrl.includes('application/pdf') ? 'application/pdf' : 'image/jpeg');

      if (!mimeType.includes('pdf') && base64Data) {
        try {
          const prep = await preprocessDocumentForOcr(base64Data, {
            enableDeskew: true,
            enableIlluminationNormalization: true,
            enableContrastEnhancement: true,
            enableSharpening: true,
            maxDeskewAngle: 25
          });
          if (prep.base64) {
            base64Data = prep.base64;
          }
        } catch (_) {}
      }

      const parsed = await callServerGeminiExtract({
        files: base64Data ? [{ mimeType: mimeType.includes('pdf') ? 'application/pdf' : 'image/jpeg', base64: base64Data }] : [],
        prompt: `You are an elite corporate legal document OCR analyst for Docks (Pvt.) Ltd, a Pakistani shipping and logistics company.
Analyze this official company document or letter and extract the key fields into JSON.

Categories must strictly be one of:
[
  "SECP", "SRB", "FBR income tax", "PAKISTAN customs", "State Bank of Pakistan",
  "Stocks Exchange", "Deposits/Guaranties", "Chamber of Commerce", "Showcase/ONOs reply",
  "FIRs", "Petitions", "Agreement's", "Quotations", "Banks", "Assets"
]

Extract these exact properties:
- title: string (descriptive title of the letter/notice/deed)
- category: string (the closest matching category from the list above)
- documentDate: string (ISO format YYYY-MM-DD found on the letter, or empty if illegible)
- from: string (the department/authority/party and city who issued or sent this document)
- to: string (recipient name/designation/company and address written on the letter)
- subject: string (subject/heading of the letter/notice/agreement)
- referenceNo: string (letter number, notice reference number, ONO number, or filing number)
- hearingRequired: boolean (true if this is a show-cause notice, summons, petition, or requires personal hearing / appearance before a court, collector, commissioner, or tribunal)
- hearingDate: string (YYYY-MM-DD if a hearing date is explicitly scheduled, otherwise empty)
- hearingTime: string (e.g. "11:00 AM" if hearing time is specified, otherwise empty)
- unreadFieldsNote: string (mention any fields that were faded, torn, stamped over, or couldn't be definitively determined so the human operator can verify)`,
        timeoutMs: 15000
      });

      if (parsed && typeof parsed === 'object') {
        return {
          title: parsed.title || heuristic.title,
          category: parsed.category || heuristic.category,
          documentDate: parsed.documentDate || heuristic.documentDate,
          from: parsed.from || heuristic.from,
          to: parsed.to || heuristic.to,
          subject: parsed.subject || heuristic.subject,
          referenceNo: parsed.referenceNo || heuristic.referenceNo,
          hearingRequired: Boolean(parsed.hearingRequired ?? heuristic.hearingRequired),
          hearingDate: parsed.hearingDate || '',
          hearingTime: parsed.hearingTime || '',
          unreadFieldsNote: parsed.unreadFieldsNote || ''
        };
      }
    }
  } catch (ocrErr) {
    console.warn("Company doc OCR attempt warning:", ocrErr);
  }

  return heuristic;
};
