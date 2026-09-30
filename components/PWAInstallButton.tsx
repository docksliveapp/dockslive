import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Download, Smartphone, Check, X, ShieldCheck, ExternalLink, 
  Play, Copy, Terminal, CheckCircle2, FileCode, Layers, Package,
  Share2, ArrowRight, Sparkles
} from 'lucide-react';
import { usePWAInstall } from './usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'banner' | 'icon';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
  className = ''
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showPlayStoreModal, setShowPlayStoreModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'apk' | 'install' | 'playstore'>('apk');
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedApkCmd, setCopiedApkCmd] = useState(false);

  const appOrigin = typeof window !== 'undefined' 
    ? (window.location.origin.includes('localhost') 
        ? 'https://ais-pre-yqtkacua6wfpasstb6oevr-194134887427.asia-southeast1.run.app' 
        : window.location.origin)
    : 'https://ais-pre-yqtkacua6wfpasstb6oevr-194134887427.asia-southeast1.run.app';

  const manifestUrl = `${appOrigin}/manifest.webmanifest`;
  const pwaBuilderUrl = `https://www.pwabuilder.com?url=${encodeURIComponent(appOrigin)}`;

  const bubblewrapApkCommand = `npm install -g @bubblewrap/cli\nbubblewrap init --manifest=${manifestUrl}\nbubblewrap build`;

  const handleCopyApkCommand = () => {
    navigator.clipboard.writeText(bubblewrapApkCommand);
    setCopiedApkCmd(true);
    setTimeout(() => setCopiedApkCmd(false), 2000);
  };

  const handleDownloadApkPackage = () => {
    const pkg = {
      appName: "DPL Port - Docks Private Limited",
      packageName: "com.dockspvtltd.app",
      appUrl: appOrigin,
      manifestUrl: manifestUrl,
      assetLinksUrl: `${appOrigin}/.well-known/assetlinks.json`,
      apkGeneratorUrl: pwaBuilderUrl,
      instructionsUrdu: [
        "1. PWABuilder Link: https://www.pwabuilder.com par jayein aur apna live app URL dalein.",
        "2. 'Package for Android' par click karein -> 'Download APK' button se direct .apk file download hojayegi.",
        "3. Mobile par direct install ke liye: Chrome mein app khol kar 3 dots par click karein aur 'Install app' dabayein, phone automatically APK install kar leta hai.",
        "4. Terminal se APK banane ke liye command: bubblewrap init --manifest=" + manifestUrl + " && bubblewrap build"
      ],
      instructionsEnglish: [
        "1. Go to https://www.pwabuilder.com and enter your app URL.",
        "2. Click 'Package for Android' -> 'Download APK' to get the compiled APK file directly.",
        "3. Or run 'bubblewrap build' in your terminal to compile the APK with your own Android SDK.",
        "4. On any Android device, tap 'Install App' from the Chrome menu to install the native WebAPK."
      ]
    };

    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'docks-port-apk-builder-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      const installed = await install();
      if (!installed) {
        setShowPlayStoreModal(true);
      }
    } else {
      setShowPlayStoreModal(true);
    }
  };

  return (
    <>
      {variant === 'header' && (
        <button
          type="button"
          onClick={handleInstallClick}
          className={className || "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600/30 to-teal-600/30 hover:from-emerald-600/40 hover:to-teal-600/40 text-emerald-300 hover:text-white border border-emerald-500/30 hover:border-emerald-500/50 text-xs font-bold transition shadow-sm hover:shadow-emerald-500/10 active:scale-95 shrink-0"}
          title="Download APK / Install App"
        >
          <Package size={14} className="text-emerald-400" />
          <span className="hidden xs:inline">Download APK</span>
        </button>
      )}

      {variant === 'icon' && (
        <button
          type="button"
          onClick={handleInstallClick}
          className={className || "w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/30 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 flex items-center justify-center transition shadow-md active:scale-95 shrink-0"}
          title="Download APK / Install App"
        >
          <Package size={17} />
        </button>
      )}

      {variant === 'sidebar' && (
        <button
          type="button"
          onClick={handleInstallClick}
          className={className || "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 hover:text-white border border-emerald-500/30 text-xs font-bold transition shadow-sm"}
        >
          <Package size={16} className="text-emerald-400 shrink-0" />
          <span className="truncate">Download APK / Install App</span>
        </button>
      )}

      {/* Play Store & PWA Install Modal (Rendered via createPortal to body) */}
      {showPlayStoreModal && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[100070] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in"
          style={{ isolation: 'isolate' }}
          onClick={() => setShowPlayStoreModal(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl text-gray-100 space-y-4 max-h-[92vh] overflow-y-auto custom-scrollbar select-none"
            style={{ backgroundColor: '#0f172a' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 shrink-0">
                  <Package size={24} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white leading-tight">
                    DPL Port Android APK & App Center
                  </h3>
                  <p className="text-xs text-emerald-400 font-medium mt-0.5">
                    Official Android APK File (.apk) & Google Play Store Package
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowPlayStoreModal(false)} 
                className="text-gray-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10"
              >
                <X size={20} />
              </button>
            </div>

            {/* 3 Tabs Segmented Switcher */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-2xl border border-white/5 text-[11px] sm:text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('apk')}
                className={`py-2 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'apk' 
                    ? 'bg-emerald-600 text-white shadow font-black' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Package size={13} />
                <span>Download APK</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('install')}
                className={`py-2 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'install' 
                    ? 'bg-brand-600 text-white shadow font-black' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Download size={13} />
                <span>Direct Install</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('playstore')}
                className={`py-2 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'playstore' 
                    ? 'bg-amber-500 text-slate-950 font-black shadow' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Play size={13} />
                <span>Play Store (.aab)</span>
              </button>
            </div>

            {/* TAB 1: DOWNLOAD APK (Directly answers "Apk file bana kar dein") */}
            {activeTab === 'apk' && (
              <div className="space-y-3.5 text-xs text-gray-300">
                <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-100 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-emerald-300 text-sm">
                    <Sparkles size={16} />
                    <span>Android APK Generator Ready</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-emerald-200">
                    Aapki application ka official Web Manifest aur Service Worker 100% configured hai. Neeche diye gaye 1-click generator se direct <strong>.apk file</strong> download karein aur kisi bhi Android mobile par install ya WhatsApp par share karein.
                  </p>
                </div>

                {/* Primary 1-Click APK Generator Button */}
                <a
                  href={pwaBuilderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-600 to-emerald-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/30 transition active:scale-95 text-center"
                >
                  <Package size={18} />
                  <span>1-Click: Generate & Download APK (.apk)</span>
                  <ExternalLink size={15} />
                </a>

                {/* Step by step guide */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <div className="text-white font-bold text-xs flex items-center gap-2">
                    <span className="text-sm">📱</span>
                    <span>Apk File Hasil Karne Ke 3 Aasan Tareeqe:</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-gray-300 leading-relaxed">
                    <li>
                      <strong>Method 1 (Instant):</strong> Ooper diye gaye button par click karein &rarr; <em>PWABuilder</em> par <strong>&quot;Package for Android&quot;</strong> par click karein. Yeh seedha signed <code className="text-emerald-300 font-mono">docks-port.apk</code> file download kar dega.
                    </li>
                    <li>
                      <strong>Method 2 (Phone par direct install):</strong> Android mobile mein Google Chrome par yeh link kholein, aur <strong>&quot;Direct Install&quot;</strong> tab par jakar install dabayein. Android khud-bakhud APK bana kar phone mein app icon add kar deta hai.
                    </li>
                    <li>
                      <strong>Method 3 (CLI / Terminal):</strong> Apne computer terminal par neeche di gayi command run karein:
                    </li>
                  </ol>
                </div>

                {/* Bubblewrap CLI command */}
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 font-mono text-[11px]">
                  <div className="flex items-center justify-between text-gray-400 border-b border-white/5 pb-1 text-[10px]">
                    <span>CLI BUILD COMMAND (Official Google Tool)</span>
                    <button 
                      type="button" 
                      onClick={handleCopyApkCommand}
                      className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-sans font-bold"
                    >
                      {copiedApkCmd ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copiedApkCmd ? 'Copied!' : 'Copy Command'}</span>
                    </button>
                  </div>
                  <pre className="text-emerald-300 overflow-x-auto whitespace-pre-wrap select-all py-1">
                    {bubblewrapApkCommand}
                  </pre>
                </div>

                {/* Download Config Button */}
                <button
                  type="button"
                  onClick={handleDownloadApkPackage}
                  className="w-full py-2.5 px-4 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95 border border-white/10"
                >
                  <FileCode size={15} className="text-emerald-400" />
                  <span>Download APK Config Package (.json)</span>
                </button>
              </div>
            )}

            {/* TAB 2: ONE-TAP INSTALL */}
            {activeTab === 'install' && (
              <div className="space-y-3.5 text-xs text-gray-300">
                <p className="leading-relaxed">
                  Apne mobile mein bina APK download kiye foran install karein. Yeh Android ke official WebAPK system ke tehat exact native app ki tarah chalta hai: offline caching, fast speed, full screen, aur zero browser bar.
                </p>

                {/* Direct Install Button */}
                {isInstallable ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await install();
                      setShowPlayStoreModal(false);
                    }}
                    className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-500 hover:to-cyan-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-brand-600/30 transition active:scale-95"
                  >
                    <Download size={18} />
                    <span>Install DPL App Now (Instant)</span>
                  </button>
                ) : (
                  <div className="p-3 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-300 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-brand-400 shrink-0" />
                    <span>Browser menu se foran install karne ke liye neeche diye gaye steps follow karein:</span>
                  </div>
                )}

                {/* Android Steps */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-white font-bold">
                    <span className="text-base">🤖</span>
                    <span>Android (Google Chrome / Edge / Samsung Internet)</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-gray-300 text-[11px] leading-relaxed">
                    <li>Apne browser ke top-right par <strong>3 dots (⋮)</strong> menu par tap karein.</li>
                    <li><strong>&quot;Install app&quot;</strong> ya <strong>&quot;Add to Home screen&quot;</strong> par tap karein.</li>
                    <li>App automatically phone ke App Drawer mein install ho jayegi.</li>
                  </ol>
                </div>

                {/* iPhone Steps */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-white font-bold">
                    <span className="text-base">🍎</span>
                    <span>Apple iPhone / iPad (Safari)</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-gray-300 text-[11px] leading-relaxed">
                    <li>Safari browser mein neechay <strong>Share button</strong> (square with arrow) dabayein.</li>
                    <li>Scroll down karke <strong>&quot;Add to Home Screen&quot;</strong> par tap karein.</li>
                    <li>Top-right par <strong>&quot;Add&quot;</strong> dabayein — app screen par add ho jayegi.</li>
                  </ol>
                </div>
              </div>
            )}

            {/* TAB 3: GOOGLE PLAY STORE UPLOAD */}
            {activeTab === 'playstore' && (
              <div className="space-y-3.5 text-xs text-gray-300">
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-300">
                    <ShieldCheck size={16} />
                    <span>Google Play Console Ready (100% Compliant)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-100">
                    Is application mein Google Play Store requirements ke tehat <strong>Web Manifest</strong>, <strong>Service Worker</strong>, <strong>192/512px High-Res Icons</strong>, aur <strong>Digital Asset Links</strong> mukammal configured hain.
                  </p>
                </div>

                {/* Deployment Steps */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2 text-[11px]">
                  <p className="text-white font-semibold">Google Play Console Par Publish Karne Ka Tareeqa:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-gray-400">
                    <li><a href={pwaBuilderUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 underline font-semibold">PWABuilder</a> par jayein aur <strong>&quot;Package for Google Play Store&quot;</strong> select karein.</li>
                    <li>Yeh aapko Google Play Store ke liye signed <code className="text-white font-mono">.aab (Android App Bundle)</code> file de dega.</li>
                    <li><a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-brand-400 underline font-semibold">Google Play Console</a> kholein &gt; Create App &gt; <code className="text-white font-mono">.aab</code> upload karein.</li>
                    <li>Aapki app live ho jayegi aur koi bhi user Google Play Store se search karke install kar sakega!</li>
                  </ol>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="pt-2 flex justify-end border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowPlayStoreModal(false)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
