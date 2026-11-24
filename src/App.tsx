import React, {useState} from 'react';
import {
  BarChart3,
  CalendarRange,
  Database,
  FileUp,
  Home,
  ListOrdered,
  Lock,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import {AnnualReportsView} from './components/AnnualReportsView';
import {AddTransactionView} from './components/AddTransactionView';
import {BackupView} from './components/BackupView';
import {DashboardView} from './components/DashboardView';
import {LockScreen} from './components/LockScreen';
import {MonthlyReportsView} from './components/MonthlyReportsView';
import {OnboardingWizard} from './components/OnboardingWizard';
import {PdfImportView} from './components/PdfImportView';
import {PreferencesView} from './components/PreferencesView';
import {OfflineIndicator, PWAInstallButton} from './components/PWAComponents';
import {SecurityView} from './components/SecurityView';
import {TransactionModal} from './components/TransactionModal';
import {TransactionsView} from './components/TransactionsView';
import {VaultProvider, useVault} from './context/VaultContext';
import {t} from './i18n/translations';
import type {ActiveTab, Transaction, TransactionType} from './types/finance';
import {formatMoney} from './utils/formatters';

const AppShell: React.FC = () => {
  const {status, settings, summary, lockVault} = useVault();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [defaultTxType, setDefaultTxType] = useState<TransactionType>('expense');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const openAddPage = (initialType: TransactionType = 'expense') => {
    setDefaultTxType(initialType);
    setActiveTab('add');
    setMobileMenuOpen(false);
  };

  const openEditModal = (tx: Transaction) => {
    setEditingTx(tx);
    setModalOpen(true);
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen app-canvas flex items-center justify-center p-6">
        <div className="text-sm app-text-muted">Initializing encrypted local vault...</div>
      </div>
    );
  }

  if (status === 'needs_setup') {
    return (
      <>
        <OnboardingWizard />
        <OfflineIndicator />
      </>
    );
  }

  if (status === 'locked') {
    return (
      <>
        <LockScreen />
        <OfflineIndicator />
      </>
    );
  }

  const navItems: Array<{
    id: ActiveTab;
    labelKey: string;
    helpText: string;
    icon: React.ComponentType<{className?: string}>;
  }> = [
    {
      id: 'dashboard',
      labelKey: 'navDashboard',
      helpText: 'Overview of monthly income, expenses, quick actions, and recent running balance',
      icon: Home,
    },
    {
      id: 'add',
      labelKey: 'addTransaction',
      helpText: 'Record a new encrypted income or expense transaction',
      icon: Plus,
    },
    {
      id: 'transactions',
      labelKey: 'navTransactions',
      helpText: 'Browse, filter, search, print, and export all ledger entries',
      icon: ListOrdered,
    },
    {
      id: 'monthly',
      labelKey: 'navMonthly',
      helpText: 'View monthly income vs expense charts and category breakdown',
      icon: BarChart3,
    },
    {
      id: 'annual',
      labelKey: 'navAnnual',
      helpText: 'View full-year trends, month-wise closing balances, and annual exports',
      icon: CalendarRange,
    },
    {
      id: 'pdf-import',
      labelKey: 'navPdfImport',
      helpText: 'Import transactions from bank statement PDFs or pasted text',
      icon: FileUp,
    },
    {
      id: 'backup',
      labelKey: 'navBackup',
      helpText: 'Create, merge, or restore encrypted .mfa and .MyPET vault backups',
      icon: Database,
    },
    {
      id: 'security',
      labelKey: 'navSecurity',
      helpText: 'Manage Master Password, Quick PIN unlock, auto-lock timer, and data reset',
      icon: ShieldCheck,
    },
    {
      id: 'preferences',
      labelKey: 'navPreferences',
      helpText: 'Configure language, currency, theme, opening balance, and categories',
      icon: Settings,
    },
  ];

  const mobileTabs: Array<{
    id: ActiveTab;
    shortLabel: string;
    helpText: string;
    icon: React.ComponentType<{className?: string}>;
  }> = [
    {id: 'dashboard', shortLabel: 'Home', helpText: 'Go to Dashboard overview', icon: Home},
    {id: 'add', shortLabel: 'Add Entry', helpText: 'Add a new Income or Expense entry', icon: Plus},
    {id: 'transactions', shortLabel: 'Ledger', helpText: 'View all Transactions', icon: ListOrdered},
    {id: 'monthly', shortLabel: 'Reports', helpText: 'Open Monthly Reports', icon: BarChart3},
  ];

  const handleSelectTab = (tab: ActiveTab) => {
    if (tab === 'add') {
      openAddPage('expense');
      return;
    }
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen app-canvas flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r app-border app-surface min-h-screen sticky top-0 h-screen">
        <div className="px-5 py-5 border-b app-border flex items-center justify-between gap-2">
          <span className="text-base font-bold tracking-tight whitespace-nowrap">
            MyFirst Account
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                title={item.helpText}
                className={`app-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[42px] whitespace-nowrap ${
                  active ? 'text-white' : 'app-text-secondary hover:bg-black/5 dark:hover:bg-white/[0.04]'
                }`}
                style={active ? {backgroundColor: 'var(--accent-primary)'} : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{t(settings.language, item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t app-border space-y-3">
          <div
            className="rounded-lg border app-border app-surface-elevated px-3.5 py-2.5 transition-colors hover:border-[var(--border-strong)]"
            title="Opening Balance + All-time Income − All-time Expenses"
          >
            <div className="text-[11px] app-text-muted">{t(settings.language, 'currentBalance')}</div>
            <div className="text-sm font-bold font-mono-tabular mt-0.5">
              {formatMoney(summary.currentBalance, settings.currency, settings.numberFormat)}
            </div>
          </div>

          <PWAInstallButton />

          <button
            type="button"
            onClick={lockVault}
            title="Lock the encrypted vault immediately and clear keys from memory"
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 active:scale-[0.98] transition-all min-h-[40px]"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{t(settings.language, 'lockVault')}</span>
          </button>
        </div>
      </aside>

      {/* Mobile Compact Top Header (<= 52px) */}
      <header className="no-print lg:hidden sticky top-0 z-30 h-13 border-b app-border app-surface px-4 flex items-center justify-between gap-3">
        <span className="text-sm font-bold tracking-tight whitespace-nowrap shrink-0">
          MyFirst Account
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <PWAInstallButton compact />
          <button
            type="button"
            onClick={lockVault}
            title="Lock encrypted vault immediately"
            className="p-2 rounded-lg border app-border app-text-secondary active:scale-95 transition-transform min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Lock vault"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-10">
        <div
          key={activeTab}
          className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-mfa-page"
        >
          {activeTab === 'dashboard' && (
            <DashboardView
              onAddTransaction={openAddPage}
              onEditTransaction={openEditModal}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'add' && (
            <AddTransactionView
              defaultType={defaultTxType}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'transactions' && (
            <TransactionsView onEditTransaction={openEditModal} />
          )}
          {activeTab === 'monthly' && <MonthlyReportsView />}
          {activeTab === 'annual' && <AnnualReportsView />}
          {activeTab === 'pdf-import' && <PdfImportView />}
          {activeTab === 'backup' && <BackupView />}
          {activeTab === 'security' && <SecurityView />}
          {activeTab === 'preferences' && <PreferencesView />}
        </div>
      </main>

      {/* Mobile Bottom Tab Bar (Thumb Zone) */}
      <nav className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t app-border app-surface pb-safe">
        <div className="grid grid-cols-5 h-14 items-center">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id)}
                title={tab.helpText}
                className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-transform active:scale-95"
                style={active ? {color: 'var(--accent-primary)'} : undefined}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{tab.shortLabel}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            title="Open Annual Reports, PDF Import, Backup, Security & Preferences"
            className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-transform active:scale-95"
            style={
              ['annual', 'pdf-import', 'backup', 'security', 'preferences'].includes(activeTab)
                ? {color: 'var(--accent-primary)'}
                : undefined
            }
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile More Sheet */}
      {mobileMenuOpen && (
        <div className="no-print lg:hidden fixed inset-0 z-50 bg-black/60 flex items-end">
          <div className="w-full rounded-t-2xl border-t app-border app-surface p-5 pb-8 space-y-3 animate-mfa-sheet">
            <div className="flex items-center justify-between pb-2 border-b app-border">
              <span className="text-sm font-semibold">Tools &amp; Vault Settings</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {navItems
                .filter((i) =>
                  ['annual', 'pdf-import', 'backup', 'security', 'preferences'].includes(i.id)
                )
                .map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectTab(item.id)}
                      title={item.helpText}
                      className={`app-nav-item flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium min-h-[46px] ${
                        active ? 'text-white' : 'app-surface-elevated border app-border'
                      }`}
                      style={active ? {backgroundColor: 'var(--accent-primary)'} : undefined}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{t(settings.language, item.labelKey)}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      <TransactionModal
        isOpen={modalOpen}
        editingTx={editingTx}
        defaultType={defaultTxType}
        onClose={() => setModalOpen(false)}
      />
      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <VaultProvider>
      <AppShell />
    </VaultProvider>
  );
}
