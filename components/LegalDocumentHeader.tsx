import React from 'react';
import { CompanyId, getActiveCompany, GROUP_COMPANIES, DEFAULT_PARENT_GROUP, getParentGroupInfo, getCompanyLogoUrl } from '../services/companyService';
import { formatPdfDate } from '../services/pdfExportService';

export interface LegalDocumentHeaderProps {
  title: string;
  refNo?: string;
  date?: string;
  subRef?: string;
  subject?: string;
  clientName?: string;
  className?: string;
}

export const LegalDocumentHeader: React.FC<LegalDocumentHeaderProps> = ({
  title,
  refNo,
  date,
  subRef,
  subject,
  clientName,
  className = ""
}) => {
  const parentGroup = getParentGroupInfo();
  const topLogoUrl = parentGroup.documentLogo || parentGroup.logo || '/logos/mak_group_logo.svg';
  const currentDate = formatPdfDate(date);

  return (
    <div className={`w-full bg-white text-slate-900 border-b-2 border-slate-900 pb-4 mb-6 select-none ${className}`}>
      {/* Top Luxury Accent Bars */}
      <div className="w-full flex flex-col mb-4">
        <div className="h-1.5 w-full bg-slate-900" />
        <div className="h-0.5 w-full bg-amber-500" />
      </div>

      {/* Main Letterhead Row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-2">
        {/* Left: Official MAK Group Corporate Emblem & Identity (Transparent Original Shape) */}
        <div className="flex items-center gap-4">
          <img 
            src={topLogoUrl} 
            alt="MAK Group of Companies" 
            className="h-16 sm:h-20 w-auto max-w-[200px] object-contain shrink-0 bg-transparent"
          />
          <div className="flex flex-col justify-center">
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-slate-900 leading-tight">
              MAK GROUP OF COMPANIES
            </h1>
            <p className="text-[10px] sm:text-[11px] font-extrabold text-amber-700 uppercase tracking-wider mt-0.5">
              PREMIER MULTI-ENTITY LOGISTICS, CUSTOMS &amp; TRADE CONGLOMERATE
            </p>
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-700 uppercase tracking-wide mt-0.5">
              DOCKS (PVT) LTD &bull; TRUCKIT (PVT) LTD &bull; MUHIB INTL &bull; VANTAGE SHIPPING
            </p>
            <p className="text-[8.5px] sm:text-[9px] text-slate-500 mt-0.5">
              Customs Bonded Carrier &bull; Fleet Haulage &bull; Ocean Freight &bull; Freight Forwarding
            </p>
          </div>
        </div>

        {/* Right: Document Classification & Identification */}
        <div className="text-left sm:text-right shrink-0 border-l sm:border-l-0 sm:border-r-0 border-slate-200 pl-3 sm:pl-0">
          <span className="inline-block px-3 py-1 bg-amber-500 text-slate-950 font-black text-xs sm:text-sm tracking-wider uppercase rounded shadow-sm">
            {title}
          </span>
          {refNo && (
            <p className="font-mono font-bold text-sm text-slate-900 mt-1.5">
              Ref: {refNo}
            </p>
          )}
          <p className="text-xs text-slate-600 mt-0.5">
            Date: <span className="font-medium text-slate-900">{currentDate}</span>
          </p>
          {clientName && (
            <p className="text-xs text-slate-700 mt-0.5">
              Party: <span className="font-bold text-slate-900">{clientName}</span>
            </p>
          )}
          {subRef && (
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
              {subRef}
            </p>
          )}
        </div>
      </div>

      {/* Horizontal Divider */}
      <div className="w-full h-px bg-slate-300 mt-3 mb-2" />

      {/* Executive Subject Banner */}
      <div className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded flex items-center justify-between text-xs">
        <span className="font-bold text-slate-800 tracking-wide uppercase">
          {subject || `OFFICIAL LEGAL RECORD: ${title.toUpperCase()}`}
        </span>
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest hidden sm:inline">
          MAK OFFICIAL ERP DISPATCH
        </span>
      </div>
    </div>
  );
};

