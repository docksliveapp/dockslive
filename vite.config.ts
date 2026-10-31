import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const geminiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || '';

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        hmr: false,
      },
      plugins: [
        react(),
        tailwindcss(),
        VitePWA({
          registerType: 'autoUpdate',
          selfDestroying: true,
          injectRegister: null,
          includeAssets: [
            'favicon.svg',
            'favicon.png',
            'favicon-32x32.png',
            'favicon-16x16.png',
            'apple-touch-icon.png',
            'apple-touch-icon-v2.png',
            'apple-touch-icon-v3.png',
            'pwa-192x192.png',
            'pwa-192x192-v2.png',
            'pwa-192x192-v3.png',
            'pwa-512x512.png',
            'pwa-512x512-v2.png',
            'pwa-512x512-v3.png',
            'pwa-maskable-192x192-v3.png',
            'pwa-maskable-512x512.png',
            'pwa-maskable-512x512-v2.png',
            'pwa-maskable-512x512-v3.png',
            'mak_pearl_grey_edge.png'
          ],
          workbox: {
            cleanupOutdatedCaches: true,
            skipWaiting: true,
            clientsClaim: true,
            navigateFallback: null,
            globPatterns: []
          },
          manifest: {
            id: '/',
            name: 'MAK Group of Companies',
            short_name: 'MAK Group',
            description: 'MAK Group of Companies - Docks, Truckit, Muhib & Vantage Unified Logistics & Customs Enterprise Portal',
            theme_color: '#F8FAFC',
            background_color: '#F8FAFC',
            display: 'standalone',
            orientation: 'portrait',
            start_url: '/',
            scope: '/',
            icons: [
              {
                src: '/pwa-192x192-v3.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
              },
              {
                src: '/pwa-512x512-v3.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
              },
              {
                src: '/pwa-maskable-192x192-v3.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable'
              },
              {
                src: '/pwa-maskable-512x512-v3.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
              },
              {
                src: '/apple-touch-icon-v3.png',
                sizes: '180x180',
                type: 'image/png',
                purpose: 'any'
              }
            ]
          },
          devOptions: {
            enabled: false
          }
        }),
        {
          name: 'gemini-ocr-server-endpoint',
          configureServer(server) {
            server.middlewares.use('/api/extract-documents', (req, res) => {
              if (req.method !== 'POST') {
                res.statusCode = 405;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Method not allowed' }));
                return;
              }

              const chunks: Buffer[] = [];
              req.on('data', (chunk) => {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
              });

              req.on('end', async () => {
                try {
                  const rawBody = Buffer.concat(chunks).toString('utf-8');
                  const body = JSON.parse(rawBody);
                  const apiKey = geminiKey || process.env.GEMINI_API_KEY || '';

                  if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not available on server' }));
                    return;
                  }

                  const { GoogleGenAI } = await import('@google/genai');
                  const ai = new GoogleGenAI({ apiKey });

                  const parts: any[] = [];
                  if (body.files && Array.isArray(body.files)) {
                    for (const f of body.files) {
                      if (f && f.base64) {
                        parts.push({
                          inlineData: {
                            mimeType: f.mimeType || 'application/pdf',
                            data: f.base64
                          }
                        });
                      }
                    }
                  }

                  if (body.extractedText && typeof body.extractedText === 'string' && body.extractedText.trim()) {
                    parts.push({
                      text: `EXTRACTED PDF TEXT LAYER ACROSS ALL PAGES:\n${body.extractedText.slice(0, 60000)}`
                    });
                  }

                  const extractionInstruction = body.prompt || `You are an expert shipping document and Pakistan Customs logistics OCR system.
Carefully read EVERY page of the attached document(s) — including multi-page PDFs containing PCCSS Form "A" - Agent, Transport Note (Appendix-I), Terminal Gate Pass (KICT / SAPT / QICT), One-Customs WeBOC Amend Vehicle before Sealing, Goods Declaration (GD-I / TP), Clearing/Forwarding Agent Letterheads, FBR Tax Verification, CNIC copies, Bill of Lading (B/L), Commercial Invoice, and Packing List — and merge all information across all pages into valid JSON.`;

                  parts.push({ text: extractionInstruction });

                  let apiResponse: any = null;
                  const models = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
                  for (const m of models) {
                    try {
                      apiResponse = await ai.models.generateContent({
                        model: m,
                        contents: { parts },
                        config: {
                          responseMimeType: 'application/json'
                        }
                      });
                      if (apiResponse && apiResponse.text) break;
                    } catch (mErr) {
                      console.warn(`Vite OCR attempt with model ${m} notice:`, mErr);
                    }
                  }

                  const rawText = (apiResponse?.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(rawText || '{}');
                } catch (err: any) {
                  console.error('Server OCR endpoint error:', err);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err?.message || 'OCR processing failed' }));
                }
              });
            });
          }
        }
      ],
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.API_KEY': JSON.stringify(geminiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
        '__GEMINI_API_KEY__': JSON.stringify(geminiKey),
        'process.env': JSON.stringify({
          NODE_ENV: mode,
          API_KEY: geminiKey,
          GEMINI_API_KEY: geminiKey,
        }),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
