import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookKey, 
  Plus, 
  Search, 
  Download, 
  FileSpreadsheet, 
  Trash2, 
  Edit3, 
  ArrowUpRight, 
  ArrowDownLeft, 
  User, 
  Phone, 
  Calendar, 
  DollarSign, 
  ShieldCheck, 
  Lock, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Filter, 
  CreditCard,
  ChevronDown
} from 'lucide-react';
import { PersonalLedgerAccount, PersonalLedgerEntry, AppUser, UserRole } from '../types';
import { 
  subscribeToPersonalLedgerAccounts, 
  subscribeToPersonalLedgerEntries,
  savePersonalLedgerAccount,
  deletePersonalLedgerAccount,
  savePersonalLedgerEntry,
  deletePersonalLedgerEntry
} from '../services/dbService';
import { getActiveDbUserSession } from '../services/firebase';
import { useBranding } from '../services/brandingService';
import { exportCSVFile } from '../services/fileUtils';

interface PersonalLedgerViewProps {
  users?: AppUser[];
  customLogo?: string | null;
}

export const PersonalLedgerView: React.FC<PersonalLedgerViewProps> = ({ users = [], customLogo }) => {
  const branding = useBranding();
  const activeLogo = customLogo || branding.customLogo;

  // Active logged-in user session
  const activeUser = useMemo(() => {
    const session = getActiveDbUserSession();
    if (session) return session;
    return {
      id: 1,
      userId: 'admin',
      name: 'System Administrator',
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN],
      isAdmin: true
    };
  }, []);

  const isAdmin = useMemo(() => {
    return activeUser.role === UserRole.ADMIN || 
           activeUser.userId === 'admin' || 
           activeUser.isAdmin || 
           (activeUser.roles || []).includes(UserRole.ADMIN);
  }, [activeUser]);

  // Data State
  const [accounts, setAccounts] = useState<PersonalLedgerAccount[]>([]);
  const [entries, setEntries] = useState<PersonalLedgerEntry[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Admin filter: view 'MINE' or a specific staff member's personal ledger
  const [adminViewingUserId, setAdminViewingUserId] = useState<string>('MINE');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Modals
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PersonalLedgerAccount | null>(null);
  const [accountFormData, setAccountFormData] = useState({
    partyName: '',
    partyPhone: '',
    relationCategory: 'Daily Dealing',
    openingBalance: '',
    openingBalanceType: 'GIVEN' as 'GIVEN' | 'RECEIVED',
    notes: ''
  });

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PersonalLedgerEntry | null>(null);
  const [entryFormData, setEntryFormData] = useState({
    accountId: '',
    date: new Date().toISOString().split('T')[0],
    type: 'GIVEN' as 'GIVEN' | 'RECEIVED',
    amount: '',
    description: '',
    paymentMethod: 'CASH' as 'CASH' | 'BANK_TRANSFER' | 'ONLINE' | 'CHEQUE' | 'OTHER',
    reference: '',
    notes: ''
  });

  // Subscribe to real-time accounts & entries
  useEffect(() => {
    const unsubAccounts = subscribeToPersonalLedgerAccounts((accs) => {
      setAccounts(accs || []);
    });
    const unsubEntries = subscribeToPersonalLedgerEntries((ents) => {
      setEntries(ents || []);
    });

    return () => {
      unsubAccounts();
      unsubEntries();
    };
  }, []);

  // Filter accounts according to privacy & role permissions
  // Non-admin can ONLY see their own accounts
  // Admin sees their own or selected user
  const visibleAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (!isAdmin) {
        return String(acc.ownerUserId) === String(activeUser.userId) || 
               String(acc.ownerId) === String(activeUser.id);
      }
      if (adminViewingUserId === 'MINE') {
        return String(acc.ownerUserId) === String(activeUser.userId) || 
               String(acc.ownerId) === String(activeUser.id);
      }
      if (adminViewingUserId === 'ALL') {
        return true;
      }
      return String(acc.ownerUserId) === String(adminViewingUserId) || 
             String(acc.ownerId) === String(adminViewingUserId);
    });
  }, [accounts, isAdmin, activeUser, adminViewingUserId]);

  // If selected account is not in visible accounts, select first visible account
  useEffect(() => {
    if (visibleAccounts.length > 0) {
      if (!selectedAccountId || !visibleAccounts.some(a => a.id === selectedAccountId)) {
        setSelectedAccountId(visibleAccounts[0].id);
      }
    } else {
      setSelectedAccountId(null);
    }
  }, [visibleAccounts, selectedAccountId]);

  const selectedAccount = useMemo(() => {
    return visibleAccounts.find(a => a.id === selectedAccountId) || null;
  }, [visibleAccounts, selectedAccountId]);

  // Calculate balances per account
  const accountStatsMap = useMemo(() => {
    const map = new Map<string, { totalGiven: number; totalReceived: number; netBalance: number; count: number }>();
    
    visibleAccounts.forEach(acc => {
      const accEntries = entries.filter(e => e.accountId === acc.id);
      let given = 0;
      let received = 0;

      // Include opening balance
      const op = Number(acc.openingBalance) || 0;
      if (op > 0) given += op;
      else if (op < 0) received += Math.abs(op);

      accEntries.forEach(e => {
        const amt = Number(e.amount) || 0;
        if (e.type === 'GIVEN') given += amt;
        else if (e.type === 'RECEIVED') received += amt;
      });

      map.set(acc.id, {
        totalGiven: given,
        totalReceived: received,
        netBalance: given - received, // > 0: you will receive (لینا ہے), < 0: you will pay (دینا ہے)
        count: accEntries.length + (op !== 0 ? 1 : 0)
      });
    });

    return map;
  }, [visibleAccounts, entries]);

  // Overall Portfolio Summary for this user's personal ledgers
  const portfolioSummary = useMemo(() => {
    let totalReceivable = 0; // You will receive from people
    let totalPayable = 0;    // You owe to people
    let totalTransactions = 0;

    visibleAccounts.forEach(acc => {
      const stats = accountStatsMap.get(acc.id);
      if (stats) {
        if (stats.netBalance > 0) totalReceivable += stats.netBalance;
        else if (stats.netBalance < 0) totalPayable += Math.abs(stats.netBalance);
        totalTransactions += stats.count;
      }
    });

    return {
      totalReceivable,
      totalPayable,
      netBalance: totalReceivable - totalPayable,
      totalAccounts: visibleAccounts.length,
      totalTransactions
    };
  }, [visibleAccounts, accountStatsMap]);

  // Filtered accounts for left sidebar list
  const filteredAccounts = useMemo(() => {
    return visibleAccounts.filter(acc => {
      if (categoryFilter !== 'ALL' && acc.relationCategory !== categoryFilter) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        acc.partyName.toLowerCase().includes(q) ||
        (acc.partyPhone || '').toLowerCase().includes(q) ||
        (acc.relationCategory || '').toLowerCase().includes(q) ||
        (acc.notes || '').toLowerCase().includes(q)
      );
    });
  }, [visibleAccounts, categoryFilter, searchQuery]);

  // Chronologically sorted entries with running balance for the selected account
  const selectedAccountTransactions = useMemo(() => {
    if (!selectedAccount) return [];

    const rawEntries = entries.filter(e => e.accountId === selectedAccount.id);
    const sorted = [...rawEntries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    const result: Array<PersonalLedgerEntry & { runningBalance: number; isOpening?: boolean }> = [];

    // Add initial opening balance if present
    const op = Number(selectedAccount.openingBalance) || 0;
    if (op !== 0) {
      runningBalance += op;
      result.push({
        id: `opening_${selectedAccount.id}`,
        accountId: selectedAccount.id,
        ownerId: selectedAccount.ownerId,
        ownerUserId: selectedAccount.ownerUserId,
        ownerName: selectedAccount.ownerName,
        partyName: selectedAccount.partyName,
        date: selectedAccount.createdAt ? selectedAccount.createdAt.split('T')[0] : 'Opening',
        description: 'Opening Balance (ابتدائی بقایا)',
        type: op > 0 ? 'GIVEN' : 'RECEIVED',
        amount: Math.abs(op),
        paymentMethod: 'OTHER',
        reference: 'OPENING',
        createdAt: selectedAccount.createdAt || new Date().toISOString(),
        runningBalance,
        isOpening: true
      });
    }

    sorted.forEach(e => {
      const amt = Number(e.amount) || 0;
      if (e.type === 'GIVEN') {
        runningBalance += amt;
      } else {
        runningBalance -= amt;
      }
      result.push({
        ...e,
        runningBalance
      });
    });

    return result;
  }, [selectedAccount, entries]);

  // Handlers for Account Modal
  const handleOpenAddAccount = () => {
    setEditingAccount(null);
    setAccountFormData({
      partyName: '',
      partyPhone: '',
      relationCategory: 'Daily Dealing',
      openingBalance: '',
      openingBalanceType: 'GIVEN',
      notes: ''
    });
    setShowAccountModal(true);
  };

  const handleOpenEditAccount = (acc: PersonalLedgerAccount) => {
    setEditingAccount(acc);
    const op = Number(acc.openingBalance) || 0;
    setAccountFormData({
      partyName: acc.partyName,
      partyPhone: acc.partyPhone || '',
      relationCategory: acc.relationCategory || 'Daily Dealing',
      openingBalance: op !== 0 ? String(Math.abs(op)) : '',
      openingBalanceType: op >= 0 ? 'GIVEN' : 'RECEIVED',
      notes: acc.notes || ''
    });
    setShowAccountModal(true);
  };

  const handleSaveAccount = async () => {
    if (!accountFormData.partyName.trim()) {
      alert("Please provide the Person / Party Name.");
      return;
    }

    const opNum = Number(accountFormData.openingBalance) || 0;
    const finalOpening = accountFormData.openingBalanceType === 'RECEIVED' ? -Math.abs(opNum) : Math.abs(opNum);

    const payload: PersonalLedgerAccount = {
      id: editingAccount ? editingAccount.id : `placct_${Date.now()}`,
      ownerId: editingAccount ? editingAccount.ownerId : activeUser.id,
      ownerUserId: editingAccount ? editingAccount.ownerUserId : (activeUser.userId || 'admin'),
      ownerName: editingAccount ? editingAccount.ownerName : (activeUser.name || 'Personal'),
      partyName: accountFormData.partyName.trim(),
      partyPhone: accountFormData.partyPhone.trim(),
      relationCategory: accountFormData.relationCategory,
      openingBalance: finalOpening,
      notes: accountFormData.notes.trim(),
      createdAt: editingAccount?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await savePersonalLedgerAccount(payload);
    setShowAccountModal(false);
    setSelectedAccountId(payload.id);
  };

  const handleDeleteAccount = async (accId: string) => {
    if (!window.confirm("Are you sure you want to delete this personal ledger account and its entries?")) return;
    await deletePersonalLedgerAccount(accId);
    // Also delete associated entries
    const related = entries.filter(e => e.accountId === accId);
    for (const r of related) {
      await deletePersonalLedgerEntry(r.id);
    }
  };

  // Handlers for Entry Modal
  const handleOpenAddEntry = (targetAccountId?: string) => {
    setEditingEntry(null);
    setEntryFormData({
      accountId: targetAccountId || selectedAccountId || '',
      date: new Date().toISOString().split('T')[0],
      type: 'GIVEN',
      amount: '',
      description: '',
      paymentMethod: 'CASH',
      reference: '',
      notes: ''
    });
    setShowEntryModal(true);
  };

  const handleOpenEditEntry = (entry: PersonalLedgerEntry) => {
    setEditingEntry(entry);
    setEntryFormData({
      accountId: entry.accountId,
      date: entry.date,
      type: entry.type,
      amount: String(entry.amount),
      description: entry.description,
      paymentMethod: entry.paymentMethod || 'CASH',
      reference: entry.reference || '',
      notes: entry.notes || ''
    });
    setShowEntryModal(true);
  };

  const handleSaveEntry = async () => {
    if (!entryFormData.accountId) {
      alert("Please select a personal account / party.");
      return;
    }
    const amt = Number(entryFormData.amount);
    if (!amt || amt <= 0) {
      alert("Please provide a valid amount (PKR).");
      return;
    }
    if (!entryFormData.description.trim()) {
      alert("Please enter a description or reason for this entry.");
      return;
    }

    const targetAcct = accounts.find(a => a.id === entryFormData.accountId);

    const payload: PersonalLedgerEntry = {
      id: editingEntry ? editingEntry.id : `plentry_${Date.now()}`,
      accountId: entryFormData.accountId,
      ownerId: targetAcct ? targetAcct.ownerId : activeUser.id,
      ownerUserId: targetAcct ? targetAcct.ownerUserId : (activeUser.userId || 'admin'),
      ownerName: targetAcct ? targetAcct.ownerName : (activeUser.name || 'Personal'),
      partyName: targetAcct ? targetAcct.partyName : 'Personal Contact',
      date: entryFormData.date,
      type: entryFormData.type,
      amount: amt,
      description: entryFormData.description.trim(),
      paymentMethod: entryFormData.paymentMethod,
      reference: entryFormData.reference.trim(),
      notes: entryFormData.notes.trim(),
      createdAt: editingEntry?.createdAt || new Date().toISOString()
    };

    await savePersonalLedgerEntry(payload);
    setShowEntryModal(false);
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!window.confirm("Are you sure you want to delete this transaction entry?")) return;
    await deletePersonalLedgerEntry(entryId);
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!selectedAccount) return;
    const headers = ['Date', 'Description', 'Payment Method', 'Ref', 'Money Given (Debit PKR)', 'Money Received (Credit PKR)', 'Balance (PKR)'];
    const rows = selectedAccountTransactions.map(e => [
      e.date,
      e.description,
      e.paymentMethod || 'CASH',
      e.reference || '',
      e.type === 'GIVEN' ? e.amount : 0,
      e.type === 'RECEIVED' ? e.amount : 0,
      e.runningBalance
    ]);
    const filename = `Personal_Ledger_${selectedAccount.partyName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}`;
    exportCSVFile(filename, headers, rows);
  };

  // Print Statement directly
  const handlePrintStatement = () => {
    window.print();
  };

  const staffOptions = useMemo(() => {
    return users.filter(u => u.role !== UserRole.CLIENT && u.role !== UserRole.TRANSPORTER);
  }, [users]);

  return (
    <div className="p-4 space-y-6">
      {/* Top Header & Isolation Notice */}
      <div className="bg-slate-900/80 p-5 rounded-2xl border border-white/10 flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <BookKey size={20} className="text-emerald-400" />
              <span>Personal Ledger</span>
              <span className="text-xs font-normal text-emerald-400/80 font-mono">
                (ذاتی کھاتہ &bull; پرائیویٹ لین دین)
              </span>
            </h3>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-[10px] font-semibold border border-emerald-500/20 flex items-center gap-1">
              <Lock size={11} />
              <span>100% Private & Confidential</span>
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl">
            A dedicated, isolated personal account book for daily cash dealings, loans, mutual settlements, and personal contacts. 
            Does not interfere with company cashbook or general accounts. 
            {!isAdmin ? ' Only visible within your login ID.' : ' Supervised by System Administrator.'}
          </p>
        </div>

        {/* Header Controls: Add Account & Admin View Switcher */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Admin Staff Switcher */}
          {isAdmin && (
            <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs">
              <ShieldCheck size={14} className="text-purple-400" />
              <span className="text-gray-400 text-[11px]">Viewing:</span>
              <select
                value={adminViewingUserId}
                onChange={(e) => setAdminViewingUserId(e.target.value)}
                className="bg-transparent text-white font-medium outline-none cursor-pointer"
              >
                <option value="MINE" className="bg-slate-900">My Personal Ledger (Admin)</option>
                <option value="ALL" className="bg-slate-900">All Staff Ledgers (Admin Master View)</option>
                {staffOptions.map(staff => (
                  <option key={staff.id} value={staff.userId || staff.id} className="bg-slate-900">
                    {staff.name} ({staff.userId})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={handleOpenAddAccount}
            className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-brand-500/40 flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-brand-950/40"
          >
            <Plus size={15} />
            <span>New Personal Account (نیا کھاتہ)</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {/* Card 1: Total Receivable (لینا ہے) */}
        <div className="p-4 bg-gradient-to-br from-slate-900/90 to-emerald-950/30 rounded-2xl border border-emerald-500/30 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold block">
              You Will Receive (لینا ہے)
            </span>
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
              <ArrowDownLeft size={16} />
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-emerald-400 mt-2">
            PKR {portfolioSummary.totalReceivable.toLocaleString()}
          </div>
          <span className="text-[11px] text-gray-400 mt-1 block">
            Money given to personal contacts
          </span>
        </div>

        {/* Card 2: Total Payable (دینا ہے) */}
        <div className="p-4 bg-gradient-to-br from-slate-900/90 to-rose-950/30 rounded-2xl border border-rose-500/30 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-rose-400 font-semibold block">
              You Owe / Have To Pay (دینا ہے)
            </span>
            <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
              <ArrowUpRight size={16} />
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-rose-400 mt-2">
            PKR {portfolioSummary.totalPayable.toLocaleString()}
          </div>
          <span className="text-[11px] text-gray-400 mt-1 block">
            Money received from contacts
          </span>
        </div>

        {/* Card 3: Net Personal Position */}
        <div className="p-4 bg-gradient-to-br from-slate-900/90 to-blue-950/30 rounded-2xl border border-blue-500/30 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-blue-300 font-semibold block">
              Net Balance (خالص پوزیشن)
            </span>
            <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-300">
              <DollarSign size={16} />
            </div>
          </div>
          <div className={`text-2xl font-mono font-bold mt-2 ${
            portfolioSummary.netBalance > 0 ? 'text-emerald-400' : 
            portfolioSummary.netBalance < 0 ? 'text-rose-400' : 'text-white'
          }`}>
            PKR {Math.abs(portfolioSummary.netBalance).toLocaleString()}
          </div>
          <span className="text-[11px] text-gray-400 mt-1 block">
            {portfolioSummary.netBalance > 0 ? 'Net Receivable (آپ نے لینا ہے)' : 
             portfolioSummary.netBalance < 0 ? 'Net Payable (آپ نے دینا ہے)' : 'Fully Balanced (برابر)'}
          </span>
        </div>

        {/* Card 4: Total Personal Accounts */}
        <div className="p-4 bg-slate-900/90 rounded-2xl border border-white/10 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold block">
              Active Accounts (کل کھاتے)
            </span>
            <div className="p-1.5 rounded-lg bg-white/10 text-gray-300">
              <User size={16} />
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-white mt-2">
            {portfolioSummary.totalAccounts}
          </div>
          <span className="text-[11px] text-gray-400 mt-1 block">
            {portfolioSummary.totalTransactions} recorded dealings
          </span>
        </div>
      </div>

      {/* Main Workspace: Left Accounts List & Right Detailed Ledger Statement */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (4 cols): Personal Accounts List */}
        <div className="lg:col-span-4 space-y-3">
          <div className="bg-slate-900/70 p-4 rounded-2xl border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs uppercase font-bold text-gray-300 tracking-wider flex items-center gap-1.5">
                <span>Personal Accounts</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-gray-400">
                  {filteredAccounts.length}
                </span>
              </h4>
              <button
                type="button"
                onClick={handleOpenAddAccount}
                className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold flex items-center gap-1"
              >
                <Plus size={14} />
                <span>Add</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search person / phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-emerald-500 placeholder-gray-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Category filter pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
              {['ALL', 'Daily Dealing', 'Cash Loan', 'Friend / Relative', 'Personal Partner'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors ${
                    categoryFilter === cat 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold' 
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Account Cards List */}
            <div className="space-y-2 max-h-[550px] overflow-y-auto pr-1">
              {filteredAccounts.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-500 border border-dashed border-white/10 rounded-xl space-y-2">
                  <p>No personal accounts found.</p>
                  <button
                    type="button"
                    onClick={handleOpenAddAccount}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 text-xs font-semibold hover:bg-emerald-600/30 border border-emerald-500/30"
                  >
                    + Create First Account
                  </button>
                </div>
              ) : (
                filteredAccounts.map(acc => {
                  const stats = accountStatsMap.get(acc.id) || { totalGiven: 0, totalReceived: 0, netBalance: 0, count: 0 };
                  const isSelected = selectedAccountId === acc.id;

                  return (
                    <div
                      key={acc.id}
                      onClick={() => setSelectedAccountId(acc.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
                        isSelected 
                          ? 'bg-emerald-950/30 border-emerald-500/50 shadow-md shadow-emerald-950/20' 
                          : 'bg-white/5 border-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h5 className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                            <span>{acc.partyName}</span>
                            {isAdmin && adminViewingUserId === 'ALL' && (
                              <span className="text-[10px] text-purple-300 font-normal px-1.5 py-0.2 bg-purple-500/20 rounded">
                                {acc.ownerName}
                              </span>
                            )}
                          </h5>
                          <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
                            {acc.partyPhone && (
                              <span className="flex items-center gap-1">
                                <Phone size={11} className="text-gray-500" />
                                <span>{acc.partyPhone}</span>
                              </span>
                            )}
                            <span className="text-gray-500">&bull;</span>
                            <span className="text-gray-400 truncate">{acc.relationCategory || 'Personal'}</span>
                          </div>
                        </div>

                        {/* Balance Badge */}
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-mono font-bold ${
                            stats.netBalance > 0 ? 'text-emerald-400' : 
                            stats.netBalance < 0 ? 'text-rose-400' : 'text-gray-400'
                          }`}>
                            PKR {Math.abs(stats.netBalance).toLocaleString()}
                          </div>
                          <span className={`text-[10px] font-semibold block ${
                            stats.netBalance > 0 ? 'text-emerald-400' : 
                            stats.netBalance < 0 ? 'text-rose-400' : 'text-gray-500'
                          }`}>
                            {stats.netBalance > 0 ? 'Receive (لینا ہے)' : 
                             stats.netBalance < 0 ? 'Pay (دینا ہے)' : 'Settled (صاف)'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px] text-gray-500">
                        <span>{stats.count} transactions</span>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleOpenEditAccount(acc)}
                            className="hover:text-white transition-colors"
                            title="Edit Account"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAccount(acc.id)}
                            className="hover:text-red-400 transition-colors"
                            title="Delete Account"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column (8 cols): Selected Account Detailed Ledger */}
        <div className="lg:col-span-8 space-y-4">
          {selectedAccount ? (
            <div className="bg-slate-900/70 p-5 rounded-2xl border border-white/10 space-y-4 shadow-xl">
              {/* Selected Account Header & Statement Actions */}
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold text-emerald-400 tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                      {selectedAccount.relationCategory || 'Personal Account'}
                    </span>
                    {selectedAccount.partyPhone && (
                      <span className="text-xs text-gray-400 font-mono flex items-center gap-1">
                        <Phone size={12} />
                        <span>{selectedAccount.partyPhone}</span>
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-white mt-1 flex items-center gap-2">
                    <span>{selectedAccount.partyName}</span>
                    <span className="text-xs font-normal text-gray-400">Ledger Statement</span>
                  </h3>
                  {selectedAccount.notes && (
                    <p className="text-xs text-gray-400 mt-1 max-w-xl italic">
                      "{selectedAccount.notes}"
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenAddEntry(selectedAccount.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-xl border border-emerald-500/40 flex items-center gap-1.5 transition-all shadow-md active:scale-95"
                  >
                    <Plus size={15} />
                    <span>Add Entry (نیا اندراج)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold px-3 py-2 rounded-xl border border-white/10 flex items-center gap-1.5 transition-all"
                    title="Export statement as Excel / CSV"
                  >
                    <FileSpreadsheet size={14} className="text-emerald-400" />
                    <span>Export CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintStatement}
                    className="bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold px-3 py-2 rounded-xl border border-white/10 flex items-center gap-1.5 transition-all"
                    title="Print or Save PDF"
                  >
                    <Download size={14} className="text-brand-400" />
                    <span>Print Statement</span>
                  </button>
                </div>
              </div>

              {/* Mini Summary Strip for Selected Account */}
              {(() => {
                const stats = accountStatsMap.get(selectedAccount.id) || { totalGiven: 0, totalReceived: 0, netBalance: 0, count: 0 };
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-black/40 rounded-xl border border-white/5">
                    <div>
                      <span className="text-[10px] uppercase text-gray-400 block font-semibold">Total Money Given (دیا)</span>
                      <span className="text-base font-mono font-bold text-rose-300">
                        PKR {stats.totalGiven.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-gray-400 block font-semibold">Total Received (لیا)</span>
                      <span className="text-base font-mono font-bold text-emerald-300">
                        PKR {stats.totalReceived.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-gray-400 block font-semibold">Net Balance (خالص بقایا)</span>
                      <span className={`text-base font-mono font-bold ${
                        stats.netBalance > 0 ? 'text-emerald-400' : 
                        stats.netBalance < 0 ? 'text-rose-400' : 'text-white'
                      }`}>
                        PKR {Math.abs(stats.netBalance).toLocaleString()} 
                        <span className="text-xs ml-1 font-sans">
                          {stats.netBalance > 0 ? '(لینا ہے)' : stats.netBalance < 0 ? '(دینا ہے)' : '(برابر)'}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Transaction Table */}
              <div className="overflow-x-auto rounded-xl border border-white/5 bg-black/20">
                <table className="w-full text-left text-xs text-gray-300">
                  <thead className="bg-white/5 uppercase text-[10px] text-gray-400 border-b border-white/5 font-semibold">
                    <tr>
                      <th className="p-3 w-28">Date</th>
                      <th className="p-3">Description & Details</th>
                      <th className="p-3 w-28">Payment Mode</th>
                      <th className="p-3 text-right w-32">Given / دیے (Debit)</th>
                      <th className="p-3 text-right w-32">Received / لیے (Credit)</th>
                      <th className="p-3 text-right w-36">Running Balance</th>
                      <th className="p-3 text-center w-20 no-print">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {selectedAccountTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-gray-500 text-xs">
                          No transactions recorded yet for this personal account.
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => handleOpenAddEntry(selectedAccount.id)}
                              className="text-emerald-400 underline font-semibold text-xs"
                            >
                              + Add First Transaction
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      selectedAccountTransactions.map((item, idx) => (
                        <tr key={`pl_tx_${item.id}_${idx}`} className="hover:bg-white/5 transition-colors">
                          <td className="p-3 font-mono text-gray-400 whitespace-nowrap">
                            {item.date}
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-white">{item.description}</div>
                            {item.reference && (
                              <span className="text-[10px] font-mono text-gray-400 block mt-0.5">
                                Ref: {item.reference}
                              </span>
                            )}
                            {item.notes && (
                              <p className="text-[10px] text-gray-400 mt-0.5 italic">{item.notes}</p>
                            )}
                          </td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white/5 text-gray-300 border border-white/10 uppercase">
                              {item.paymentMethod || 'CASH'}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-rose-400">
                            {item.type === 'GIVEN' ? `PKR ${item.amount.toLocaleString()}` : '-'}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-400">
                            {item.type === 'RECEIVED' ? `PKR ${item.amount.toLocaleString()}` : '-'}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-white whitespace-nowrap">
                            <span className={item.runningBalance > 0 ? 'text-emerald-300' : item.runningBalance < 0 ? 'text-rose-300' : 'text-gray-400'}>
                              PKR {Math.abs(item.runningBalance).toLocaleString()}
                            </span>
                            <span className="text-[9px] text-gray-400 block font-normal">
                              {item.runningBalance > 0 ? 'Receive (لینا)' : item.runningBalance < 0 ? 'Pay (دینا)' : 'Settled'}
                            </span>
                          </td>
                          <td className="p-3 text-center no-print">
                            {!item.isOpening ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditEntry(item)}
                                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                                  title="Edit Entry"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEntry(item.id)}
                                  className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  title="Delete Entry"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-500">Opening</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-gray-400 bg-slate-900/50 rounded-2xl border border-white/5 space-y-3">
              <BookKey size={36} className="mx-auto text-emerald-400/60" />
              <h4 className="text-sm font-bold text-white">No Personal Account Selected</h4>
              <p className="text-xs text-gray-400 max-w-md mx-auto">
                Create or select a personal account / contact from the left column to view transactions, add money dealings, or download statements.
              </p>
              <button
                type="button"
                onClick={handleOpenAddAccount}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-emerald-500/40 inline-flex items-center gap-2 transition-all shadow-lg shadow-emerald-950/40"
              >
                <Plus size={15} />
                <span>Create New Personal Account (نیا کھاتہ کھولیں)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal 1: Add / Edit Personal Account */}
      {showAccountModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in my-6">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <User size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {editingAccount ? 'Edit Personal Account' : 'New Personal Account (نیا ذاتی کھاتہ)'}
                  </h3>
                  <p className="text-[11px] text-gray-400">Add a person or contact with whom you have daily dealings</p>
                </div>
              </div>
              <button onClick={() => setShowAccountModal(false)} className="text-gray-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-gray-400 font-medium mb-1">Person / Party Name * (نام / پارٹی)</label>
                <input
                  type="text"
                  placeholder="e.g. Ahmed Bhai, Zubair Khan, Kashif (Shop)"
                  value={accountFormData.partyName}
                  onChange={(e) => setAccountFormData(prev => ({ ...prev, partyName: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 font-medium mb-1">Phone / Mobile (فون نمبر)</label>
                  <input
                    type="text"
                    placeholder="0300-1234567"
                    value={accountFormData.partyPhone}
                    onChange={(e) => setAccountFormData(prev => ({ ...prev, partyPhone: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-gray-400 font-medium mb-1">Category / Relation (قسم)</label>
                  <select
                    value={accountFormData.relationCategory}
                    onChange={(e) => setAccountFormData(prev => ({ ...prev, relationCategory: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="Daily Dealing" className="bg-slate-900">Daily Dealing (روزمرہ لین دین)</option>
                    <option value="Cash Loan" className="bg-slate-900">Cash Loan (قرضہ)</option>
                    <option value="Personal Partner" className="bg-slate-900">Personal Partner (شریک کار)</option>
                    <option value="Friend / Relative" className="bg-slate-900">Friend / Relative (دوست / رشتہ دار)</option>
                    <option value="Other" className="bg-slate-900">Other (دیگر)</option>
                  </select>
                </div>
              </div>

              {/* Opening Balance (Optional) */}
              <div className="p-3 bg-black/40 rounded-xl border border-white/5 space-y-2">
                <span className="text-[11px] font-semibold text-gray-300 block">
                  Opening Balance (ابتدائی بقایا رقم - اختیاری)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-0.5">Amount (PKR)</label>
                    <input
                      type="number"
                      placeholder="e.g. 50000"
                      value={accountFormData.openingBalance}
                      onChange={(e) => setAccountFormData(prev => ({ ...prev, openingBalance: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-white font-mono outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-0.5">Balance Nature</label>
                    <select
                      value={accountFormData.openingBalanceType}
                      onChange={(e) => setAccountFormData(prev => ({ ...prev, openingBalanceType: e.target.value as any }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      <option value="GIVEN" className="bg-slate-900">I will receive (لینا ہے)</option>
                      <option value="RECEIVED" className="bg-slate-900">I owe / to pay (دینا ہے)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-gray-400 font-medium mb-1">Notes / Remarks (نوٹس)</label>
                <textarea
                  rows={2}
                  placeholder="Details, reason for dealing, agreement terms..."
                  value={accountFormData.notes}
                  onChange={(e) => setAccountFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500 resize-none placeholder-gray-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAccountModal(false)}
                  className="px-4 py-2 rounded-xl text-gray-400 hover:text-white bg-white/5 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAccount}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/40"
                >
                  <CheckCircle2 size={14} />
                  <span>{editingAccount ? 'Update Account' : 'Save Account (محفوظ کریں)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Add / Edit Transaction Entry */}
      {showEntryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in my-6">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${entryFormData.type === 'GIVEN' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                  {entryFormData.type === 'GIVEN' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {editingEntry ? 'Edit Entry' : 'Record Transaction (لین دین درج کریں)'}
                  </h3>
                  <p className="text-[11px] text-gray-400">Add cash given or received from personal contact</p>
                </div>
              </div>
              <button onClick={() => setShowEntryModal(false)} className="text-gray-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              {/* Target Account Selection */}
              <div>
                <label className="block text-gray-400 font-medium mb-1">Personal Account / Person *</label>
                <select
                  value={entryFormData.accountId}
                  onChange={(e) => setEntryFormData(prev => ({ ...prev, accountId: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="" className="bg-slate-900">-- Select Person / Account --</option>
                  {visibleAccounts.map(acc => (
                    <option key={acc.id} value={acc.id} className="bg-slate-900">
                      {acc.partyName} ({acc.relationCategory || 'Personal'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Type Switcher: Given vs Received */}
              <div>
                <label className="block text-gray-400 font-medium mb-1">Transaction Type (قسم) *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEntryFormData(prev => ({ ...prev, type: 'GIVEN' }))}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      entryFormData.type === 'GIVEN'
                        ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-950/40'
                        : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <ArrowUpRight size={14} />
                    <span>Money Given / دیے (Debit)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryFormData(prev => ({ ...prev, type: 'RECEIVED' }))}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      entryFormData.type === 'RECEIVED'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950/40'
                        : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <ArrowDownLeft size={14} />
                    <span>Received / لیے (Credit)</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 font-medium mb-1">Amount (PKR) *</label>
                  <input
                    type="number"
                    placeholder="e.g. 25000"
                    value={entryFormData.amount}
                    onChange={(e) => setEntryFormData(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-emerald-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-medium mb-1">Date (تاریخ) *</label>
                  <input
                    type="date"
                    value={entryFormData.date}
                    onChange={(e) => setEntryFormData(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 font-medium mb-1">Description / Purpose * (تفصیل / مقصد)</label>
                <input
                  type="text"
                  placeholder="e.g. Cash given for spare parts, Returned partial loan, Tea bill"
                  value={entryFormData.description}
                  onChange={(e) => setEntryFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 font-medium mb-1">Payment Method</label>
                  <select
                    value={entryFormData.paymentMethod}
                    onChange={(e) => setEntryFormData(prev => ({ ...prev, paymentMethod: e.target.value as any }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="CASH" className="bg-slate-900">Cash (نقد)</option>
                    <option value="BANK_TRANSFER" className="bg-slate-900">Bank Transfer (بینک ٹرانسفر)</option>
                    <option value="ONLINE" className="bg-slate-900">Online / EasyPaisa / JazzCash</option>
                    <option value="CHEQUE" className="bg-slate-900">Cheque (چیک)</option>
                    <option value="OTHER" className="bg-slate-900">Other (دیگر)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 font-medium mb-1">Reference / Slip No. (اختیاری)</label>
                  <input
                    type="text"
                    placeholder="e.g. Slip #401"
                    value={entryFormData.reference}
                    onChange={(e) => setEntryFormData(prev => ({ ...prev, reference: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 font-medium mb-1">Notes (نوٹس - اختیاری)</label>
                <textarea
                  rows={2}
                  placeholder="Additional context..."
                  value={entryFormData.notes}
                  onChange={(e) => setEntryFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500 resize-none placeholder-gray-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEntryModal(false)}
                  className="px-4 py-2 rounded-xl text-gray-400 hover:text-white bg-white/5 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEntry}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/40"
                >
                  <CheckCircle2 size={14} />
                  <span>{editingEntry ? 'Update Transaction' : 'Save Transaction (اندراج کریں)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
