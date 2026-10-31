import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 8080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
};

async function handleExtractDocuments(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const chunks = [];
  let totalBytes = 0;
  const MAX_PAYLOAD_BYTES = 35 * 1024 * 1024; // 35MB max request guard
  req.on('data', (chunk) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes <= MAX_PAYLOAD_BYTES) {
      chunks.push(buf);
    }
  });

  req.on('end', async () => {
    try {
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      const body = JSON.parse(rawBody || '{}');
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

      if (!apiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not available on server' }));
        return;
      }

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const parts = [];
      if (body.files && Array.isArray(body.files)) {
        for (const f of body.files) {
          if (f && f.base64) {
            parts.push({
              inlineData: {
                mimeType: f.mimeType || 'application/pdf',
                data: f.base64,
              },
            });
          }
        }
      }

      if (body.extractedText && typeof body.extractedText === 'string' && body.extractedText.trim()) {
        parts.push({
          text: `EXTRACTED PDF TEXT LAYER ACROSS ALL PAGES:\n${body.extractedText.slice(0, 60000)}`,
        });
      }

      const extractionInstruction =
        body.prompt ||
        `You are an expert shipping document and Pakistan Customs logistics OCR system.
Carefully read EVERY page of the attached document(s) — including multi-page PDFs containing PCCSS Form "A" - Agent, Transport Note (Appendix-I), Terminal Gate Pass (KICT / SAPT / QICT), One-Customs WeBOC Amend Vehicle before Sealing, Goods Declaration (GD-I / TP), Clearing/Forwarding Agent Letterheads, FBR Tax Verification, CNIC copies, Bill of Lading (B/L), Commercial Invoice, and Packing List — and merge all information across all pages into valid JSON.`;

      parts.push({ text: extractionInstruction });

      let apiResponse = null;
      const models = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
      for (const m of models) {
        try {
          apiResponse = await ai.models.generateContent({
            model: m,
            contents: { parts },
            config: {
              responseMimeType: 'application/json',
            },
          });
          if (apiResponse && apiResponse.text) break;
        } catch (mErr) {
          console.warn(`OCR attempt with model ${m} notice:`, mErr);
        }
      }

      const rawText = (apiResponse?.text || '{}')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(rawText || '{}');
    } catch (err) {
      console.error('Server OCR endpoint error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || 'OCR processing failed' }));
    }
  });
}

function sendFile(res, filePath, urlPath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  let cacheControl = 'public, max-age=3600';
  if (urlPath.startsWith('/assets/')) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else if (
    ext === '.html' ||
    ext === '.json' ||
    ext === '.webmanifest' ||
    urlPath === '/sw.js' ||
    urlPath === '/'
  ) {
    cacheControl = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-XSS-Protection': '1; mode=block',
      'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self)',
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === '/api/extract-documents') {
    handleExtractDocuments(req, res);
    return;
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK');
    return;
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidatePath = path.join(DIST_DIR, safePath);

  fs.stat(candidatePath, (err, stats) => {
    if (!err && stats.isFile()) {
      sendFile(res, candidatePath, pathname);
      return;
    }

    const indexPath = path.join(DIST_DIR, 'index.html');
    sendFile(res, indexPath, '/');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
