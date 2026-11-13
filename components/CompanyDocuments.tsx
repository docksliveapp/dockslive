import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Upload,
  FileText,
  Image as ImageIcon,
  Search,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Eye,
  Edit,
  Trash2,
  Download,
  FolderInput,
  X,
  Check,
  Loader2,
  AlertTriangle,
  Home
} from 'lucide-react';
import { CompanyDocument, CompanyExplorerFolder } from '../types';
import {
  subscribeToCompanyDocuments,
  saveCompanyDocumentToFirestore,
  deleteCompanyDocumentFromFirestore,
  subscribeToCompanyExplorerFolders,
  saveCompanyExplorerFolderToFirestore,
  deleteCompanyExplorerFolderFromFirestore
} from '../services/dbService';
import { resolveStoredDocumentDataUrl } from '../services/documentStorage';
import { downloadFile } from '../services/geminiService';
import { safeAppStorage } from '../services/storage';
import { useActiveCompany } from '../services/companyService';
import { ThemeToggleSwitch } from './ThemeToggleSwitch';
import {
  UniversalDocumentPreviewModal,
  DataMappingCheckItem
} from './UniversalDocumentPreviewModal';
import { CompanyDocumentUploadModal } from './CompanyDocumentUploadModal';

type ViewMode = 'GRID' | 'DETAILS';

interface MoveTargetState {
  kind: 'FOLDER' | 'DOCUMENT';
  id: string;
  title: string;
  currentParentId: string | null;
}

function isImageDocument(docItem: CompanyDocument): boolean {
  const mime = (docItem.fileType || '').toLowerCase();
  const fname = (docItem.fileName || '').toLowerCase();
  const url = (docItem.fileUrl || '').toLowerCase();
  return (
    mime.startsWith('image/') ||
    url.startsWith('data:image/') ||
    /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(fname)
  );
}

function formatExpirySummary(docItem: CompanyDocument, todayIso: string): {
  label: string;
  tone: 'neutral' | 'valid' | 'warning' | 'danger';
} {
  const expDate = docItem.expiryDate || docItem.validityEndDate || '';
  const hasExp =
    docItem.hasExpiryDate !== undefined
      ? docItem.hasExpiryDate
      : Boolean(expDate) && !docItem.unlimitedValidity;

  if (!hasExp || !expDate) {
    return { label: 'No Expiry', tone: 'neutral' };
  }

  const expMs = new Date(`${expDate}T00:00:00`).getTime();
  const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
  if (isNaN(expMs)) {
    return { label: expDate, tone: 'neutral' };
  }

  const diffDays = Math.ceil((expMs - todayMs) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return { label: `${expDate} · Expired`, tone: 'danger' };
  }
  if (diffDays === 0) {
    return { label: `${expDate} · Today`, tone: 'danger' };
  }
  if (diffDays <= 15) {
    return { label: `${expDate} · ${diffDays}d left`, tone: 'warning' };
  }
  return { label: expDate, tone: 'valid' };
}

function formatHearingSummary(docItem: CompanyDocument, todayIso: string): {
  label: string;
  tone: 'neutral' | 'info' | 'warning' | 'danger';
} {
  const hearDate = docItem.hearingDate || '';
  const hasHear =
    docItem.hasHearingDate !== undefined ? docItem.hasHearingDate : Boolean(hearDate);

  if (!hasHear || !hearDate) {
    return { label: 'No Hearing', tone: 'neutral' };
  }

  const hearMs = new Date(`${hearDate}T00:00:00`).getTime();
  const todayMs = new Date(`${todayIso}T00:00:00`).getTime();
  if (isNaN(hearMs)) {
    return { label: hearDate, tone: 'info' };
  }

  const diffDays = Math.ceil((hearMs - todayMs) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return { label: `${hearDate} · Overdue`, tone: 'danger' };
  }
  if (diffDays === 0) {
    return { label: `${hearDate} · Today`, tone: 'warning' };
  }
  if (diffDays <= 7) {
    return { label: `${hearDate} · In ${diffDays}d`, tone: 'warning' };
  }
  return { label: hearDate, tone: 'info' };
}