export interface LegalDocumentFooterProps {
  companyId?: CompanyId;
  signerTitle?: string;
  signerName?: string;
  notes?: string;
  className?: string;
}

export const LegalDocumentFooter: React.FC<LegalDocumentFooterProps> = ({
  companyId,
  signerTitle,
  signerName,
  notes,
  className = ""
}) => {
  const activeComp = companyId ? GROUP_COMPANIES[companyId] : getActiveCompany();
  const operatingLogoUrl = getCompanyLogoUrl(activeComp.id);

  return (
    <div className={`w-full mt-8 pt-4 border-t-2 border-slate-900 text-slate-800 select-none ${className}`}>
      {/* Signatures & Seal Row */}
      <div className="flex flex-col sm:flex-row justify-between items-end gap-6 mb-6 px-2">
        <div className="flex items-center gap-3.5 bg-slate-50 border border-slate-300 rounded-lg p-3 max-w-md">
          {operatingLogoUrl && (
            <img
              src={operatingLogoUrl}
              alt={activeComp?.legalTitle || activeComp?.name}
              className="h-12 w-12 object-contain shrink-0 bg-transparent"
            />
          )}
          <div className="text-xs text-slate-700">
            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
              Client &amp; Case Managed By (Operating Company):
            </p>
            <p className="font-bold text-sm text-slate-900 uppercase">
              {activeComp?.legalTitle || activeComp?.name}
            </p>
            <p className="text-[11px] text-slate-600">
              {activeComp?.category} &bull; Code: {activeComp?.prefix}
            </p>
            {notes && <p className="italic text-[10px] text-slate-500 mt-0.5">{notes}</p>}
          </div>
        </div>

        {/* Operating Entity Stamp & Signatory Box */}
        <div className="border border-slate-900 rounded-lg p-3 text-center min-w-[220px] bg-white shadow-sm">
          <p className="text-[9px] font-bold text-amber-700 uppercase tracking-widest">
            {activeComp?.legalTitle || activeComp?.name || "MAK GROUP OF COMPANIES"}
          </p>
          <p className="text-[8px] text-slate-500 uppercase">
            {activeComp?.category || "Operating Subsidiary"}
          </p>
          <div className="h-12 flex items-center justify-center my-1 border-b border-dashed border-slate-300">
            <span className="text-[10px] font-mono text-slate-400 italic">
              [Official Carrier Seal &amp; Stamp]
            </span>
          </div>
          <p className="text-xs font-bold text-slate-900 uppercase">
            {signerName || activeComp?.directorName || "Authorized Signatory"}
          </p>
          <p className="text-[10px] text-slate-600 font-medium">
            {signerTitle || activeComp?.directorTitle || "Director / Authorized Officer"}
          </p>
        </div>
      </div>

      {/* Head Office Address & Contact Divider */}
      <div className="border-t border-slate-300 pt-3 text-center text-xs space-y-1">
        <p className="font-bold text-[11px] text-slate-800">
          Head Office: {DEFAULT_PARENT_GROUP.address}
        </p>
        <p className="text-[10px] text-slate-600">
          Tel: {DEFAULT_PARENT_GROUP.phone} &nbsp;|&nbsp; Cell: {DEFAULT_PARENT_GROUP.cell} &nbsp;|&nbsp; Email: {DEFAULT_PARENT_GROUP.email} &nbsp;|&nbsp; Web: {DEFAULT_PARENT_GROUP.web}
        </p>
        <p className="text-[9px] font-mono text-slate-500 tracking-wider uppercase mt-1">
          MAK GROUP OF COMPANIES &bull; DOCKS &bull; TRUCKIT &bull; MUHIB &bull; VANTAGE &bull; OFFICIAL ERP RECORD
        </p>
      </div>
    </div>
  );
};

export default LegalDocumentHeader;
