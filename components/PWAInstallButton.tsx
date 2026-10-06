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
      appName: "MAK Group of Companies",
      packageName: "com.makgroup.app",
      appUrl: appOrigin,
      manifestUrl: manifestUrl,
      assetLinksUrl: `${appOrigin}/.well-known/assetlinks.json`,
      apkGeneratorUrl: pwaBuilderUrl,
      instructions: [
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
    a.download = 'mak-group-app-builder-config.json';
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

            {/* TAB 1: DOWNLOAD APK */}
            {activeTab === 'apk' && (
              <div className="space-y-3.5 text-xs text-gray-300">
                <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-100 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-emerald-300 text-sm">
                    <Sparkles size={16} />
                    <span>Android APK Generator Ready</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-emerald-200">
                    The official Web Manifest and Service Worker are 100% configured. Use the 1-click generator below to download the direct <strong>.apk file</strong> and install it on any Android device or share it.
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
                    <span>3 Easy Ways to Install or Get the App:</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-gray-300 leading-relaxed">
                    <li>
                      <strong>Method 1 (Instant):</strong> Click the generator button above &rarr; select <strong>&quot;Package for Android&quot;</strong> on <em>PWABuilder</em> to get the signed <code className="text-emerald-300 font-mono">mak-group.apk</code> file.
                    </li>
                    <li>
                      <strong>Method 2 (Direct Mobile Install):</strong> Open this web application in Google Chrome on your Android device and tap <strong>&quot;Install App&quot;</strong> from the Chrome menu.
                    </li>
                    <li>
                      <strong>Method 3 (CLI / Terminal):</strong> Run the official command below in your development terminal:
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
                  Install directly on your device without downloading raw APK files. Powered by Android's official WebAPK engine for native performance: instant offline caching, full-screen view, and no browser address bar.
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
                    <span>Install MAK Group App Now (Instant)</span>
                  </button>
                ) : (
                  <div className="p-3 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-300 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-brand-400 shrink-0" />
                    <span>Follow these quick steps to install directly from your mobile browser:</span>
                  </div>
                )}

                {/* Android Steps */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-white font-bold">
                    <span className="text-base">🤖</span>
                    <span>Android (Google Chrome / Edge / Samsung Internet)</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-gray-300 text-[11px] leading-relaxed">
                    <li>Tap the <strong>3 dots (⋮)</strong> menu in the top-right corner of your browser.</li>
                    <li>Select <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home screen&quot;</strong>.</li>
                    <li>The app will install directly into your phone&apos;s app drawer.</li>
                  </ol>
                </div>

                {/* iPhone Steps */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-white font-bold">
                    <span className="text-base">🍎</span>
                    <span>Apple iPhone / iPad (Safari)</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-gray-300 text-[11px] leading-relaxed">
                    <li>Tap the <strong>Share button</strong> (square with up-arrow) at the bottom in Safari.</li>
                    <li>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>.</li>
                    <li>Tap <strong>&quot;Add&quot;</strong> in the top-right corner to finish.</li>
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
                    This application includes full Google Play Store compliance: <strong>Web Manifest</strong>, <strong>Service Worker</strong>, <strong>High-Res Icons (192px/512px)</strong>, and <strong>Digital Asset Links</strong>.
                  </p>
                </div>

                {/* Deployment Steps */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2 text-[11px]">
                  <p className="text-white font-semibold">How to Publish on Google Play Console:</p>
                  <ol className="list-decimal list-inside space-y-2 text-gray-300">
                    <li>
                      <strong>Step 1 (Generate .aab package):</strong>{' '}
                      <a href={pwaBuilderUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 underline font-bold">
                        Open PWABuilder
                      </a>{' '}
                      &rarr; <strong>&quot;Package for Android&quot;</strong> &rarr; select <strong>&quot;Generate AAB&quot;</strong>. This provides the signed <code className="text-emerald-300 font-mono">.aab</code> package.
                    </li>
                    <li>
                      <strong>Step 2 (Open Google Play Console):</strong>{' '}
                      <a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-brand-400 underline font-bold">
                        play.google.com/console
                      </a>{' '}
                      and click <strong>&quot;Create App&quot;</strong>.
                    </li>
                    <li>
                      <strong>Step 3 (Upload .aab):</strong> In the Production or Closed Testing track, click <strong>Create new release</strong> and upload your <code className="text-emerald-300 font-mono">.aab</code> file.
                    </li>
                  </ol>
                </div>

                {/* Google Play Store Listing Data to Copy */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5 text-[11px]">
                  <p className="text-amber-300 font-bold uppercase tracking-wider text-[10px]">
                    Google Play Console Store Listing Data (Copy &amp; Paste):
                  </p>
                  
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-gray-400">App Name:</span>
                      <span className="text-white font-semibold">MAK Group of Companies</span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-gray-400">Package Name:</span>
                      <span className="text-emerald-300 font-mono">com.makgroup.app</span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-gray-400">Category:</span>
                      <span className="text-white font-semibold">Business / Logistics</span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-white/5">
                      <span className="text-gray-400">Privacy Policy URL:</span>
                      <a 
                        href={`${appOrigin}/privacy-policy.html`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-brand-400 underline truncate max-w-[200px]"
                      >
                        {appOrigin}/privacy-policy.html
                      </a>
                    </div>
                  </div>
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
