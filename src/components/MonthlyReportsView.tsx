import React, {useMemo, useState} from 'react';
import {Download, Printer} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import {exportTransactionsToExcel, formatMoney} from '../utils/formatters';
import {CategoryBarChart} from './Charts';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const MonthlyReportsView: React.FC = () => {
  const {settings, categories, transactions} = useVault();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0..11

  const availableYears = useMemo(() => {
    const yrs = new Set<number>([now.getFullYear()]);
    for (const tx of transactions) {
      const y = parseInt(tx.date.slice(0, 4), 10);
      if (!Number.isNaN(y)) yrs.add(y);
    }
    return Array.from(yrs).sort((a, b) => b - a);
  }, [transactions, now]);

  const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;

  const monthTransactions = useMemo(
    () => transactions.filter((tx) => tx.date.startsWith(monthPrefix)),
    [transactions, monthPrefix]
  );

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const report = useMemo(() => {
    let totalIncome = 0;
    let totalExpenses = 0;
    const byCat = new Map<string, {name: string; type: 'income' | 'expense'; amount: number}>();

    for (const tx of monthTransactions) {
      if (tx.type === 'income') totalIncome += tx.amount;
      else totalExpenses += tx.amount;

      const cat = catMap.get(tx.categoryId);
      const key = `${tx.type}::${cat?.name || 'Others'}`;
      const existing = byCat.get(key) || {
        name: cat?.name || 'Others',
        type: tx.type,
        amount: 0,
      };
      existing.amount += tx.amount;
      byCat.set(key, existing);
    }

    const netIncome = totalIncome - totalExpenses;
    const savings = Math.max(0, netIncome);
    const savingsRate = totalIncome > 0 ? Math.round((netIncome / totalIncome) * 100) : 0;

    const breakdown = Array.from(byCat.values()).sort((a, b) => b.amount - a.amount);

    return {
      totalIncome,
      totalExpenses,
      netIncome,
      savings,
      savingsRate,
      breakdown,
    };
  }, [monthTransactions, catMap]);

  return (
    <div className="space-y-6">
      <div className="app-sticky-header -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 flex flex-wrap items-center justify-between gap-4 pb-4 border-b app-border">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {t(settings.language, 'navMonthly')}
          </h1>
          <p className="mt-1 text-xs sm:text-sm app-text-muted">
            {MONTHS[selectedMonth]} {selectedYear} · {monthTransactions.length} transactions
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="rounded-lg border app-input px-3 py-2 text-xs font-medium min-h-[40px]"
          >
            {MONTHS.map((m, idx) => (
              <option key={m} value={idx}>
                {m}
              </option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="rounded-lg border app-input px-3 py-2 text-xs font-mono-tabular font-medium min-h-[40px]"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary min-h-[40px]"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'printLedger')}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportTransactionsToExcel(
                monthTransactions,
                categories,
                settings.currency,
                settings.dateFormat,
                `MyFirstAccount_${monthPrefix}`
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary min-h-[40px]"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'exportExcel')}</span>
          </button>
        </div>
      </div>

      {/* 4 Monthly KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border app-surface p-5">
          <div className="text-xs app-text-muted">Total Income</div>
          <div
            className="mt-2 text-xl sm:text-2xl font-bold font-mono-tabular"
            style={{color: 'var(--income-text)'}}
          >
            {formatMoney(report.totalIncome, settings.currency, settings.numberFormat)}
          </div>
        </div>

        <div className="rounded-xl border app-surface p-5">
          <div className="text-xs app-text-muted">Total Expenses</div>
          <div
            className="mt-2 text-xl sm:text-2xl font-bold font-mono-tabular"
            style={{color: 'var(--expense-text)'}}
          >
            {formatMoney(report.totalExpenses, settings.currency, settings.numberFormat)}
          </div>
        </div>

        <div className="rounded-xl border app-surface p-5">
          <div className="text-xs app-text-muted">{t(settings.language, 'netIncome')}</div>
          <div
            className="mt-2 text-xl sm:text-2xl font-bold font-mono-tabular"
            style={{
              color: report.netIncome >= 0 ? 'var(--income-text)' : 'var(--expense-text)',
            }}
          >
            {formatMoney(report.netIncome, settings.currency, settings.numberFormat, {
              showSign: true,
            })}
          </div>
        </div>

        <div className="rounded-xl border app-surface p-5">
          <div className="text-xs app-text-muted">{t(settings.language, 'savings')}</div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono-tabular">
            {formatMoney(report.savings, settings.currency, settings.numberFormat)}
          </div>
          <div className="mt-1 text-xs app-text-muted font-mono-tabular">
            Savings Rate: {report.savingsRate}%
          </div>
        </div>
      </div>

      {/* Bar Chart + Category-wise Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 rounded-xl border app-surface p-5 space-y-4">
          <h2 className="text-base font-semibold">Category Bar Chart</h2>
          <CategoryBarChart
            items={report.breakdown.map((b) => ({
              label: b.name,
              amount: b.amount,
              type: b.type,
            }))}
            currency={settings.currency}
            numberFormat={settings.numberFormat}
          />
        </div>

        <div className="lg:col-span-5 rounded-xl border app-surface overflow-hidden">
          <div className="px-5 py-4 border-b app-border">
            <h2 className="text-base font-semibold">Category-wise Breakdown</h2>
          </div>
          {report.breakdown.length === 0 ? (
            <div className="p-8 text-center text-sm app-text-muted">
              No transactions for {MONTHS[selectedMonth]} {selectedYear}.
            </div>
          ) : (
            <div className="divide-y app-border">
              {report.breakdown.map((item) => {
                const denom =
                  item.type === 'income' ? report.totalIncome : report.totalExpenses;
                const share = denom > 0 ? ((item.amount / denom) * 100).toFixed(1) : '0.0';
                return (
                  <div
                    key={`${item.type}-${item.name}`}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs app-text-muted font-mono-tabular">
                        {item.type === 'income' ? 'Income' : 'Expense'} · {share}%
                      </div>
                    </div>
                    <div
                      className="font-mono-tabular font-semibold"
                      style={{
                        color:
                          item.type === 'income' ? 'var(--income-text)' : 'var(--expense-text)',
                      }}
                    >
                      {formatMoney(item.amount, settings.currency, settings.numberFormat)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
