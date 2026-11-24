import React, {useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileText,
  Search,
  ShieldAlert,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import type {
  ImportRowPreview,
  StatementBalanceSummary,
  Transaction,
  TransactionType,
} from '../types/finance';
import {
  findDuplicateTransaction,
  formatDateDisplay,
  formatMoney,
  validateTransactionInput,
} from '../utils/formatters';
import {parsePastedStatementText, parsePdfTransactions} from '../utils/pdfParser';

type PdfRowFilter = 'all' | 'income' | 'expense' | 'duplicates' | 'invalid' | 'selected';
type ConflictModalFilter = 'all' | 'invalid' | 'duplicates';

function normalizeConflictNotes(s: string): string {
  return (s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 42);
}

function recomputeRowConflicts(
  nextRows: ImportRowPreview[],
  existingTransactions: Transaction[]
): ImportRowPreview[] {
  const seenBatchMap = new Map<string, number>();

  return nextRows.map((row) => {
    const val = validateTransactionInput({
      date: row.date,
      amount: row.amount,
      categoryId: row.categoryId,
      type: row.type,
    });

    const dupExisting = val.isValid
      ? findDuplicateTransaction(
          {
            date: row.date,
            amount: row.amount,
            type: row.type,
            notes: row.notes,
          },
          existingTransactions
        )
      : undefined;

    const cents = Math.round((Number.isFinite(row.amount) ? row.amount : 0) * 100);
    const batchKey = `${row.date}|${row.type}|${cents}|${normalizeConflictNotes(row.notes)}`;
    const firstBatchRowIndex = cents > 0 ? seenBatchMap.get(batchKey) : undefined;
    if (cents > 0 && firstBatchRowIndex === undefined) {
      seenBatchMap.set(batchKey, row.rowIndex);
    }

    const isBatchDup = firstBatchRowIndex !== undefined;
    const isDuplicate = Boolean(dupExisting) || isBatchDup;
    const duplicateReason = dupExisting
      ? `Matches existing ledger entry ${dupExisting.id}`
      : isBatchDup
        ? `Duplicate row within this PDF (matches S.No ${firstBatchRowIndex})`
        : undefined;

    return {
      ...row,
      isValid: val.isValid,
      validationErrors: val.errors,
      isDuplicate,
      duplicateReason,
      selected: val.isValid ? row.selected : false,
    };
  });
}

export const PdfImportView: React.FC = () => {
  const {settings, categories, transactions, addBatchTransactions} = useVault();

  const [parsing, setParsing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [metaStats, setMetaStats] = useState<{
    pages: number;
    lines: number;
    usedOcr: boolean;
  } | null>(null);
  const [rows, setRows] = useState<ImportRowPreview[]>([]);
  const [balances, setBalances] = useState<StatementBalanceSummary[]>([]);
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [rowFilter, setRowFilter] = useState<PdfRowFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');

  // Conflicts Review Popup state
  const [showConflictsModal, setShowConflictsModal] = useState(false);
  const [conflictFilter, setConflictFilter] = useState<ConflictModalFilter>('all');
  const [focusedConflictRowIndex, setFocusedConflictRowIndex] = useState<number | null>(null);
  const [sessionConflictIds, setSessionConflictIds] = useState<number[]>([]);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const applyDefaultFirstAccount = (parsedRows: ImportRowPreview[]) => {
    setRowFilter('all');
    setSearchQuery('');
    setShowConflictsModal(false);
    setFocusedConflictRowIndex(null);
    setSessionConflictIds([]);

    if (parsedRows.length === 0) {
      setSectionFilter('all');
      setRows([]);
      return;
    }
    const sections = Array.from(
      new Set(parsedRows.map((r) => r.accountSection || 'Main Account'))
    );
    const preferred =
      sections.find((s) => /compte\s+courant\s+postal|ccp/i.test(s)) || sections[0] || 'all';
    setSectionFilter(preferred);
    const withSelection = parsedRows.map((r) => ({
      ...r,
      selected:
        preferred === 'all'
          ? r.isValid && !r.isDuplicate
          : (r.accountSection || 'Main Account') === preferred && r.isValid && !r.isDuplicate,
    }));
    setRows(recomputeRowConflicts(withSelection, transactions));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setStatusMessage('');
    setFileName(file.name);
    setParsing(true);
    setProgressText('Opening PDF document...');
    setSectionFilter('all');

    try {
      const result = await parsePdfTransactions(
        file,
        transactions,
        categories,
        (status) => setProgressText(status)
      );
      setMetaStats({
        pages: result.totalPages,
        lines: result.extractedLineCount,
        usedOcr: result.usedOcr,
      });
      setBalances(result.balances);
      applyDefaultFirstAccount(result.rows);
      if (result.rows.length === 0) {
        setError(
          'No structured transaction lines (Date + Amount) were found in this PDF. You can also paste copied statement text below.'
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to parse PDF file. If this is a scanned PDF while offline, paste the text below.'
      );
    } finally {
      setParsing(false);
      setProgressText('');
      e.target.value = '';
    }
  };

  const handleParsePastedText = () => {
    setError('');
    setStatusMessage('');
    if (!pastedText.trim()) {
      setError('Paste bank statement lines before parsing.');
      return;
    }
    const parsed = parsePastedStatementText(pastedText, transactions, categories);
    setBalances(parsed.balances);
    applyDefaultFirstAccount(parsed.rows);
    setFileName('Pasted Statement Text');
    setMetaStats({pages: 1, lines: parsed.rows.length, usedOcr: false});
    setShowPasteBox(false);
    if (parsed.rows.length === 0) {
      setError('Could not detect Date + Amount transaction rows in the pasted text.');
    }
  };

  const updateRow = (rowIndex: number, patch: Partial<ImportRowPreview>) => {
    setRows((prev) => {
      const next = prev.map((row) => {
        if (row.rowIndex !== rowIndex) return row;
        const merged = {...row, ...patch};

        if (patch.type) {
          const validCat = categories.some(
            (c) => c.id === merged.categoryId && c.type === patch.type
          );
          if (!validCat) {
            const fallback = categories.find((c) => c.type === patch.type);
            if (fallback) merged.categoryId = fallback.id;
          }
        }
        return merged;
      });
      return recomputeRowConflicts(next, transactions);
    });
  };

  const sectionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const sec = r.accountSection || 'Main Account';
      map.set(sec, (map.get(sec) || 0) + 1);
    }
    return map;
  }, [rows]);

  const availableSections = useMemo(
    () => Array.from(sectionCounts.keys()),
    [sectionCounts]
  );

  const handleAccountSelectChange = (chosenSection: string) => {
    setSectionFilter(chosenSection);
    setRows((prev) =>
      prev.map((r) => {
        if (!r.isValid) return {...r, selected: false};
        if (chosenSection === 'all') {
          return {...r, selected: !r.isDuplicate};
        }
        return {
          ...r,
          selected: (r.accountSection || 'Main Account') === chosenSection && !r.isDuplicate,
        };
      })
    );
  };

  const handleForceSelectAccountDuplicates = () => {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.isValid) return {...r, selected: false};
        if (sectionFilter === 'all') {
          return {...r, selected: true};
        }
        return {
          ...r,
          selected: (r.accountSection || 'Main Account') === sectionFilter,
        };
      })
    );
  };

  const handleDeselectDuplicates = () => {
    setRows((prev) =>
      prev.map((r) => (r.isDuplicate ? {...r, selected: false} : r))
    );
  };

  const summaryCounts = useMemo(() => {
    const valid = rows.filter((r) => r.isValid).length;
    const invalid = rows.filter((r) => !r.isValid).length;
    const duplicates = rows.filter((r) => r.isDuplicate).length;
    const income = rows.filter((r) => r.type === 'income').length;
    const expense = rows.filter((r) => r.type === 'expense').length;
    const selectedRows = rows.filter((r) => r.selected && r.isValid);
    const selected = selectedRows.length;
    const selectedDuplicates = selectedRows.filter((r) => r.isDuplicate).length;
    let selectedIncome = 0;
    let selectedExpense = 0;
    for (const r of selectedRows) {
      if (r.type === 'income') selectedIncome += r.amount;
      else selectedExpense += r.amount;
    }
    const activeSectionDuplicates =
      sectionFilter === 'all'
        ? rows.filter((r) => r.isValid && r.isDuplicate && !r.selected).length
        : rows.filter(
            (r) =>
              (r.accountSection || 'Main Account') === sectionFilter &&
              r.isValid &&
              r.isDuplicate &&
              !r.selected
          ).length;
    return {
      valid,
      invalid,
      duplicates,
      income,
      expense,
      selected,
      selectedDuplicates,
      selectedIncome,
      selectedExpense,
      activeSectionDuplicates,
    };
  }, [rows, sectionFilter]);

  const balanceEquation = useMemo(() => {
    const net = summaryCounts.selectedIncome - summaryCounts.selectedExpense;
    if (sectionFilter !== 'all') {
      const bal = balances.find((b) => b.accountSection === sectionFilter);
      if (bal && bal.openingAmount !== null) {
        const calculatedClosing = bal.openingAmount + net;
        const diff =
          bal.closingAmount !== null
            ? Math.round((calculatedClosing - bal.closingAmount) * 100) / 100
            : null;
        return {
          hasOpening: true,
          openingLabel: bal.openingLabel || 'Ancien solde',
          openingAmount: bal.openingAmount,
          closingLabel: bal.closingLabel || 'Nouveau solde',
          statementClosingAmount: bal.closingAmount,
          calculatedClosing,
          diff,
          net,
        };
      }
    } else if (balances.length > 0 && balances.every((b) => b.openingAmount !== null)) {
      const openingSum = balances.reduce((sum, b) => sum + (b.openingAmount || 0), 0);
      const hasAllClosings = balances.every((b) => b.closingAmount !== null);
      const closingSum = hasAllClosings
        ? balances.reduce((sum, b) => sum + (b.closingAmount || 0), 0)
        : null;
      const calculatedClosing = openingSum + net;
      const diff =
        closingSum !== null
          ? Math.round((calculatedClosing - closingSum) * 100) / 100
          : null;
      return {
        hasOpening: true,
        openingLabel: balances.length > 1 ? 'Combined Ancien solde' : balances[0].openingLabel,
        openingAmount: openingSum,
        closingLabel: balances.length > 1 ? 'Combined Nouveau solde' : balances[0].closingLabel,
        statementClosingAmount: closingSum,
        calculatedClosing,
        diff,
        net,
      };
    }

    return {
      hasOpening: false,
      openingLabel: 'Ancien solde',
      openingAmount: null as number | null,
      closingLabel: 'Nouveau solde',
      statementClosingAmount: null as number | null,
      calculatedClosing: net,
      diff: null as number | null,
      net,
    };
  }, [balances, sectionFilter, summaryCounts.selectedIncome, summaryCounts.selectedExpense]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (rowFilter === 'income' && r.type !== 'income') return false;
      if (rowFilter === 'expense' && r.type !== 'expense') return false;
      if (rowFilter === 'duplicates' && !r.isDuplicate) return false;
      if (rowFilter === 'invalid' && r.isValid) return false;
      if (rowFilter === 'selected' && !(r.selected && r.isValid)) return false;

      if (q) {
        const catName = categories.find((c) => c.id === r.categoryId)?.name || '';
        const dateFormatted = formatDateDisplay(r.date, settings.dateFormat);
        const haystack = `${r.rowIndex} ${r.notes} ${r.rawLine} ${r.date} ${dateFormatted} ${r.amount} ${r.accountSection || ''} ${catName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, rowFilter, searchQuery, categories, settings.dateFormat]);

  const conflictRows = useMemo(() => {
    return rows.filter((r) => !r.isValid || r.isDuplicate);
  }, [rows]);

  const modalConflictRows = useMemo(() => {
    const sessionSet = new Set(sessionConflictIds);
    return rows.filter((r) => sessionSet.has(r.rowIndex) || !r.isValid || r.isDuplicate);
  }, [rows, sessionConflictIds]);

  const visibleConflictRows = useMemo(() => {
    if (conflictFilter === 'invalid') return modalConflictRows.filter((r) => !r.isValid);
    if (conflictFilter === 'duplicates') return modalConflictRows.filter((r) => r.isDuplicate);
    return modalConflictRows;
  }, [modalConflictRows, conflictFilter]);

  const openConflictsModal = (
    filter: ConflictModalFilter = 'all',
    focusRowIndex: number | null = null
  ) => {
    const ids = rows.filter((r) => !r.isValid || r.isDuplicate).map((r) => r.rowIndex);
    if (focusRowIndex !== null && !ids.includes(focusRowIndex)) {
      ids.push(focusRowIndex);
    }
    setSessionConflictIds(ids);
    setFocusedConflictRowIndex(focusRowIndex);
    setConflictFilter(filter);
    setShowConflictsModal(true);
  };

  const openConflictsForRow = (row: ImportRowPreview) => {
    openConflictsModal(
      !row.isValid ? 'invalid' : row.isDuplicate ? 'duplicates' : 'all',
      row.rowIndex
    );
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    const visibleIds = new Set(
      filteredRows.filter((r) => r.isValid).map((r) => r.rowIndex)
    );
    setRows((prev) =>
      prev.map((r) => {
        if (!r.isValid || !visibleIds.has(r.rowIndex)) return r;
        return {...r, selected: checked ? !r.isDuplicate : false};
      })
    );
  };

  const handleImport = async () => {
    setError('');
    const toImport = rows.filter((r) => r.selected && r.isValid);
    if (toImport.length === 0) {
      setError('Select at least one valid row to import.');
      return;
    }
    setImporting(true);
    try {
      await addBatchTransactions(
        toImport.map((r) => ({
          date: r.date,
          amount: r.amount,
          categoryId: r.categoryId,
          type: r.type,
          notes: r.notes,
        }))
      );
      setStatusMessage(
        `Successfully encrypted & imported ${toImport.length} transactions from ${fileName}.`
      );
      setRows([]);
      setBalances([]);
      setMetaStats(null);
      setFileName('');
      setPastedText('');
      setSearchQuery('');
      setRowFilter('all');
      setShowConflictsModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import transactions.');
    } finally {
      setImporting(false);
    }
  };

  const hasRows = rows.length > 0;
  const visibleValidNonDup = filteredRows.filter((r) => r.isValid && !r.isDuplicate);
  const allVisibleValidSelected =
    visibleValidNonDup.length > 0 && visibleValidNonDup.every((r) => r.selected);

  const tableColGroup = (
    <colgroup>
      <col style={{width: '40px'}} />
      <col style={{width: '44px'}} />
      <col style={{width: '52px'}} />
      <col style={{width: '152px'}} />
      <col style={{width: '104px'}} />
      <col style={{width: '146px'}} />
      <col style={{minWidth: '240px'}} />
      <col style={{width: '116px'}} />
    </colgroup>
  );

  const tableHeaderRow = (
    <tr className="border-b app-border app-surface-elevated app-text-muted">
      <th className="py-3 px-2.5 text-center">
        <input
          type="checkbox"
          aria-label="Select all visible valid non-duplicate rows"
          title="Select or deselect visible valid rows"
          checked={allVisibleValidSelected}
          onChange={(e) => toggleSelectAllVisible(e.target.checked)}
          className="w-4 h-4 accent-emerald-600"
        />
      </th>
      <th className="py-3 px-2 text-center">S.No</th>
      <th className="py-3 px-2 text-center">Status</th>
      <th className="py-3 px-2">Date</th>
      <th className="py-3 px-2">Type</th>
      <th className="py-3 px-2">Category</th>
      <th className="py-3 px-2.5">Notes</th>
      <th className="py-3 px-2.5 text-right">Amount</th>
    </tr>
  );

  const renderPasteBox = () =>
    showPasteBox && (
      <div className="rounded-xl border app-surface p-5 space-y-3">
        <label className="block text-xs font-medium app-text-secondary">
          Paste copied statement rows (e.g., Date + Description + Amount)
        </label>
        <textarea
          rows={5}
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder={`Ancien solde au 24/12/2024 1 117,55\n27/12 PRELEVEMENT DE SFR 1,99\n30/12 VIREMENT DE ORLY AIR TRAITEUR 2 001,14`}
          className="w-full rounded-lg border app-input p-3 text-xs font-mono-tabular"
        />
        <button
          type="button"
          onClick={handleParsePastedText}
          className="rounded-lg px-4 py-2 text-xs font-semibold text-white min-h-[38px]"
          style={{backgroundColor: 'var(--accent-primary)'}}
        >
          Parse Pasted Lines
        </button>
      </div>
    );

  const renderUploadDropzone = () => (
    <div className="rounded-xl border app-surface p-6 space-y-4">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed app-border p-8 cursor-pointer hover:border-emerald-500 transition-colors text-center">
        <Upload className="w-7 h-7" style={{color: 'var(--accent-primary)'}} />
        <div>
          <div className="text-sm font-semibold">
            {parsing
              ? progressText || 'Parsing PDF locally...'
              : fileName || 'Select Bank Statement or Ledger PDF'}
          </div>
          <div className="text-xs app-text-muted mt-1">
            Processed inside your browser · Automatically falls back to in-browser OCR for scanned/image PDFs
          </div>
        </div>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          className="hidden"
        />
      </label>
    </div>
  );

  const findMatchDetails = (row: ImportRowPreview) => {
    const existingMatch = row.isValid
      ? findDuplicateTransaction(
          {date: row.date, amount: row.amount, type: row.type, notes: row.notes},
          transactions
        )
      : undefined;
    if (existingMatch) {
      const cat = categories.find((c) => c.id === existingMatch.categoryId)?.name || 'Others';
      return {
        source: 'Existing Ledger',
        summary: `${existingMatch.id} · ${formatDateDisplay(existingMatch.date, settings.dateFormat)} · ${existingMatch.type === 'income' ? 'Income' : 'Expense'} · ${cat} · ${formatMoney(existingMatch.amount, settings.currency, settings.numberFormat)}`,
        notes: existingMatch.notes,
      };
    }
    const cents = Math.round((Number.isFinite(row.amount) ? row.amount : 0) * 100);
    const key = `${row.date}|${row.type}|${cents}|${normalizeConflictNotes(row.notes)}`;
    const firstBatchMatch = rows.find(
      (other) =>
        other.rowIndex < row.rowIndex &&
        `${other.date}|${other.type}|${Math.round((other.amount || 0) * 100)}|${normalizeConflictNotes(other.notes)}` ===
          key
    );
    if (firstBatchMatch) {
      return {
        source: `PDF S.No ${firstBatchMatch.rowIndex}`,
        summary: `S.No ${firstBatchMatch.rowIndex} · ${formatDateDisplay(firstBatchMatch.date, settings.dateFormat)} · ${firstBatchMatch.type === 'income' ? 'Income' : 'Expense'} · ${formatMoney(firstBatchMatch.amount, settings.currency, settings.numberFormat)}`,
        notes: firstBatchMatch.notes,
      };
    }
    return null;
  };

  return (
    <div className={hasRows ? '' : 'space-y-6'}>
      {/* Sticky Header + (when PDF loaded) Account Balance Cards, Toolbar, Equation Bar, Filters & Table Headers */}
      <div
        className={
          hasRows
            ? 'app-sticky-panel -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 space-y-3'
            : 'app-sticky-header -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8'
        }
      >
        {/* Title Bar */}
        <div
          className={`${
            hasRows
              ? 'sticky top-13 z-20 app-canvas -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 md:static md:mt-0 md:pt-0 md:mx-0 md:px-0 '
              : ''
          }flex flex-wrap items-center justify-between gap-4 pb-3 border-b app-border`}
        >
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {t(settings.language, 'navPdfImport')}
            </h1>
            <p className="mt-1 text-xs sm:text-sm app-text-muted">
              Supports digital &amp; scanned bank statements (including La Banque Postale Débit/Crédit EUR, DD/MM year rollover, and Indian/US formats).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasRows && (
              <label
                title="Load a different PDF statement"
                className="inline-flex items-center gap-2 rounded-lg border app-border px-3.5 py-2 text-xs font-medium app-text-secondary hover:border-emerald-500/50 cursor-pointer min-h-[40px]"
              >
                <Upload className="w-4 h-4" style={{color: 'var(--accent-primary)'}} />
                <span>{parsing ? 'Parsing...' : 'New PDF'}</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}

            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border app-border px-3.5 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px]"
            >
              <ClipboardPaste className="w-4 h-4" />
              <span>{showPasteBox ? 'Hide Text Paste' : 'Paste Statement Text'}</span>
            </button>
          </div>
        </div>

        {/* Sticky Green Section: Balance Cards + Toolbar + Equation + Search/Filter + Table Header */}
        {hasRows && (
          <div className="space-y-3">
            {showPasteBox && renderPasteBox()}

            {error && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
                {error}
              </div>
            )}

            {statusMessage && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                {statusMessage}
              </div>
            )}

            {balances.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {balances.map((bal) => {
                  const count = sectionCounts.get(bal.accountSection) || 0;
                  const isSelectedSection = sectionFilter === bal.accountSection;
                  return (
                    <button
                      key={bal.accountSection}
                      type="button"
                      onClick={() =>
                        handleAccountSelectChange(
                          isSelectedSection ? 'all' : bal.accountSection
                        )
                      }
                      className={`text-left rounded-xl border px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 transition-colors ${
                        isSelectedSection
                          ? 'border-emerald-500 bg-emerald-500/5'
                          : 'app-surface hover:border-emerald-500/50'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold flex flex-wrap items-center gap-2">
                          <span>{bal.accountSection}</span>
                          <span className="app-text-muted" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className="font-mono-tabular"
                            style={{color: 'var(--accent-primary)'}}
                          >
                            {count} Record{count === 1 ? '' : 's'}
                          </span>
                          {bal.reconciled === true && (
                            <>
                              <span className="app-text-muted" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-[11px] font-medium text-emerald-500">
                                ✓ Balance Verified
                              </span>
                            </>
                          )}
                          {bal.reconciled === false && bal.reconciliationDiff != null && (
                            <>
                              <span className="app-text-muted" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-[11px] font-medium text-rose-400 font-mono-tabular">
                                ✗ Diff:{' '}
                                {formatMoney(
                                  bal.reconciliationDiff,
                                  settings.currency,
                                  settings.numberFormat
                                )}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="text-xs app-text-muted mt-0.5 font-mono-tabular">
                          {bal.openingLabel}:{' '}
                          <span className="font-semibold app-text-secondary">
                            {bal.openingAmount !== null
                              ? formatMoney(
                                  bal.openingAmount,
                                  settings.currency,
                                  settings.numberFormat
                                )
                              : '—'}
                          </span>
                          {typeof bal.incomeTotal === 'number' &&
                            typeof bal.expenseTotal === 'number' && (
                              <span>
                                {' · '}
                                <span style={{color: 'var(--income-text)'}}>
                                  +
                                  {formatMoney(
                                    bal.incomeTotal,
                                    settings.currency,
                                    settings.numberFormat
                                  )}
                                </span>
                                {' / '}
                                <span style={{color: 'var(--expense-text)'}}>
                                  -
                                  {formatMoney(
                                    bal.expenseTotal,
                                    settings.currency,
                                    settings.numberFormat
                                  )}
                                </span>
                              </span>
                            )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] app-text-muted">{bal.closingLabel}</div>
                        <div
                          className="text-sm font-bold font-mono-tabular mt-0.5"
                          style={{color: 'var(--income-text)'}}
                        >
                          {bal.closingAmount !== null
                            ? formatMoney(
                                bal.closingAmount,
                                settings.currency,
                                settings.numberFormat
                              )
                            : '—'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="rounded-t-xl border border-b-0 app-surface overflow-hidden">
              {/* Top Toolbar Row: Stats + Account Select + Review Conflicts + Import */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b app-border">
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono-tabular">
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    {metaStats?.pages} page(s) · {rows.length} rows
                    {metaStats?.usedOcr ? ' · OCR Mode' : ''}
                  </span>
                  <span className="text-emerald-500">{summaryCounts.valid} Valid</span>
                  <span className="text-amber-500">{summaryCounts.duplicates} Duplicates</span>
                  <span className="text-rose-500">{summaryCounts.invalid} Invalid</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {conflictRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openConflictsModal('all', null)}
                      title="Open popup to review and edit duplicates or invalid records in one place"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 min-h-[38px]"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Review Conflicts ({conflictRows.length})</span>
                    </button>
                  )}

                  <select
                    value={sectionFilter}
                    onChange={(e) => handleAccountSelectChange(e.target.value)}
                    className="rounded-lg border app-input px-3 py-2 text-xs min-h-[38px]"
                    aria-label="Select account rows to tick"
                  >
                    <option value="all">All Accounts ({rows.length})</option>
                    {availableSections.map((sec, idx) => (
                      <option key={sec} value={sec}>
                        {idx === 0 ? `1er Compte · ${sec}` : sec} ({sectionCounts.get(sec) || 0})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={importing || summaryCounts.selected === 0}
                    className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 min-h-[38px]"
                    style={{backgroundColor: 'var(--accent-primary)'}}
                  >
                    {importing
                      ? 'Encrypting & Importing...'
                      : `Import ${summaryCounts.selected} Valid Transactions`}
                  </button>
                </div>
              </div>

              {/* Balance Equation Summary Bar (Nouveau solde = Ancien solde + Income - Expenses) */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b app-border app-surface-elevated text-xs font-mono-tabular">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold app-text-secondary">
                    Selected ({summaryCounts.selected}):
                  </span>
                  {balanceEquation.hasOpening && balanceEquation.openingAmount !== null ? (
                    <>
                      <span className="app-text-muted">
                        Ancien solde{' '}
                        <span className="font-semibold app-text-secondary">
                          {formatMoney(
                            balanceEquation.openingAmount,
                            settings.currency,
                            settings.numberFormat
                          )}
                        </span>
                      </span>
                      <span className="app-text-muted">+</span>
                      <span style={{color: 'var(--income-text)'}}>
                        {formatMoney(
                          summaryCounts.selectedIncome,
                          settings.currency,
                          settings.numberFormat,
                          {showSign: true}
                        )}
                      </span>
                      <span className="app-text-muted">-</span>
                      <span style={{color: 'var(--expense-text)'}}>
                        {formatMoney(
                          summaryCounts.selectedExpense,
                          settings.currency,
                          settings.numberFormat
                        )}
                      </span>
                      <span className="app-text-muted">=</span>
                      <span className="font-bold">
                        Nouveau solde:{' '}
                        <span
                          style={{
                            color:
                              balanceEquation.calculatedClosing >= 0
                                ? 'var(--income-text)'
                                : 'var(--expense-text)',
                          }}
                        >
                          {formatMoney(
                            balanceEquation.calculatedClosing,
                            settings.currency,
                            settings.numberFormat
                          )}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={{color: 'var(--income-text)'}}>
                        Income +
                        {formatMoney(
                          summaryCounts.selectedIncome,
                          settings.currency,
                          settings.numberFormat
                        )}
                      </span>
                      <span className="app-text-muted">·</span>
                      <span style={{color: 'var(--expense-text)'}}>
                        Expenses -
                        {formatMoney(
                          summaryCounts.selectedExpense,
                          settings.currency,
                          settings.numberFormat
                        )}
                      </span>
                      <span className="app-text-muted">=</span>
                      <span className="font-bold">
                        Net{' '}
                        <span
                          style={{
                            color:
                              balanceEquation.net >= 0
                                ? 'var(--income-text)'
                                : 'var(--expense-text)',
                          }}
                        >
                          {formatMoney(
                            balanceEquation.net,
                            settings.currency,
                            settings.numberFormat,
                            {showSign: true}
                          )}
                        </span>
                      </span>
                    </>
                  )}
                </div>

                {balanceEquation.hasOpening && balanceEquation.statementClosingAmount !== null && (
                  <div className="flex items-center gap-2 text-[11px]">
                    {balanceEquation.diff !== null && Math.abs(balanceEquation.diff) < 0.01 ? (
                      <span className="text-emerald-500 font-semibold">
                        ✓ Matches PDF Nouveau solde (
                        {formatMoney(
                          balanceEquation.statementClosingAmount,
                          settings.currency,
                          settings.numberFormat
                        )}
                        )
                      </span>
                    ) : (
                      <span className="text-amber-400 font-semibold">
                        PDF Nouveau solde:{' '}
                        {formatMoney(
                          balanceEquation.statementClosingAmount,
                          settings.currency,
                          settings.numberFormat
                        )}{' '}
                        (Diff:{' '}
                        {formatMoney(
                          balanceEquation.diff || 0,
                          settings.currency,
                          settings.numberFormat,
                          {showSign: true}
                        )}
                        )
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Search & Row Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 border-b app-border">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="w-3.5 h-3.5 app-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search notes, date, amount..."
                    className="w-full rounded-lg border app-input pl-8 pr-8 py-1.5 text-xs"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 app-text-muted hover:opacity-80"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {(
                    [
                      {id: 'all', label: `All (${rows.length})`},
                      {id: 'income', label: `Income (${summaryCounts.income})`},
                      {id: 'expense', label: `Expenses (${summaryCounts.expense})`},
                      {id: 'duplicates', label: `Duplicates (${summaryCounts.duplicates})`},
                      ...(summaryCounts.invalid > 0
                        ? [{id: 'invalid' as const, label: `Invalid (${summaryCounts.invalid})`}]
                        : []),
                      {id: 'selected', label: `Selected (${summaryCounts.selected})`},
                    ] as Array<{id: PdfRowFilter; label: string}>
                  ).map((chip) => {
                    const active = rowFilter === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setRowFilter(chip.id)}
                        className={`rounded-md border px-2.5 py-1 font-medium transition-colors ${
                          active
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                            : chip.id === 'duplicates' && summaryCounts.duplicates > 0
                              ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10'
                              : chip.id === 'invalid' && summaryCounts.invalid > 0
                                ? 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10'
                                : 'app-border app-text-muted hover:app-text-secondary'
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                  {(searchQuery || rowFilter !== 'all') && (
                    <span className="ml-1 font-mono-tabular app-text-muted">
                      ({filteredRows.length}/{rows.length})
                    </span>
                  )}
                </div>
              </div>

              {summaryCounts.selectedDuplicates > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b app-border bg-amber-500/10 text-xs text-amber-400">
                  <span>
                    {summaryCounts.selectedDuplicates} selected row(s) match existing ledger or in-PDF duplicates.
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openConflictsModal('duplicates', null)}
                      className="font-semibold underline hover:opacity-80"
                    >
                      Inspect in Popup
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectDuplicates}
                      className="font-semibold underline hover:opacity-80"
                    >
                      Deselect Duplicates
                    </button>
                  </div>
                </div>
              )}

              {sectionFilter !== 'all' && summaryCounts.activeSectionDuplicates > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b app-border app-surface-elevated text-xs app-text-muted">
                  <span>
                    {summaryCounts.activeSectionDuplicates} duplicate row(s) in {sectionFilter} left unticked to prevent double entry.
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openConflictsModal('duplicates', null)}
                      className="font-medium underline text-amber-400 hover:opacity-80"
                    >
                      Review in Popup
                    </button>
                    <button
                      type="button"
                      onClick={handleForceSelectAccountDuplicates}
                      className="font-medium underline hover:opacity-80"
                    >
                      Select Duplicates Anyway
                    </button>
                  </div>
                </div>
              )}

              {/* Desktop / Tablet Sticky Column Header Row */}
              <div ref={headerScrollRef} className="hidden md:block overflow-x-hidden">
                <table className="w-full min-w-[894px] table-fixed text-left border-collapse text-xs">
                  {tableColGroup}
                  <thead>{tableHeaderRow}</thead>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* When no PDF is loaded yet, Upload Dropzone + Paste Box + Alerts sit at top */}
      {!hasRows && (
        <>
          {renderUploadDropzone()}
          {renderPasteBox()}

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              {error}
            </div>
          )}

          {statusMessage && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
              {statusMessage}
            </div>
          )}
        </>
      )}

      {/* When rows are loaded: Table Rows Body connects flush beneath Sticky Header, followed by Yellow Upload Dropzone */}
      {hasRows && (
        <>
          <div className="rounded-b-xl border border-t-0 app-surface overflow-hidden">
            <div ref={bodyScrollRef} onScroll={handleBodyScroll} className="overflow-x-auto">
              <table className="w-full min-w-[894px] table-fixed text-left border-collapse text-xs">
                {tableColGroup}
                <thead className="md:hidden">{tableHeaderRow}</thead>
                <tbody className="divide-y app-border">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-xs app-text-muted">
                        No parsed transactions match your current filter/search.{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setRowFilter('all');
                          }}
                          className="underline font-semibold hover:opacity-80"
                        >
                          Clear Filters
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const typeCats = categories.filter((c) => c.type === row.type);
                      const isIncome = row.type === 'income';
                      const hasIssue = !row.isValid || row.isDuplicate;
                      return (
                        <tr
                          key={row.rowIndex}
                          className={
                            !row.isValid
                              ? 'bg-rose-500/5'
                              : row.isDuplicate
                                ? 'bg-amber-500/5'
                                : ''
                          }
                        >
                          <td className="py-2.5 px-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={!row.isValid}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {selected: e.target.checked})
                              }
                              className="w-4 h-4 accent-emerald-600"
                            />
                          </td>
                          <td
                            className="py-2.5 px-2 text-center font-mono-tabular font-semibold"
                            style={isIncome ? {color: 'var(--income-text)'} : undefined}
                          >
                            {row.rowIndex}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {!row.isValid ? (
                              <button
                                type="button"
                                onClick={() => openConflictsForRow(row)}
                                title={`${row.validationErrors[0] || 'Invalid entry'} — Click to review & fix in popup`}
                                className="inline-flex items-center justify-center text-rose-400 hover:scale-110 transition-transform"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            ) : row.isDuplicate ? (
                              <button
                                type="button"
                                onClick={() => openConflictsForRow(row)}
                                title={`${row.duplicateReason || 'Potential duplicate'} — Click to review & edit in popup`}
                                className="inline-flex items-center justify-center text-amber-400 hover:scale-110 transition-transform"
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                            ) : (
                              <span
                                title={`Ready · ${row.accountSection || 'Account'}`}
                                className="inline-flex items-center justify-center text-emerald-500"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) => updateRow(row.rowIndex, {date: e.target.value})}
                              className="w-full rounded border app-input px-2 py-1 font-mono-tabular"
                              style={isIncome ? {color: 'var(--income-text)'} : undefined}
                            />
                            {row.date && (
                              <div
                                className="text-[10px] app-text-muted mt-0.5 font-mono-tabular"
                                style={isIncome ? {color: 'var(--income-text)'} : undefined}
                              >
                                {formatDateDisplay(row.date, settings.dateFormat)}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2">
                            <select
                              value={row.type}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {
                                  type: e.target.value as TransactionType,
                                })
                              }
                              className="w-full rounded border app-input px-2 py-1 font-semibold"
                              style={isIncome ? {color: 'var(--income-text)'} : undefined}
                            >
                              <option value="income">Income</option>
                              <option value="expense">Expense</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-2">
                            <select
                              value={row.categoryId}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {categoryId: e.target.value})
                              }
                              className="w-full rounded border app-input px-2 py-1"
                              style={isIncome ? {color: 'var(--income-text)'} : undefined}
                            >
                              {typeCats.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-2.5">
                            <input
                              type="text"
                              value={row.notes}
                              onChange={(e) => updateRow(row.rowIndex, {notes: e.target.value})}
                              className="w-full rounded border app-input px-2.5 py-1.5"
                              style={isIncome ? {color: 'var(--income-text)'} : undefined}
                            />
                            {(row.accountSection || hasIssue) && (
                              <div className="text-[10px] app-text-muted mt-0.5 truncate flex items-center gap-1.5">
                                <span className="truncate">
                                  {row.accountSection}
                                  {row.isDuplicate && row.duplicateReason
                                    ? ` · ${row.duplicateReason}`
                                    : !row.isValid && row.validationErrors[0]
                                      ? ` · ${row.validationErrors[0]}`
                                      : ''}
                                </span>
                                {hasIssue && (
                                  <button
                                    type="button"
                                    onClick={() => openConflictsForRow(row)}
                                    className="shrink-0 underline font-medium text-amber-400 hover:opacity-80"
                                  >
                                    Edit in Popup
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                            <input
                              type="number"
                              step="0.01"
                              value={row.amount || ''}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {
                                  amount: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full rounded border app-input px-2 py-1 text-right font-mono-tabular font-semibold"
                              style={isIncome ? {color: 'var(--income-text)'} : undefined}
                            />
                            {row.amount > 0 && (
                              <div
                                className="text-[10px] mt-0.5 font-mono-tabular"
                                style={
                                  isIncome
                                    ? {color: 'var(--income-text)'}
                                    : {color: 'var(--text-muted)'}
                                }
                              >
                                {formatMoney(
                                  row.amount,
                                  settings.currency,
                                  settings.numberFormat
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Upload Dropzone ("Yellow Box") placed at the end of the list so it scrolls naturally */}
          <div className="mt-6">{renderUploadDropzone()}</div>
        </>
      )}

      {/* Conflicting / Duplicate / Invalid Records Popup Modal */}
      {showConflictsModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="animate-mfa-modal w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border app-surface shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b app-border">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <span>Conflicting Records — Duplicates &amp; Invalid Entries</span>
                  </h2>
                  <p className="text-xs app-text-muted mt-0.5">
                    {conflictRows.length} flagged record(s) · Edit date, type, category, notes, amount or include/exclude directly here
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConflictsModal(false)}
                  aria-label="Close conflicts popup"
                  className="p-2 rounded-lg app-text-muted hover:opacity-80"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Filter & Bulk Conflict Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b app-border app-surface-elevated text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      {id: 'all', label: `All Conflicts (${conflictRows.length})`},
                      {id: 'duplicates', label: `Duplicates (${summaryCounts.duplicates})`},
                      {id: 'invalid', label: `Invalid (${summaryCounts.invalid})`},
                    ] as Array<{id: ConflictModalFilter; label: string}>
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setConflictFilter(tab.id)}
                      className={`rounded-md border px-2.5 py-1 font-medium ${
                        conflictFilter === tab.id
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                          : 'app-border app-text-muted hover:app-text-secondary'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDeselectDuplicates}
                    className="rounded-lg border app-border px-2.5 py-1.5 font-medium app-text-secondary hover:opacity-80"
                  >
                    Untick All Duplicates
                  </button>
                  <button
                    type="button"
                    onClick={handleForceSelectAccountDuplicates}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 font-medium text-amber-400 hover:bg-amber-500/20"
                  >
                    Include Active Account Duplicates
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {visibleConflictRows.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <div className="text-sm font-semibold">
                      No conflicting records remaining in this filter!
                    </div>
                    <p className="text-xs app-text-muted">
                      All edited records are clean and ready to import.
                    </p>
                  </div>
                ) : (
                  visibleConflictRows.map((row) => {
                    const typeCats = categories.filter((c) => c.type === row.type);
                    const matchInfo = row.isDuplicate ? findMatchDetails(row) : null;
                    const isFocused = focusedConflictRowIndex === row.rowIndex;

                    return (
                      <div
                        key={row.rowIndex}
                        className={`rounded-xl border p-4 space-y-3 ${
                          !row.isValid
                            ? 'border-rose-500/40 bg-rose-500/5'
                            : row.isDuplicate
                              ? isFocused
                                ? 'border-amber-400 ring-1 ring-amber-400/40 bg-amber-500/5'
                                : 'border-amber-500/40 bg-amber-500/5'
                              : 'border-emerald-500/40 bg-emerald-500/5'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono-tabular font-bold px-2 py-0.5 rounded app-surface border app-border">
                              S.No #{row.rowIndex}
                            </span>
                            {row.accountSection && (
                              <span className="app-text-muted">{row.accountSection}</span>
                            )}
                            {!row.isValid ? (
                              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-rose-500/15 text-rose-400 font-semibold">
                                <XCircle className="w-3.5 h-3.5" />
                                Invalid
                              </span>
                            ) : row.isDuplicate ? (
                              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-amber-500/15 text-amber-400 font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Duplicate
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-emerald-500/15 text-emerald-400 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Resolved · Ready
                              </span>
                            )}
                          </div>

                          <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={!row.isValid}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {selected: e.target.checked})
                              }
                              className="w-4 h-4 accent-emerald-600"
                            />
                            <span className={!row.isValid ? 'app-text-muted' : ''}>
                              Include in Import
                            </span>
                          </label>
                        </div>

                        {/* Reason / Matched Entry Comparison */}
                        {!row.isValid && row.validationErrors.length > 0 && (
                          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                            {row.validationErrors.join(' · ')}
                          </div>
                        )}

                        {row.isDuplicate && (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs space-y-0.5">
                            <div className="font-semibold text-amber-300">
                              {row.duplicateReason || 'Potential duplicate detected'}
                            </div>
                            {matchInfo && (
                              <div className="text-[11px] app-text-secondary font-mono-tabular">
                                Matched ({matchInfo.source}): {matchInfo.summary}
                                {matchInfo.notes ? ` — "${matchInfo.notes}"` : ''}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Direct Edit Fields */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 text-xs">
                          <div className="sm:col-span-3">
                            <label className="block text-[10px] app-text-muted mb-1">
                              Date
                            </label>
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {date: e.target.value})
                              }
                              className="w-full rounded-lg border app-input px-2.5 py-1.5 font-mono-tabular"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[10px] app-text-muted mb-1">
                              Type
                            </label>
                            <select
                              value={row.type}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {
                                  type: e.target.value as TransactionType,
                                })
                              }
                              className="w-full rounded-lg border app-input px-2 py-1.5 font-semibold"
                            >
                              <option value="income">Income</option>
                              <option value="expense">Expense</option>
                            </select>
                          </div>

                          <div className="sm:col-span-4">
                            <label className="block text-[10px] app-text-muted mb-1">
                              Category
                            </label>
                            <select
                              value={row.categoryId}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {categoryId: e.target.value})
                              }
                              className="w-full rounded-lg border app-input px-2 py-1.5"
                            >
                              {typeCats.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-3">
                            <label className="block text-[10px] app-text-muted mb-1">
                              Amount
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={row.amount || ''}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {
                                  amount: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full rounded-lg border app-input px-2.5 py-1.5 text-right font-mono-tabular font-semibold"
                            />
                          </div>

                          <div className="sm:col-span-12">
                            <label className="block text-[10px] app-text-muted mb-1">
                              Notes / Description
                            </label>
                            <input
                              type="text"
                              value={row.notes}
                              onChange={(e) =>
                                updateRow(row.rowIndex, {notes: e.target.value})
                              }
                              className="w-full rounded-lg border app-input px-3 py-1.5"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t app-border text-xs">
                <div className="font-mono-tabular app-text-muted">
                  Ready to import:{' '}
                  <span className="font-semibold app-text-secondary">
                    {summaryCounts.selected} transaction(s)
                  </span>{' '}
                  · Net{' '}
                  <span
                    style={{
                      color:
                        balanceEquation.net >= 0
                          ? 'var(--income-text)'
                          : 'var(--expense-text)',
                    }}
                  >
                    {formatMoney(
                      balanceEquation.net,
                      settings.currency,
                      settings.numberFormat,
                      {showSign: true}
                    )}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowConflictsModal(false)}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-white min-h-[38px]"
                  style={{backgroundColor: 'var(--accent-primary)'}}
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