export const CompanyDocuments: React.FC = () => {
  const { activeCompany } = useActiveCompany();
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Firestore Collections
  const [folders, setFolders] = useState<CompanyExplorerFolder[]>([]);
  const [allDocuments, setAllDocuments] = useState<CompanyDocument[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Explorer Navigation History State (null = Root Main Page)
  const [navHistory, setNavHistory] = useState<Array<string | null>>([null]);
  const [navIndex, setNavIndex] = useState<number>(0);
  const currentFolderId = navHistory[navIndex] ?? null;

  // UI View & Sidebar State
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [showTreePane, setShowTreePane] = useState<boolean>(true);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchScope, setSearchScope] = useState<'ALL' | 'CURRENT'>('ALL');
  const [isWorkspaceDragOver, setIsWorkspaceDragOver] = useState<boolean>(false);

  // Create / Rename Folder Modal State (Asks ONLY for Folder Title)
  const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
  const [renamingFolder, setRenamingFolder] = useState<CompanyExplorerFolder | null>(null);
  const [folderTitleInput, setFolderTitleInput] = useState<string>('');
  const [folderFormError, setFolderFormError] = useState<string | null>(null);
  const [isSavingFolder, setIsSavingFolder] = useState<boolean>(false);

  // Upload / Edit Document Modal State (Exact 7 Fields)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [editingDocument, setEditingDocument] = useState<CompanyDocument | null>(null);
  const [preDroppedFiles, setPreDroppedFiles] = useState<File[] | undefined>(undefined);

  // Document Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<CompanyDocument | null>(null);
  const [previewResolvedFile, setPreviewResolvedFile] = useState<string | null>(null);

  // Move Folder / Document Modal State
  const [moveTarget, setMoveTarget] = useState<MoveTargetState | null>(null);
  const [selectedDestinationFolderId, setSelectedDestinationFolderId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState<boolean>(false);

  // Inline Delete Confirmation Modals
  const [folderPendingDelete, setFolderPendingDelete] = useState<CompanyExplorerFolder | null>(null);
  const [docPendingDelete, setDocPendingDelete] = useState<CompanyDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Subscribe to Firestore folders & documents
  useEffect(() => {
    setIsLoading(true);
    let foldersLoaded = false;
    let docsLoaded = false;

    const unsubFolders = subscribeToCompanyExplorerFolders((items) => {
      setFolders(items || []);
      foldersLoaded = true;
      if (docsLoaded) setIsLoading(false);
    });

    const unsubDocs = subscribeToCompanyDocuments((items) => {
      setAllDocuments(items || []);
      docsLoaded = true;
      if (foldersLoaded) setIsLoading(false);
    });

    return () => {
      unsubFolders();
      unsubDocs();
    };
  }, []);

  // Only show Explorer documents (guarantees a 100% clean, empty slate with zero legacy static items)
  const explorerDocuments = useMemo(
    () => allDocuments.filter((d) => d.isExplorerDocument === true),
    [allDocuments]
  );

  // Folder lookup map
  const folderById = useMemo(() => {
    const map = new Map<string, CompanyExplorerFolder>();
    for (const f of folders) {
      map.set(f.id, f);
    }
    return map;
  }, [folders]);

  // If currentFolderId was deleted externally, safely fall back to Root
  useEffect(() => {
    if (currentFolderId && !folderById.has(currentFolderId) && !isLoading) {
      setNavHistory([null]);
      setNavIndex(0);
    }
  }, [currentFolderId, folderById, isLoading]);

  // Build ordered ancestor chain for any folderId
  const getFolderChain = useCallback(
    (targetId: string | null): CompanyExplorerFolder[] => {
      if (!targetId) return [];
      const chain: CompanyExplorerFolder[] = [];
      const visited = new Set<string>();
      let cursorId: string | null = targetId;

      while (cursorId && !visited.has(cursorId)) {
        visited.add(cursorId);
        const found = folderById.get(cursorId);
        if (!found) break;
        chain.unshift(found);
        cursorId = found.parentFolderId || null;
      }
      return chain;
    },
    [folderById]
  );

  // Build readable breadcrumb path string for any folderId
  const getFolderPathLabel = useCallback(
    (targetId: string | null, overrideMap?: Map<string, CompanyExplorerFolder>): string => {
      const lookup = overrideMap || folderById;
      if (!targetId) return 'Company Documents';
      const parts: string[] = [];
      const visited = new Set<string>();
      let cursorId: string | null = targetId;

      while (cursorId && !visited.has(cursorId)) {
        visited.add(cursorId);
        const found = lookup.get(cursorId);
        if (!found) break;
        parts.unshift(found.title);
        cursorId = found.parentFolderId || null;
      }
      return ['Company Documents', ...parts].join(' › ');
    },
    [folderById]
  );

  const currentFolderChain = useMemo(
    () => getFolderChain(currentFolderId),
    [getFolderChain, currentFolderId]
  );

  const currentFolder = useMemo(
    () => (currentFolderId ? folderById.get(currentFolderId) || null : null),
    [currentFolderId, folderById]
  );

  const currentFolderPathLabel = useMemo(
    () => getFolderPathLabel(currentFolderId),
    [getFolderPathLabel, currentFolderId]
  );

  // Navigate to a folder (pushes to Explorer history & expands ancestor tree nodes)
  const navigateToFolder = useCallback(
    (targetFolderId: string | null) => {
      setSearchQuery('');
      if (targetFolderId === currentFolderId) return;

      setNavHistory((prev) => {
        const sliced = prev.slice(0, navIndex + 1);
        return [...sliced, targetFolderId];
      });
      setNavIndex((prev) => prev + 1);

      if (targetFolderId) {
        const chain = getFolderChain(targetFolderId);
        setExpandedFolderIds((prev) => {
          const next = new Set(prev);
          for (const anc of chain) next.add(anc.id);
          return next;
        });
      }
    },
    [currentFolderId, navIndex, getFolderChain]
  );

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;
  const canGoUp = currentFolderId !== null;

  const handleGoBack = () => {
    if (!canGoBack) return;
    setNavIndex((prev) => prev - 1);
  };

  const handleGoForward = () => {
    if (!canGoForward) return;
    setNavIndex((prev) => prev + 1);
  };

  const handleGoUp = () => {
    if (!currentFolder) {
      navigateToFolder(null);
      return;
    }
    navigateToFolder(currentFolder.parentFolderId || null);
  };

  // Children maps for fast recursive counts & tree rendering
  const childFoldersByParent = useMemo(() => {
    const map = new Map<string | null, CompanyExplorerFolder[]>();
    for (const f of folders) {
      const pid = f.parentFolderId || null;
      const list = map.get(pid) || [];
      list.push(f);
      map.set(pid, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    }
    return map;
  }, [folders]);

  const docsByParent = useMemo(() => {
    const map = new Map<string | null, CompanyDocument[]>();
    for (const d of explorerDocuments) {
      const pid = d.parentFolderId || null;
      const list = map.get(pid) || [];
      list.push(d);
      map.set(pid, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    }
    return map;
  }, [explorerDocuments]);

  // Collect all descendant folder IDs of a folder (for recursive delete & circular-move guard)
  const getDescendantFolderIds = useCallback(
    (rootFolderId: string): Set<string> => {
      const descendants = new Set<string>();
      const stack = [rootFolderId];
      while (stack.length > 0) {
        const curr = stack.pop()!;
        const kids = childFoldersByParent.get(curr) || [];
        for (const k of kids) {
          if (!descendants.has(k.id)) {
            descendants.add(k.id);
            stack.push(k.id);
          }
        }
      }
      return descendants;
    },
    [childFoldersByParent]
  );

  // Direct counts inside a folder
  const getFolderItemCounts = useCallback(
    (folderId: string): { subFoldersCount: number; filesCount: number } => {
      const subFoldersCount = (childFoldersByParent.get(folderId) || []).length;
      const filesCount = (docsByParent.get(folderId) || []).length;
      return { subFoldersCount, filesCount };
    },
    [childFoldersByParent, docsByParent]
  );

  // Visible folders & documents in the main Explorer canvas
  const isSearching = searchQuery.trim().length > 0;

  const displayedFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return childFoldersByParent.get(currentFolderId) || [];
    }

    const pool =
      searchScope === 'CURRENT'
        ? childFoldersByParent.get(currentFolderId) || []
        : folders;

    return pool.filter((f) => f.title.toLowerCase().includes(q));
  }, [searchQuery, searchScope, childFoldersByParent, currentFolderId, folders]);

  const displayedDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return docsByParent.get(currentFolderId) || [];
    }

    const pool =
      searchScope === 'CURRENT'
        ? docsByParent.get(currentFolderId) || []
        : explorerDocuments;

    return pool.filter((d) => {
      const haystack = [
        d.title,
        d.createdByAuthor,
        d.sourceOrigin,
        d.issuedTo,
        d.creationDate,
        d.expiryDate,
        d.hearingDate,
        d.fileName,
        d.folderPath
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [searchQuery, searchScope, docsByParent, currentFolderId, explorerDocuments]);

  // ==========================================
  // FOLDER ACTIONS (Title-Only Creation/Rename)
  // ==========================================
  const openCreateFolderModal = () => {
    setRenamingFolder(null);
    setFolderTitleInput('');
    setFolderFormError(null);
    setIsFolderModalOpen(true);
  };

  const openRenameFolderModal = (folder: CompanyExplorerFolder) => {
    setRenamingFolder(folder);
    setFolderTitleInput(folder.title);
    setFolderFormError(null);
    setIsFolderModalOpen(true);
  };

  const handleSaveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFolderFormError(null);
    const cleanTitle = folderTitleInput.trim();
    if (!cleanTitle) {
      setFolderFormError('Please enter a Folder Title.');
      return;
    }

    const targetParentId = renamingFolder
      ? renamingFolder.parentFolderId || null
      : currentFolderId;

    const siblingDuplicate = (childFoldersByParent.get(targetParentId) || []).some(
      (f) =>
        f.id !== renamingFolder?.id &&
        f.title.trim().toLowerCase() === cleanTitle.toLowerCase()
    );
    if (siblingDuplicate) {
      setFolderFormError('A folder with this title already exists in this location.');
      return;
    }

    setIsSavingFolder(true);
    try {
      if (renamingFolder) {
        const updatedFolder: CompanyExplorerFolder = {
          ...renamingFolder,
          title: cleanTitle,
          updatedAt: new Date().toISOString()
        };
        await saveCompanyExplorerFolderToFirestore(updatedFolder);

        // Update folderPath on any documents inside this folder or its nested sub-folders
        const updatedMap = new Map(folderById);
        updatedMap.set(updatedFolder.id, updatedFolder);
        const affectedIds = getDescendantFolderIds(updatedFolder.id);
        affectedIds.add(updatedFolder.id);

        const docsToSync = explorerDocuments.filter(
          (d) => d.parentFolderId && affectedIds.has(d.parentFolderId)
        );
        if (docsToSync.length > 0) {
          await Promise.all(
            docsToSync.map((d) => {
              const nextPath = getFolderPathLabel(d.parentFolderId || null, updatedMap);
              return saveCompanyDocumentToFirestore({
                ...d,
                folderPath: nextPath,
                category: nextPath
              });
            })
          );
        }
      } else {
        const newFolder: CompanyExplorerFolder = {
          id: `cfolder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          companyId: activeCompany?.id,
          title: cleanTitle,
          parentFolderId: currentFolderId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: safeAppStorage.getItem('dpl_current_user_name') || 'Admin'
        };
        await saveCompanyExplorerFolderToFirestore(newFolder);
        if (currentFolderId) {
          setExpandedFolderIds((prev) => new Set(prev).add(currentFolderId));
        }
      }

      setIsFolderModalOpen(false);
      setRenamingFolder(null);
      setFolderTitleInput('');
    } catch (err: any) {
      setFolderFormError(err?.message || 'Failed to save folder.');
    } finally {
      setIsSavingFolder(false);
    }
  };

  // Recursive Folder Delete
  const handleConfirmDeleteFolder = async () => {
    if (!folderPendingDelete) return;
    setIsDeleting(true);
    try {
      const descendants = getDescendantFolderIds(folderPendingDelete.id);
      const allFolderIdsToDelete = [folderPendingDelete.id, ...Array.from(descendants)];
      const folderIdSet = new Set(allFolderIdsToDelete);

      const docsToDelete = explorerDocuments.filter(
        (d) => d.parentFolderId && folderIdSet.has(d.parentFolderId)
      );

      await Promise.all([
        ...docsToDelete.map((d) => deleteCompanyDocumentFromFirestore(d.id)),
        ...allFolderIdsToDelete.map((fid) => deleteCompanyExplorerFolderFromFirestore(fid))
      ]);

      if (currentFolderId && folderIdSet.has(currentFolderId)) {
        navigateToFolder(folderPendingDelete.parentFolderId || null);
      }
      setFolderPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // ==========================================
  // DOCUMENT ACTIONS (Upload, Preview, Download, Delete)
  // ==========================================
  const openUploadFileModal = (droppedFiles?: File[]) => {
    setEditingDocument(null);
    setPreDroppedFiles(droppedFiles);
    setIsUploadModalOpen(true);
  };

  const openEditDocumentModal = (docItem: CompanyDocument) => {
    setEditingDocument(docItem);
    setPreDroppedFiles(undefined);
    setIsUploadModalOpen(true);
  };

  const handleOpenPreview = async (docItem: CompanyDocument) => {
    setPreviewDoc(docItem);
    const resolved = await resolveStoredDocumentDataUrl({
      url: docItem.fileUrl || null,
      id: docItem.id || null,
      name: docItem.fileName || docItem.title || null
    });
    setPreviewResolvedFile(resolved || docItem.fileUrl || null);
  };

  const handleDownloadDocument = async (docItem: CompanyDocument) => {
    const resolved = await resolveStoredDocumentDataUrl({
      url: docItem.fileUrl || null,
      id: docItem.id || null,
      name: docItem.fileName || docItem.title || null
    });
    if (resolved) {
      const ext = isImageDocument(docItem)
        ? (docItem.fileName?.match(/\.[a-zA-Z0-9]+$/)?.[0] || '.jpg')
        : '.pdf';
      const cleanFileName =
        docItem.fileName || `${docItem.title.replace(/[^a-zA-Z0-9_-]+/g, '_')}${ext}`;
      downloadFile(resolved, cleanFileName);
    }
  };

  const handleConfirmDeleteDocument = async () => {
    if (!docPendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteCompanyDocumentFromFirestore(docPendingDelete.id);
      setDocPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // ==========================================
  // MOVE FOLDER OR DOCUMENT TO ANOTHER FOLDER
  // ==========================================
  const openMoveModal = (target: MoveTargetState) => {
    setMoveTarget(target);
    setSelectedDestinationFolderId(target.currentParentId);
  };

  const handleConfirmMove = async () => {
    if (!moveTarget) return;
    if (selectedDestinationFolderId === moveTarget.currentParentId) {
      setMoveTarget(null);
      return;
    }

    setIsMoving(true);
    try {
      if (moveTarget.kind === 'FOLDER') {
        const folderObj = folderById.get(moveTarget.id);
        if (!folderObj) return;
        const updatedFolder: CompanyExplorerFolder = {
          ...folderObj,
          parentFolderId: selectedDestinationFolderId || null,
          updatedAt: new Date().toISOString()
        };
        await saveCompanyExplorerFolderToFirestore(updatedFolder);

        // Sync folderPath of all documents inside moved folder & its sub-folders
        const updatedMap = new Map(folderById);
        updatedMap.set(updatedFolder.id, updatedFolder);
        const affectedIds = getDescendantFolderIds(updatedFolder.id);
        affectedIds.add(updatedFolder.id);

        const docsToSync = explorerDocuments.filter(
          (d) => d.parentFolderId && affectedIds.has(d.parentFolderId)
        );
        if (docsToSync.length > 0) {
          await Promise.all(
            docsToSync.map((d) => {
              const nextPath = getFolderPathLabel(d.parentFolderId || null, updatedMap);
              return saveCompanyDocumentToFirestore({
                ...d,
                folderPath: nextPath,
                category: nextPath
              });
            })
          );
        }
      } else {
        const docObj = explorerDocuments.find((d) => d.id === moveTarget.id);
        if (!docObj) return;
        const nextPath = getFolderPathLabel(selectedDestinationFolderId || null);
        await saveCompanyDocumentToFirestore({
          ...docObj,
          parentFolderId: selectedDestinationFolderId || null,
          folderPath: nextPath,
          category: nextPath
        });
      }
      setMoveTarget(null);
    } finally {
      setIsMoving(false);
    }
  };

  // Direct Drag-and-Drop on Explorer Canvas
  const handleWorkspaceDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsWorkspaceDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      openUploadFileModal(Array.from(e.dataTransfer.files));
    }
  };

  // Verification metadata items for UniversalDocumentPreviewModal (All 7 Document Fields)
  const previewVerificationItems: DataMappingCheckItem[] = useMemo(() => {
    if (!previewDoc) return [];
    const expInfo = formatExpirySummary(previewDoc, todayIso);
    const hearInfo = formatHearingSummary(previewDoc, todayIso);

    return [
      {
        label: '1. Document Title',
        value: previewDoc.title,
        status: 'verified'
      },
      {
        label: '2. Created / Prepared By',
        value: previewDoc.createdByAuthor || previewDoc.uploadedBy || 'N/A',
        status: 'verified'
      },
      {
        label: '3. Document Source / Origin',
        value: previewDoc.sourceOrigin || previewDoc.senderIssuer || 'N/A',
        status: 'verified'
      },
      {
        label: '4. Creation Date',
        value: previewDoc.creationDate || previewDoc.issuanceDate || 'N/A',
        status: 'info'
      },
      {
        label: '5. Validity / Expiry',
        value: expInfo.label,
        status: expInfo.tone === 'danger' || expInfo.tone === 'warning' ? 'warning' : 'verified'
      },
      {
        label: '6. Scheduled Hearing',
        value: hearInfo.label,
        status: hearInfo.tone === 'danger' || hearInfo.tone === 'warning' ? 'warning' : 'info'
      },
      {
        label: '7. Issued To / In Name Of',
        value: previewDoc.issuedTo || previewDoc.recipientEntity || 'N/A',
        status: 'verified'
      },
      {
        label: 'Folder Location',
        value: getFolderPathLabel(previewDoc.parentFolderId || null),
        status: 'info'
      }
    ];
  }, [previewDoc, todayIso, getFolderPathLabel]);

  // Toggle expand/collapse in Left Explorer Tree
  const toggleExpandFolder = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // Recursive Left Folder Tree Renderer
  const renderFolderTreeNodes = (parentId: string | null, depth: number = 0): React.ReactNode => {
    const children = childFoldersByParent.get(parentId) || [];
    if (children.length === 0) return null;

    return children.map((folder) => {
      const subChildren = childFoldersByParent.get(folder.id) || [];
      const hasSubChildren = subChildren.length > 0;
      const isExpanded = expandedFolderIds.has(folder.id);
      const isSelected = currentFolderId === folder.id && !isSearching;

      return (
        <div key={folder.id}>
          <div
            onClick={() => navigateToFolder(folder.id)}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={`group flex items-center gap-1.5 pr-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              isSelected
                ? 'bg-sky-500/15 text-sky-400 font-semibold'
                : 'text-gray-300 hover:bg-white/[0.04] hover:text-white'
            }`}
          >
            <button
              type="button"
              onClick={(e) => (hasSubChildren ? toggleExpandFolder(folder.id, e) : undefined)}
              className={`w-4 h-4 flex items-center justify-center rounded shrink-0 ${
                hasSubChildren ? 'text-gray-400 hover:text-white cursor-pointer' : 'opacity-0 pointer-events-none'
              }`}
              tabIndex={hasSubChildren ? 0 : -1}
              aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {isSelected || isExpanded ? (
              <FolderOpen size={14} className="text-amber-400 shrink-0" />
            ) : (
              <Folder size={14} className="text-amber-400/90 shrink-0" />
            )}
            <span className="truncate" title={folder.title}>
              {folder.title}
            </span>
          </div>
          {hasSubChildren && isExpanded && renderFolderTreeNodes(folder.id, depth + 1)}
        </div>
      );
    });
  };

  // Flatten valid destination folders for "Move To..." modal
  const moveDestinationOptions = useMemo(() => {
    if (!moveTarget) return [];
    const forbiddenIds =
      moveTarget.kind === 'FOLDER'
        ? new Set<string>([moveTarget.id, ...Array.from(getDescendantFolderIds(moveTarget.id))])
        : new Set<string>();

    const result: Array<{ id: string; title: string; depth: number; pathLabel: string }> = [];
    const walk = (pid: string | null, depth: number) => {
      const kids = childFoldersByParent.get(pid) || [];
      for (const k of kids) {
        if (forbiddenIds.has(k.id)) continue;
        result.push({
          id: k.id,
          title: k.title,
          depth,
          pathLabel: getFolderPathLabel(k.id)
        });
        walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
    return result;
  }, [moveTarget, childFoldersByParent, getDescendantFolderIds, getFolderPathLabel]);

  // Count nested items when confirming folder delete
  const pendingDeleteSummary = useMemo(() => {
    if (!folderPendingDelete) return { subCount: 0, docCount: 0 };
    const desc = getDescendantFolderIds(folderPendingDelete.id);
    const allIds = new Set<string>([folderPendingDelete.id, ...Array.from(desc)]);
    const docCount = explorerDocuments.filter(
      (d) => d.parentFolderId && allIds.has(d.parentFolderId)
    ).length;
    return { subCount: desc.size, docCount };
  }, [folderPendingDelete, getDescendantFolderIds, explorerDocuments]);

  return (
    <div className="space-y-4">
      {/* Top Explorer Window Frame */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        {/* Row 1: Title + Persistent Create Folder & Upload File Actions (Present at Root & Every Nested Folder Depth) */}
        <div className="px-4 sm:px-6 py-4 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
              {currentFolder ? currentFolder.title : 'Company Documents'}
            </h2>
            <p className="text-xs text-gray-400 truncate mt-0.5">
              {isSearching
                ? `Search results (${displayedFolders.length} folder${displayedFolders.length === 1 ? '' : 's'} · ${displayedDocuments.length} file${displayedDocuments.length === 1 ? '' : 's'})`
                : `${currentFolderPathLabel} · ${displayedFolders.length} folder${displayedFolders.length === 1 ? '' : 's'} · ${displayedDocuments.length} file${displayedDocuments.length === 1 ? '' : 's'}`}
            </p>
          </div>

          {/* Primary Actions: ALWAYS Available on Main Page, Inside Any Folder, and Inside Any Sub-Folder */}
          <div className="flex items-center flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={openCreateFolderModal}
              className="mak-btn-secondary px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FolderPlus size={15} className="text-amber-400" />
              <span>Create Folder</span>
            </button>

            <button
              type="button"
              onClick={() => openUploadFileModal()}
              className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload size={15} />
              <span>Upload File</span>
            </button>

            <ThemeToggleSwitch compact />
          </div>
        </div>

        {/* Row 2: Windows Explorer Navigation Bar (Back, Forward, Up, Clickable Address Breadcrumbs, Search, View Toggle) */}
        <div className="px-3 sm:px-5 py-2.5 bg-slate-950/60 border-b border-white/10 flex flex-col lg:flex-row lg:items-center gap-2.5">
          {/* Navigation Controls + Address Breadcrumb Bar */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setShowTreePane((prev) => !prev)}
              className="mak-btn-secondary p-2 rounded-lg text-gray-300 hover:text-white cursor-pointer shrink-0"
              title={showTreePane ? 'Hide Folder Tree' : 'Show Folder Tree'}
            >
              {showTreePane ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>

            <button
              type="button"
              onClick={handleGoBack}
              disabled={!canGoBack}
              className="mak-btn-secondary p-2 rounded-lg text-gray-300 hover:text-white disabled:opacity-35 disabled:pointer-events-none cursor-pointer shrink-0"
              title="Back"
            >
              <ArrowLeft size={15} />
            </button>

            <button
              type="button"
              onClick={handleGoForward}
              disabled={!canGoForward}
              className="mak-btn-secondary p-2 rounded-lg text-gray-300 hover:text-white disabled:opacity-35 disabled:pointer-events-none cursor-pointer shrink-0"
              title="Forward"
            >
              <ArrowRight size={15} />
            </button>

            <button
              type="button"
              onClick={handleGoUp}
              disabled={!canGoUp}
              className="mak-btn-secondary p-2 rounded-lg text-gray-300 hover:text-white disabled:opacity-35 disabled:pointer-events-none cursor-pointer shrink-0"
              title="Up One Level"
            >
              <ArrowUp size={15} />
            </button>

            {/* Interactive Explorer Address / Breadcrumb Bar */}
            <div className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/10 flex items-center gap-1 overflow-x-auto text-xs">
              <button
                type="button"
                onClick={() => navigateToFolder(null)}
                className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  currentFolderId === null && !isSearching
                    ? 'text-white font-semibold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Home size={13} className="text-sky-400 shrink-0" />
                <span>Company Documents</span>
              </button>

              {currentFolderChain.map((crumb, idx) => {
                const isLast = idx === currentFolderChain.length - 1;
                return (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight size={13} className="text-gray-500 shrink-0" />
                    <button
                      type="button"
                      onClick={() => navigateToFolder(crumb.id)}
                      className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 max-w-[200px] truncate ${
                        isLast && !isSearching
                          ? 'text-white font-semibold'
                          : 'text-gray-400 hover:text-white'
                      }`}
                      title={crumb.title}
                    >
                      {crumb.title}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Search Input & View Mode Switcher */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative flex-1 sm:w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  currentFolder
                    ? `Search in ${currentFolder.title} or all folders...`
                    : 'Search folders and documents...'
                }
                className="glass-input w-full pl-8 pr-7 py-1.5 rounded-lg text-xs outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {isSearching && currentFolderId !== null && (
              <div
                data-custom-control="true"
                className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-white/10"
              >
                <button
                  type="button"
                  onClick={() => setSearchScope('ALL')}
                  className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    searchScope === 'ALL' ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  All Folders
                </button>
                <button
                  type="button"
                  onClick={() => setSearchScope('CURRENT')}
                  className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    searchScope === 'CURRENT' ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  This Folder
                </button>
              </div>
            )}

            <div
              data-custom-control="true"
              className="inline-flex items-center gap-0.5 p-1 rounded-lg bg-slate-900 border border-white/10 shrink-0"
            >
              <button
                type="button"
                onClick={() => setViewMode('GRID')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === 'GRID'
                    ? 'bg-sky-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="Tiles View"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('DETAILS')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === 'DETAILS'
                    ? 'bg-sky-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="Details Table View"
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Row 3: Split Explorer Body (Left Folder Tree + Right Folder & File Workspace) */}
        <div className="flex flex-col md:flex-row min-h-[540px]">
          {/* Left Navigation Pane (Windows Explorer Folder Tree) */}
          {showTreePane && (
            <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 bg-slate-950/40 p-3 flex flex-col gap-1 overflow-y-auto max-h-[260px] md:max-h-[680px] shrink-0">
              <div
                onClick={() => navigateToFolder(null)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                  currentFolderId === null && !isSearching
                    ? 'bg-sky-500/15 text-sky-400 font-semibold'
                    : 'text-gray-200 hover:bg-white/[0.04] hover:text-white font-medium'
                }`}
              >
                <FolderOpen size={15} className="text-sky-400 shrink-0" />
                <span className="truncate">Company Documents</span>
              </div>

              <div className="space-y-0.5 mt-0.5">
                {folders.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-gray-500">
                    No folders created yet
                  </p>
                ) : (
                  renderFolderTreeNodes(null, 0)
                )}
              </div>
            </aside>
          )}

          {/* Right Main Explorer Workspace (Supports Direct PDF/Image Drag-and-Drop) */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsWorkspaceDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsWorkspaceDragOver(false);
            }}
            onDrop={handleWorkspaceDrop}
            className={`flex-1 min-w-0 p-4 sm:p-6 transition-colors ${
              isWorkspaceDragOver ? 'bg-sky-500/10 ring-2 ring-inset ring-sky-400/50' : ''
            }`}
          >
            {isLoading ? (
              <div className="py-24 text-center space-y-2.5">
                <Loader2 size={28} className="animate-spin text-sky-400 mx-auto" />
                <p className="text-xs text-gray-400">Loading folders and documents...</p>
              </div>
            ) : displayedFolders.length === 0 && displayedDocuments.length === 0 ? (
              /* Clean Empty State — Shows BOTH Create Folder & Upload File at Root, Inside Any Folder, and Inside Any Sub-Folder */
              <div className="py-20 px-4 text-center max-w-md mx-auto space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center mx-auto text-amber-400">
                  <FolderOpen size={28} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    {isSearching
                      ? 'No matching folders or documents found'
                      : currentFolder
                        ? `"${currentFolder.title}" is empty`
                        : 'No folders or documents yet'}
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {isSearching
                      ? 'Try another search keyword or clear the search box.'
                      : currentFolder
                        ? 'Create a sub-folder inside this folder or upload a PDF or image document.'
                        : 'Create a folder to organize your hierarchy or upload a PDF or image document directly on the main page.'}
                  </p>
                </div>

                {!isSearching && (
                  <div className="flex items-center justify-center flex-wrap gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={openCreateFolderModal}
                      className="mak-btn-secondary px-4 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FolderPlus size={15} className="text-amber-400" />
                      <span>Create Folder</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openUploadFileModal()}
                      className="mak-btn px-4 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Upload size={15} />
                      <span>Upload File</span>
                    </button>
                  </div>
                )}
              </div>
            ) : viewMode === 'GRID' ? (
              /* ==========================================
                 WINDOWS EXPLORER TILES / GRID VIEW
                 ========================================== */
              <div className="space-y-6">
                {/* Folders Section */}
                {displayedFolders.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold text-gray-400">
                      Folders ({displayedFolders.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {displayedFolders.map((folder) => {
                        const counts = getFolderItemCounts(folder.id);
                        return (
                          <div
                            key={folder.id}
                            onClick={() => navigateToFolder(folder.id)}
                            className="group p-3.5 rounded-xl bg-slate-950/70 border border-white/10 hover:border-amber-400/40 transition-colors cursor-pointer flex flex-col justify-between gap-3"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-400/20 text-amber-400 flex items-center justify-center shrink-0">
                                <Folder size={20} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4
                                  className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors"
                                  title={folder.title}
                                >
                                  {folder.title}
                                </h4>
                                <div className="text-[11px] text-gray-400 font-mono tabular-nums mt-0.5">
                                  <span>
                                    {counts.subFoldersCount} folder{counts.subFoldersCount === 1 ? '' : 's'}
                                  </span>
                                  <span aria-hidden="true"> · </span>
                                  <span>
                                    {counts.filesCount} file{counts.filesCount === 1 ? '' : 's'}
                                  </span>
                                </div>
                                {isSearching && (
                                  <div
                                    className="text-[11px] text-gray-500 truncate mt-0.5"
                                    title={getFolderPathLabel(folder.parentFolderId || null)}
                                  >
                                    {getFolderPathLabel(folder.parentFolderId || null)}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="pt-2 border-t border-white/5 flex items-center justify-end gap-1"
                            >
                              <button
                                type="button"
                                onClick={() => openRenameFolderModal(folder)}
                                className="px-2 py-1 rounded-md text-[11px] text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                                title="Rename folder"
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openMoveModal({
                                    kind: 'FOLDER',
                                    id: folder.id,
                                    title: folder.title,
                                    currentParentId: folder.parentFolderId || null
                                  })
                                }
                                className="p-1.5 rounded-md text-gray-400 hover:text-sky-400 hover:bg-white/5 transition-colors cursor-pointer"
                                title="Move folder"
                              >
                                <FolderInput size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setFolderPendingDelete(folder)}
                                className="p-1.5 rounded-md text-gray-400 hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
                                title="Delete folder"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Document Files Section */}
                {displayedDocuments.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold text-gray-400">
                      Documents ({displayedDocuments.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                      {displayedDocuments.map((docItem) => {
                        const isImg = isImageDocument(docItem);
                        const expInfo = formatExpirySummary(docItem, todayIso);
                        const hearInfo = formatHearingSummary(docItem, todayIso);
                        const createdDate = docItem.creationDate || docItem.issuanceDate || '-';
                        const author = docItem.createdByAuthor || docItem.uploadedBy || '-';
                        const source = docItem.sourceOrigin || docItem.senderIssuer || '-';
                        const issuedToVal = docItem.issuedTo || docItem.recipientEntity || '-';

                        return (
                          <div
                            key={docItem.id}
                            onClick={() => handleOpenPreview(docItem)}
                            className="group p-4 rounded-xl bg-slate-950/70 border border-white/10 hover:border-sky-400/40 transition-colors cursor-pointer flex flex-col justify-between gap-3"
                          >
                            <div className="space-y-2.5">
                              {/* File Icon & Document Title */}
                              <div className="flex items-start gap-3 min-w-0">
                                <div
                                  className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                                    isImg
                                      ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-400'
                                      : 'bg-sky-500/10 border-sky-400/25 text-sky-400'
                                  }`}
                                >
                                  {isImg ? <ImageIcon size={19} /> : <FileText size={19} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h4
                                    className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-sky-300 transition-colors"
                                    title={docItem.title}
                                  >
                                    {docItem.title}
                                  </h4>
                                  <div className="text-[11px] text-gray-400 font-mono tabular-nums mt-0.5">
                                    <span>{isImg ? 'Image' : 'PDF'}</span>
                                    <span aria-hidden="true"> · </span>
                                    <span>Created {createdDate}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Clean Unboxed Metadata Summary (All Core Details) */}
                              <div className="space-y-1 text-[11px] text-gray-400 pt-1 border-t border-white/5">
                                <div className="truncate">
                                  <span className="text-gray-500">Created By: </span>
                                  <span className="text-gray-200 font-medium">{author}</span>
                                </div>
                                <div className="truncate">
                                  <span className="text-gray-500">Source: </span>
                                  <span className="text-gray-200 font-medium">{source}</span>
                                </div>
                                <div className="truncate">
                                  <span className="text-gray-500">Issued To: </span>
                                  <span className="text-gray-200 font-medium">{issuedToVal}</span>
                                </div>
                                <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 font-mono tabular-nums pt-0.5">
                                  <span
                                    className={
                                      expInfo.tone === 'danger'
                                        ? 'text-rose-400 font-semibold'
                                        : expInfo.tone === 'warning'
                                          ? 'text-amber-400 font-semibold'
                                          : expInfo.tone === 'valid'
                                            ? 'text-emerald-400'
                                            : 'text-gray-400'
                                    }
                                  >
                                    Expiry: {expInfo.label}
                                  </span>
                                  <span aria-hidden="true" className="text-gray-600">
                                    ·
                                  </span>
                                  <span
                                    className={
                                      hearInfo.tone === 'danger'
                                        ? 'text-rose-400 font-semibold'
                                        : hearInfo.tone === 'warning'
                                          ? 'text-amber-400 font-semibold'
                                          : hearInfo.tone === 'info'
                                            ? 'text-sky-400'
                                            : 'text-gray-400'
                                    }
                                  >
                                    Hearing: {hearInfo.label}
                                  </span>
                                </div>
                                {isSearching && (
                                  <div
                                    className="text-[11px] text-gray-500 truncate pt-0.5"
                                    title={getFolderPathLabel(docItem.parentFolderId || null)}
                                  >
                                    Path: {getFolderPathLabel(docItem.parentFolderId || null)}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Action Row */}
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="pt-2 border-t border-white/5 flex items-center justify-between gap-1"
                            >
                              <button
                                type="button"
                                onClick={() => handleOpenPreview(docItem)}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold text-sky-400 hover:bg-sky-500/10 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Eye size={12} />
                                <span>Open</span>
                              </button>

                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => openEditDocumentModal(docItem)}
                                  className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
                                  title="Edit document details"
                                >
                                  <Edit size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openMoveModal({
                                      kind: 'DOCUMENT',
                                      id: docItem.id,
                                      title: docItem.title,
                                      currentParentId: docItem.parentFolderId || null
                                    })
                                  }
                                  className="p-1.5 rounded-md text-gray-400 hover:text-sky-400 hover:bg-white/5 cursor-pointer"
                                  title="Move document to another folder"
                                >
                                  <FolderInput size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadDocument(docItem)}
                                  className="p-1.5 rounded-md text-gray-400 hover:text-emerald-400 hover:bg-white/5 cursor-pointer"
                                  title="Download file"
                                >
                                  <Download size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocPendingDelete(docItem)}
                                  className="p-1.5 rounded-md text-gray-400 hover:text-rose-400 hover:bg-white/5 cursor-pointer"
                                  title="Delete document"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ==========================================
                 WINDOWS EXPLORER DETAILS / TABLE VIEW
                 ========================================== */
              <div className="border border-white/10 rounded-xl overflow-hidden bg-slate-950/50">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950 text-[11px] text-gray-400">
                        <th className="py-2.5 px-3.5 font-semibold">Name</th>
                        <th className="py-2.5 px-3 font-semibold">Type</th>
                        <th className="py-2.5 px-3 font-semibold">Created By</th>
                        <th className="py-2.5 px-3 font-semibold">Source / Origin</th>
                        <th className="py-2.5 px-3 font-semibold">Creation Date</th>
                        <th className="py-2.5 px-3 font-semibold">Valid Until / Expiry</th>
                        <th className="py-2.5 px-3 font-semibold">Hearing Date</th>
                        <th className="py-2.5 px-3 font-semibold">Issued To / In Name Of</th>
                        <th className="py-2.5 px-3.5 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {/* Folder Rows First */}
                      {displayedFolders.map((folder) => {
                        const counts = getFolderItemCounts(folder.id);
                        return (
                          <tr
                            key={`folder_${folder.id}`}
                            onClick={() => navigateToFolder(folder.id)}
                            className="hover:bg-white/[0.03] transition-colors cursor-pointer"
                          >
                            <td className="py-2.5 px-3.5 max-w-[260px]">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Folder size={16} className="text-amber-400 shrink-0" />
                                <div className="min-w-0">
                                  <div className="font-semibold text-white truncate" title={folder.title}>
                                    {folder.title}
                                  </div>
                                  {isSearching && (
                                    <div className="text-[11px] text-gray-500 truncate">
                                      {getFolderPathLabel(folder.parentFolderId || null)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 whitespace-nowrap font-mono tabular-nums">
                              Folder ({counts.subFoldersCount + counts.filesCount})
                            </td>
                            <td className="py-2.5 px-3 text-gray-500">—</td>
                            <td className="py-2.5 px-3 text-gray-500">—</td>
                            <td className="py-2.5 px-3 text-gray-400 font-mono tabular-nums whitespace-nowrap">
                              {folder.createdAt ? folder.createdAt.slice(0, 10) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-gray-500">—</td>
                            <td className="py-2.5 px-3 text-gray-500">—</td>
                            <td className="py-2.5 px-3 text-gray-500">—</td>
                            <td
                              onClick={(e) => e.stopPropagation()}
                              className="py-2.5 px-3.5 text-right whitespace-nowrap"
                            >
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openRenameFolderModal(folder)}
                                  className="px-2 py-1 rounded text-[11px] text-gray-300 hover:text-white hover:bg-white/5 cursor-pointer"
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openMoveModal({
                                      kind: 'FOLDER',
                                      id: folder.id,
                                      title: folder.title,
                                      currentParentId: folder.parentFolderId || null
                                    })
                                  }
                                  className="p-1.5 rounded text-gray-400 hover:text-sky-400 hover:bg-white/5 cursor-pointer"
                                  title="Move folder"
                                >
                                  <FolderInput size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setFolderPendingDelete(folder)}
                                  className="p-1.5 rounded text-gray-400 hover:text-rose-400 hover:bg-white/5 cursor-pointer"
                                  title="Delete folder"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {/* Document Rows */}
                      {displayedDocuments.map((docItem) => {
                        const isImg = isImageDocument(docItem);
                        const expInfo = formatExpirySummary(docItem, todayIso);
                        const hearInfo = formatHearingSummary(docItem, todayIso);

                        return (
                          <tr
                            key={`doc_${docItem.id}`}
                            onClick={() => handleOpenPreview(docItem)}
                            className="hover:bg-white/[0.03] transition-colors cursor-pointer"
                          >
                            <td className="py-2.5 px-3.5 max-w-[260px]">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isImg ? (
                                  <ImageIcon size={16} className="text-emerald-400 shrink-0" />
                                ) : (
                                  <FileText size={16} className="text-sky-400 shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <div className="font-semibold text-white truncate" title={docItem.title}>
                                    {docItem.title}
                                  </div>
                                  {isSearching && (
                                    <div className="text-[11px] text-gray-500 truncate">
                                      {getFolderPathLabel(docItem.parentFolderId || null)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-gray-300 whitespace-nowrap">
                              {isImg ? 'Image' : 'PDF Document'}
                            </td>
                            <td className="py-2.5 px-3 text-gray-200 max-w-[160px] truncate">
                              {docItem.createdByAuthor || docItem.uploadedBy || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-gray-200 max-w-[180px] truncate">
                              {docItem.sourceOrigin || docItem.senderIssuer || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-gray-300 font-mono tabular-nums whitespace-nowrap">
                              {docItem.creationDate || docItem.issuanceDate || '—'}
                            </td>
                            <td
                              className={`py-2.5 px-3 font-mono tabular-nums whitespace-nowrap ${
                                expInfo.tone === 'danger'
                                  ? 'text-rose-400 font-semibold'
                                  : expInfo.tone === 'warning'
                                    ? 'text-amber-400 font-semibold'
                                    : expInfo.tone === 'valid'
                                      ? 'text-emerald-400'
                                      : 'text-gray-400'
                              }`}
                            >
                              {expInfo.label}
                            </td>
                            <td
                              className={`py-2.5 px-3 font-mono tabular-nums whitespace-nowrap ${
                                hearInfo.tone === 'danger'
                                  ? 'text-rose-400 font-semibold'
                                  : hearInfo.tone === 'warning'
                                    ? 'text-amber-400 font-semibold'
                                    : hearInfo.tone === 'info'
                                      ? 'text-sky-400'
                                      : 'text-gray-400'
                              }`}
                            >
                              {hearInfo.label}
                            </td>
                            <td className="py-2.5 px-3 text-gray-200 max-w-[180px] truncate">
                              {docItem.issuedTo || docItem.recipientEntity || '—'}
                            </td>
                            <td
                              onClick={(e) => e.stopPropagation()}
                              className="py-2.5 px-3.5 text-right whitespace-nowrap"
                            >
                              <div className="inline-flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenPreview(docItem)}
                                  className="p-1.5 rounded text-gray-400 hover:text-sky-400 hover:bg-white/5 cursor-pointer"
                                  title="Open preview"
                                >
                                  <Eye size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditDocumentModal(docItem)}
                                  className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
                                  title="Edit document details"
                                >
                                  <Edit size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openMoveModal({
                                      kind: 'DOCUMENT',
                                      id: docItem.id,
                                      title: docItem.title,
                                      currentParentId: docItem.parentFolderId || null
                                    })
                                  }
                                  className="p-1.5 rounded text-gray-400 hover:text-sky-400 hover:bg-white/5 cursor-pointer"
                                  title="Move document"
                                >
                                  <FolderInput size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadDocument(docItem)}
                                  className="p-1.5 rounded text-gray-400 hover:text-emerald-400 hover:bg-white/5 cursor-pointer"
                                  title="Download file"
                                >
                                  <Download size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocPendingDelete(docItem)}
                                  className="p-1.5 rounded text-gray-400 hover:text-rose-400 hover:bg-white/5 cursor-pointer"
                                  title="Delete document"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==========================================
          CREATE / RENAME FOLDER MODAL (Title ONLY)
         ========================================== */}
      {isFolderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-400/30 text-amber-400 flex items-center justify-center shrink-0">
                  <FolderPlus size={16} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    {renamingFolder ? 'Rename Folder' : 'Create Folder'}
                  </h3>
                  <p className="text-[11px] text-gray-400 truncate">
                    Location:{' '}
                    {renamingFolder
                      ? getFolderPathLabel(renamingFolder.parentFolderId || null)
                      : currentFolderPathLabel}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFolderModalOpen(false)}
                className="mak-btn-secondary p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSaveFolder} className="p-5 space-y-4">
              {folderFormError && (
                <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0 text-rose-400" />
                  <span>{folderFormError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-200 mb-1.5">
                  Folder Title *
                </label>
                <input
                  type="text"
                  autoFocus
                  value={folderTitleInput}
                  onChange={(e) => setFolderTitleInput(e.target.value)}
                  placeholder="Enter folder title"
                  className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFolderModalOpen(false)}
                  disabled={isSavingFolder}
                  className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingFolder}
                  className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Check size={14} />
                  <span>
                    {isSavingFolder
                      ? 'Saving...'
                      : renamingFolder
                        ? 'Save Title'
                        : 'Create Folder'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================
          MOVE TO FOLDER MODAL
         ========================================== */}
      {moveTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[84vh]">
            <div className="px-5 py-4 bg-slate-900 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white truncate">
                  Move &ldquo;{moveTarget.title}&rdquo;
                </h3>
                <p className="text-[11px] text-gray-400 truncate">
                  Select destination folder
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMoveTarget(null)}
                className="mak-btn-secondary p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-1 flex-1">
              <button
                type="button"
                onClick={() => setSelectedDestinationFolderId(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                  selectedDestinationFolderId === null
                    ? 'bg-sky-500/20 border border-sky-400/40 text-white font-semibold'
                    : 'hover:bg-white/5 text-gray-300 border border-transparent'
                }`}
              >
                <Home size={14} className="text-sky-400 shrink-0" />
                <span>Company Documents (Main Page)</span>
              </button>

              {moveDestinationOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedDestinationFolderId(opt.id)}
                  style={{ paddingLeft: `${opt.depth * 16 + 16}px` }}
                  className={`w-full text-left pr-3 py-2 rounded-lg text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                    selectedDestinationFolderId === opt.id
                      ? 'bg-sky-500/20 border border-sky-400/40 text-white font-semibold'
                      : 'hover:bg-white/5 text-gray-300 border border-transparent'
                  }`}
                >
                  <Folder size={14} className="text-amber-400 shrink-0" />
                  <span className="truncate" title={opt.pathLabel}>
                    {opt.title}
                  </span>
                </button>
              ))}
            </div>

            <div className="px-5 py-3.5 bg-slate-900 border-t border-white/10 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveTarget(null)}
                disabled={isMoving}
                className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMove}
                disabled={isMoving}
                className="mak-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Check size={14} />
                <span>{isMoving ? 'Moving...' : 'Move Here'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          DELETE FOLDER CONFIRMATION MODAL
         ========================================== */}
      {folderPendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  Delete Folder &ldquo;{folderPendingDelete.title}&rdquo;?
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {pendingDeleteSummary.subCount > 0 || pendingDeleteSummary.docCount > 0
                    ? `This will permanently delete this folder along with ${pendingDeleteSummary.subCount} nested sub-folder(s) and ${pendingDeleteSummary.docCount} document(s) inside it.`
                    : 'This empty folder will be permanently removed.'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFolderPendingDelete(null)}
                disabled={isDeleting}
                className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteFolder}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                {isDeleting ? 'Deleting...' : 'Delete Folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          DELETE DOCUMENT CONFIRMATION MODAL
         ========================================== */}
      {docPendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-white/15 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  Delete Document &ldquo;{docPendingDelete.title}&rdquo;?
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  This document and its stored file will be permanently deleted from{' '}
                  {getFolderPathLabel(docPendingDelete.parentFolderId || null)}.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDocPendingDelete(null)}
                disabled={isDeleting}
                className="mak-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteDocument}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                {isDeleting ? 'Deleting...' : 'Delete Document'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          UPLOAD / EDIT DOCUMENT MODAL (7 Metadata Fields)
         ========================================== */}
      <CompanyDocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          setEditingDocument(null);
          setPreDroppedFiles(undefined);
        }}
        onSave={saveCompanyDocumentToFirestore}
        currentFolderId={currentFolderId}
        currentFolderPathLabel={currentFolderPathLabel}
        editingDocument={editingDocument}
        preDroppedFiles={preDroppedFiles}
      />

      {/* ==========================================
          DOCUMENT VIEWER & METADATA PREVIEW MODAL
         ========================================== */}
      <UniversalDocumentPreviewModal
        isOpen={Boolean(previewDoc)}
        onClose={() => {
          setPreviewDoc(null);
          setPreviewResolvedFile(null);
        }}
        file={previewResolvedFile}
        filename={
          previewDoc?.fileName ||
          (previewDoc ? `${previewDoc.title}.${isImageDocument(previewDoc) ? 'jpg' : 'pdf'}` : 'document.pdf')
        }
        title={previewDoc?.title}
        fileType={previewDoc && isImageDocument(previewDoc) ? 'image' : 'pdf'}
        verificationItems={previewVerificationItems}
        onDownload={previewDoc ? () => handleDownloadDocument(previewDoc) : undefined}
      />
    </div>
  );
};

export default CompanyDocuments;

