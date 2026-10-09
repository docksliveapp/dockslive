import React from 'react';
import { 
  UniversalDocumentPreviewModal, 
  DataMappingCheckItem, 
  SupportedPreviewFormat 
} from './UniversalDocumentPreviewModal';

export interface PdfViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl?: string | Blob | ArrayBuffer | any | null;
  filename?: string;
  title?: string;
  fileType?: SupportedPreviewFormat;
  verificationItems?: DataMappingCheckItem[];
  onDownload?: () => void;
}

/**
 * Universal executive document preview modal for .docx, .pdf, .jpg, .jpeg, and .xlsx files.
 * Provides high-fidelity rendering, data mapping verification, zoom, rotate, search, print & verified downloads.
 */
export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  isOpen,
  onClose,
  pdfUrl,
  filename = 'document.pdf',
  title,
  fileType = 'auto',
  verificationItems = [],
  onDownload
}) => {
  return (
    <UniversalDocumentPreviewModal
      isOpen={isOpen}
      onClose={onClose}
      file={pdfUrl}
      filename={filename}
      title={title}
      fileType={fileType}
      verificationItems={verificationItems}
      onDownload={onDownload}
    />
  );
};

