import React from 'react';
import { 
  Building2, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  X, 
  ShieldCheck, 
  Ship, 
  Truck, 
  Globe, 
  Anchor
} from 'lucide-react';
import { 
  CompanyId, 
  CompanyInfo, 
  GROUP_COMPANIES, 
  COMPANIES_LIST, 
  PARENT_GROUP, 
  useActiveCompany 
} from '../services/companyService';

interface CompanyWorkspaceSelectorProps {
  onSelectCompany: (companyId: CompanyId) => void;
  isModal?: boolean;
  onClose?: () => void;
  userName?: string;
  userRoleTitle?: string;
}

export const CompanyWorkspaceSelector: React.FC<CompanyWorkspaceSelectorProps> = ({
  onSelectCompany,
  isModal = false,
  onClose,
  userName,
  userRoleTitle
}) => {
  const { companyId: currentActiveId } = useActiveCompany();

  const getCompanyIcon = (id: CompanyId) => {
    switch (id) {
      case 'docks':
        return <Anchor className="w-5 h-5 text-amber-400" />;
      case 'muhib':
        return <Globe className="w-5 h-5 text-blue-400" />;
      case 'vantage':
        return <Ship className="w-5 h-5 text-cyan-400" />;
      case 'truckit':
        return <Truck className="w-5 h-5 text-red-400" />;
    }
  };

  const content = (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-center min-h-full">
      {/* Top Conglomerate Header */}
      <div className="text-center mb-8 relative">
        {isModal && onClose && (
          <button
            onClick={onClose}
            className="absolute top-0 right-0 p-2 text-gray-400 hover:text-white rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        )}

        <div className="inline-flex items-center justify-center mb-4 transform hover:scale-105 transition-transform duration-300">
          <img 
            src={PARENT_GROUP.logo} 
            alt={PARENT_GROUP.name} 
            className="w-24 sm:w-32 max-h-24 object-contain drop-shadow-[0_8px_30px_rgba(245,158,11,0.4)]"
          />
        </div>

        <div className="flex items-center justify-center gap-2 mb-1.5">
          <span className="h-px w-8 sm:w-16 bg-gradient-to-r from-transparent to-amber-400" />
          <span className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.3em] text-amber-400 font-sans">
            Enterprise Multi-Entity Workspace
          </span>
          <span className="h-px w-8 sm:w-16 bg-gradient-to-l from-transparent to-amber-400" />
        </div>

        <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-wide font-serif mb-2">
          {PARENT_GROUP.title}
        </h1>

        <p className="text-xs sm:text-sm text-gray-300 max-w-2xl mx-auto font-sans leading-relaxed">
          Select an enterprise subsidiary below to enter its isolated workspace. All client records, financial books, cases, fleet, and operations remain 100% segregated.
        </p>

        {userName && (
          <div className="inline-flex items-center gap-2 mt-4 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-amber-500/30 text-xs text-amber-200 backdrop-blur-md">
            <ShieldCheck size={14} className="text-amber-400" />
            <span>Active Session: <strong>{userName}</strong> {userRoleTitle ? `(${userRoleTitle})` : ''}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1" />
            <span className="text-[10px] text-emerald-400 font-semibold">Authorized</span>
          </div>
        )}
      </div>

      {/* 4 Large Glassy Company Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-6">
        {COMPANIES_LIST.map((comp) => {
          const isCurrentActive = comp.id === currentActiveId;

          // Per-company customized styling accents
          const getCardStyles = () => {
            switch (comp.id) {
              case 'docks':
                return {
                  border: isCurrentActive ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-amber-500/30 hover:border-amber-400',
                  glow: 'hover:shadow-[0_0_40px_rgba(245,158,11,0.28)]',
                  bgGradient: 'from-amber-950/40 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                  buttonBg: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950',
                  btnRing: 'focus:ring-amber-400'
                };
              case 'muhib':
                return {
                  border: isCurrentActive ? 'border-blue-400 ring-2 ring-blue-400/50' : 'border-blue-500/30 hover:border-blue-400',
                  glow: 'hover:shadow-[0_0_40px_rgba(37,99,235,0.28)]',
                  bgGradient: 'from-blue-950/40 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
                  buttonBg: 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white',
                  btnRing: 'focus:ring-blue-400'
                };
              case 'vantage':
                return {
                  border: isCurrentActive ? 'border-cyan-400 ring-2 ring-cyan-400/50' : 'border-cyan-500/30 hover:border-cyan-400',
                  glow: 'hover:shadow-[0_0_40px_rgba(14,165,233,0.28)]',
                  bgGradient: 'from-cyan-950/40 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
                  buttonBg: 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950',
                  btnRing: 'focus:ring-cyan-400'
                };
              case 'truckit':
                return {
                  border: isCurrentActive ? 'border-red-400 ring-2 ring-red-400/50' : 'border-red-500/30 hover:border-red-400',
                  glow: 'hover:shadow-[0_0_40px_rgba(239,68,68,0.28)]',
                  bgGradient: 'from-red-950/40 via-slate-900/90 to-slate-950/95',
                  badgeBg: 'bg-red-500/20 text-red-300 border-red-500/40',
                  buttonBg: 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white',
                  btnRing: 'focus:ring-red-400'
                };
            }
          };

          const styles = getCardStyles();

          return (
            <div
              key={comp.id}
              onClick={() => onSelectCompany(comp.id)}
              className={`group relative rounded-3xl p-6 sm:p-7 flex flex-col justify-between cursor-pointer transition-all duration-300 backdrop-blur-xl bg-gradient-to-b ${styles.bgGradient} border ${styles.border} ${styles.glow} transform hover:-translate-y-1`}
            >
              {/* Active Indicator Pin */}
              {isCurrentActive && (
                <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold shadow-lg">
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  <span>Active Now</span>
                </div>
              )}

              {/* Card Header: Logo & Badge */}
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${styles.badgeBg} flex items-center gap-1.5`}>
                    {getCompanyIcon(comp.id)}
                    {comp.shortName}
                  </span>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest font-mono">
                    ID: {comp.id.toUpperCase()}
                  </span>
                </div>

                {/* Company Logo in Card */}
                <div className="h-28 sm:h-32 w-full flex items-center justify-center p-3 rounded-2xl bg-black/40 border border-white/5 mb-5 group-hover:scale-[1.03] transition-transform duration-300">
                  <img 
                    src={comp.logo} 
                    alt={comp.name} 
                    className="max-h-full max-w-full object-contain filter drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]" 
                  />
                </div>

                {/* Title & Category */}
                <h3 className="text-lg sm:text-xl font-bold text-white group-hover:text-amber-300 transition-colors leading-snug">
                  {comp.name}
                </h3>
                <p className="text-xs font-semibold text-gray-300 mt-1 line-clamp-1">
                  {comp.category}
                </p>

                {/* Short Description */}
                <p className="text-xs text-gray-400 mt-2.5 line-clamp-2 leading-relaxed">
                  {comp.description}
                </p>

                {/* Core Features list */}
                <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                  {comp.features.slice(0, 3).map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[11px] text-gray-300">
                      <Sparkles size={11} className="text-amber-400 shrink-0" />
                      <span className="line-clamp-1">{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-6 pt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCompany(comp.id);
                  }}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${styles.buttonBg}`}
                >
                  <span>{isCurrentActive ? 'Continue in Workspace' : 'Open Workspace • داخل ہوں'}</span>
                  <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Footer Note */}
      <div className="text-center mt-8 text-xs text-gray-500 font-sans">
        MAK Group of Companies • Cross-entity user authentication enabled. You can seamlessly switch subsidiaries at any time from the top bar.
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
        <div className="relative w-full max-w-7xl bg-slate-950/95 border border-white/10 rounded-3xl shadow-2xl my-auto">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] w-full bg-[#030712] text-gray-100 flex items-center justify-center overflow-y-auto py-6 relative">
      {/* Background cyber ambient glow */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.08) 0%, transparent 60%),
            linear-gradient(to right, rgba(56, 189, 248, 0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(56, 189, 248, 0.06) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 48px 48px, 48px 48px'
        }}
      />
      {content}
    </div>
  );
};

export default CompanyWorkspaceSelector;
