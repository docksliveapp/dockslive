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
          includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
          workbox: {
            maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
            globPatterns: ['**/*.{js,css,html,svg,png,ico,txt,json}']
          },
          manifest: {
            id: '/',
            name: 'MAK Group of Companies',
            short_name: 'MAK Group',
            description: 'MAK Group of Companies - Docks, Truckit, Muhib & Vantage Unified Logistics & Customs Enterprise Portal',
            theme_color: '#0f172a',
            background_color: '#020617',
            display: 'standalone',
            orientation: 'portrait',
            start_url: '/',
            scope: '/',
            icons: [
              {
                src: '/pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
              },
              {
                src: '/pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
              },
              {
                src: '/pwa-maskable-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
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

                  const extractionInstruction = body.prompt || `You are an expert shipping document and Pakistan Customs logistics OCR system.
Extract all logistics, customs, and shipping fields from the attached documents (Weighment Certificate, PCCSS Form "A" - Agent, Transport Note Appendix-I, Goods Declaration GD-1 TP, Bill of Lading, Commercial Invoice, Packing List) into valid JSON with these keys:
- shippingLine: (e.g. "CMA CGM", "WAN HAI LINES", "COSCO Shipping", "Maersk", "MSC")
- blNumber: Bill of Lading number (e.g. "SWA0449647", "027G657324")
- blDate: B/L issuance date (YYYY-MM-DD, e.g. "2026-04-01", "2026-06-12")
- vesselName: Ocean Vessel name (e.g. "COSCO PRINCE RUPERT", "COSCO NEW YORK")
- voyageNo: Ocean Voyage (e.g. "004", "149W")
- pol: Port of Loading (e.g. "Shantou, China", "Shanghai, China")
- pod: Port of Discharge (e.g. "Karachi Port (SAPT)", "Karachi, Pakistan")
- placeOfDelivery: Final Destination (e.g. "MCC Appraisement West Lahore-Import", "Karachi, Pakistan")
- freightTerms: (e.g. "FREIGHT PREPAID", "FREIGHT COLLECT")
- freeDays: Free demurrage/detention time if stated
- shipperName: Shipper / Exporter / Consignor (e.g. "YIWU TONGGANG IMPORT AND EXPORT CO., LTD", "HANGZHOU BAOFENG IMP. & EXP. CO., LTD")
- shipperAddress: Shipper complete address
- shipperCountry: Country of origin / shipper country (e.g. "China")
- shipperContact: Shipper phone number
- shipperEmail: Shipper email address
- consigneeName: Importer / Consignee / Customer (e.g. "U.S TRADERS", "ALFA TEXTILE")
- consigneeAddress: Importer / Consignee complete address
- consigneeContact: Importer phone number (e.g. "0092 321 6464924")
- consigneeEmail: Importer email address (e.g. "usmanrajaa@yahoo.com")
- ntnNumber: Importer NTN / Tax ID (e.g. "5041761", "A629270-8")
- notifyPartyName: Notify party name if present
- notifyPartyAddress: Notify party address
- shippingAgent: Shipping Agent references (e.g. "RIAZEDA (PVT) LTD", "CMA CGM PAKISTAN PVT LTD")
- gdNo: Goods Declaration / TP number (e.g. "KAPS-TP-186918-01-05-2026")
- gdDate: GD filing date (YYYY-MM-DD, e.g. "2026-05-01")
- tpNumber: Transshipment Permit number (e.g. "KAPS-TP-186918-01-05-2026")
- igmNo: Import General Manifest number (e.g. "PKKHISAPT_230426123555")
- igmDate: IGM date (YYYY-MM-DD, e.g. "2026-04-23")
- indexNo: Manifest index number (e.g. "383")
- vehicleNumber: External truck registration or transport unit number (e.g. "TLG799")
- carrierName: Bonded carrier company (e.g. "TRUCKIT (PRIVATE) LIMITED", "Docks (Pvt) Ltd")
- invoiceNo: Commercial invoice number (e.g. "AZ26-02TH", "ZK1353/225")
- invoiceDate: Commercial invoice date (YYYY-MM-DD, e.g. "2026-03-26", "2026-06-09")
- invoiceValue: Total invoice value as number (e.g. 19356, 53256)
- invoiceCurrency: Currency code (e.g. "USD", "EUR", "PKR")
- incoTerms: Commercial terms (e.g. "CFR", "CIF", "FOB", "D/P AT SIGHT")
- itemName: Commercial goods description (e.g. "ASSORTED TOYS", "MICRO VELVET FABRIC")
- itemType: High level classification (e.g. "Toys & Consumer Goods", "Textile Fabric")
- hsCode: Harmonized tariff code (e.g. "9503.0090", "5801.3700")
- packagingType: Packaging description (e.g. "CARTONS", "ROLLS", "BALES")
- packageCount: Total quantity of packages as number (e.g. 460, 225)
- totalWeight: Gross weight in KG (convert MT to KG, e.g. 11.685 MT = 11685, 13410)
- grossWeight: Gross weight in KG (e.g. 11685, 13410)
- netWeight: Net weight in KG (e.g. 10185, 12680)
- volumeCBM: Total volume in CBM (e.g. 68.0)
- containers: Array of container objects:
  [
    {
      "number": "ECMU8087489",
      "size": "45ft",
      "weight": 11685,
      "sealNo": "Bolt-3580312"
    }
  ]
- suggestedCategory: "Bonded Carrier" (if Transshipment Permit TP or upcountry dry port), or "Ocean Freight Import"
- docCategoryDetected: Summary of detected documents

Return ONLY valid JSON.`;

                  parts.push({ text: extractionInstruction });

                  let apiResponse: any = null;
                  const models = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
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

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(apiResponse?.text || '{}');
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
