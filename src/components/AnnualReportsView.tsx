import React, {useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {Download, Printer, X} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import {
  exportTransactionsToExcel,
  formatDateDisplay,
  formatMoney,
} from '../utils/formatters';
import {AnnualComparisonChart, type MonthlySeriesPoint} from './Charts';

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const FULL_MONTHS = [
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

export const AnnualReportsView: React.FC = () => {
  const {settings, categories, transactions} = useVault();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [drillMonthIdx, setDrillMonthIdx] = useState<number | null>(null);

  const availableYears = useMemo(() => {
    const yrs = new Set<number>([currentYear]);
    for (const tx of transactions) {
      const y = parseInt(tx.date.slice(0, 4), 10);
      if (!Number.isNaN(y)) yrs.add(y);
    }
    return Array.from(yrs).sort((a, b) => b - a);
  }, [transactions, currentYear]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const yearPrefix = `${selectedYear}-`;
  const yearTransactions = useMemo(
    () => transactions.filter((tx) => tx.date.startsWith(yearPrefix)),
    [transactions, yearPrefix]
  );

  // Starting balance prior to selectedYear
  const balanceBeforeYear = useMemo(() => {
    let bal = settings.openingBalance || 0;
    for (const tx of transactions) {
      if (tx.date < `${selectedYear}-01-01`) {
        bal += tx.type === 'income' ? tx.amount : -tx.amount;
      }
    }
    return bal;
  }, [transactions, settings.openingBalance, selectedYear]);

  const annualData = useMemo(() => {
    let annualIncome = 0;
    let annualExpenses = 0;

    const monthlyIncome = new Array<number>(12).fill(0);
    const monthlyExpense = new Array<number>(12).fill(0);
    const monthlyCount = new Array<number>(12).fill(0);
    const byCategory = new Map<
      string,
      {name: string; type: 'income' | 'expense'; amount: number}
    >();

    for (const tx of yearTransactions) {
      const monthIdx = parseInt(tx.date.slice(5, 7), 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        monthlyCount[monthIdx] += 1;
        if (tx.type === 'income') {
          monthlyIncome[monthIdx] += tx.amount;
          annualIncome += tx.amount;
        } else {
          monthlyExpense[monthIdx] += tx.amount;
          annualExpenses += tx.amount;
        }
      }

      const cat = catMap.get(tx.categoryId);
      const key = `${tx.type}::${cat?.name || 'Others'}`;
      const prev = byCategory.get(key) || {
        name: cat?.name || 'Others',
        type: tx.type,
        amount: 0,
      };
      prev.amount += tx.amount;
      byCategory.set(key, prev);
    }

    let runningBalance = balanceBeforeYear;
    const series: Array<MonthlySeriesPoint & {net: number; count: number}> = SHORT_MONTHS.map(
      (label, idx) => {
        const inc = monthlyIncome[idx];
        const exp = monthlyExpense[idx];
        const net = inc - exp;
        runningBalance += net;
        return {
          monthIndex: idx,
          label,
          income: inc,
          expense: exp,
          net,
          balance: runningBalance,
          count: monthlyCount[idx],
        };
      }
    );

    const categoryBreakdown = Array.from(byCategory.values()).sort(
      (a, b) => b.amount - a.amount
    );

    return {
      annualIncome,
      annualExpenses,
      annualNet: annualIncome - annualExpenses,
      series,
      categoryBreakdown,
    };
  }, [yearTransactions, catMap, balanceBeforeYear]);

  const drillTransactions = useMemo(() => {
    if (drillMonthIdx === null) return [];
    const prefix = `${selectedYear}-${String(drillMonthIdx + 1).padStart(2, '0')}`;
    return yearTransactions.filter((tx) => tx.date.startsWith(prefix));
  }, [drillMonthIdx, selectedYear, yearTransactions]);

  return (
    <div className="space-y-6">
      <div className="app-sticky-header -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 flex flex-wrap items-center justify-between gap-4 pb-4 border-b app-border">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {t(settings.language, 'navAnnual')}
          </h1>
          <p className="mt-1 text-xs sm:text-sm app-text-muted">
            {selectedYear} Annual Summary · Click any month to inspect its full transactions
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <select
            value={selectedYear}
            onChange={(e) => {
              setSelectedYear(Number(e.target.value));
              setDrillMonthIdx(null);
            }}
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
                yearTransactions,
                categories,
                settings.currency,
                settings.dateFormat,
                `MyFirstAccount_${selectedYear}`
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary min-h-[40px]"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'exportExcel')}</span>
          </button>
        </div>
      </div>

      {/* Annual KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border app-surface p-5">
          <div className="text-xs app-text-muted">Annual Income ({selectedYear})</div>
          <div
            className="mt-2 text-2xl font-bold font-mono-tabular"
            style={{color: 'var(--income-text)'}}
          >
            {formatMoney(annualData.annualIncome, settings.currency, settings.numberFormat)}
          </div>
        </div>
        <div className="rounded-xl border app-surface p-5">
          <div className="text-xs app-text-muted">Annual Expenses ({selectedYear})</div>
          <div
            className="mt-2 text-2xl font-bold font-mono-tabular"
            style={{color: 'var(--expense-text)'}}
          >
            {formatMoney(annualData.annualExpenses, settings.currency, settings.numberFormat)}
          </div>
        </div>
        <div className="rounded-xl border app-surface p-5">
          <div className="text-xs app-text-muted">Annual Net Income ({selectedYear})</div>
          <div
            className="mt-2 text-2xl font-bold font-mono-tabular"
            style={{
              color: annualData.annualNet >= 0 ? 'var(--income-text)' : 'var(--expense-text)',
            }}
          >
            {formatMoney(annualData.annualNet, settings.currency, settings.numberFormat, {
              showSign: true,
            })}
          </div>
        </div>
      </div>

      {/* Annual Income / Expense / Balance Chart */}
      <div className="rounded-xl border app-surface p-5 space-y-4">
        <h2 className="text-base font-semibold">Monthly Income, Expenses &amp; Balance Chart</h2>
        <AnnualComparisonChart
          data={annualData.series}
          currency={settings.currency}
          numberFormat={settings.numberFormat}
          onSelectMonth={(idx) => setDrillMonthIdx(idx)}
        />
      </div>

      {/* Month-wise Breakdown & Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 rounded-xl border app-surface overflow-hidden">
          <div className="px-5 py-4 border-b app-border">
            <h2 className="text-base font-semibold">Month-wise Details (Click row to open)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b app-border app-surface-elevated text-xs app-text-muted">
                  <th className="py-3 px-4 font-medium">Month</th>
                  <th className="py-3 px-4 font-medium text-right">Entries</th>
                  <th className="py-3 px-4 font-medium text-right">Income</th>
                  <th className="py-3 px-4 font-medium text-right">Expenses</th>
                  <th className="py-3 px-4 font-medium text-right">Net</th>
                  <th className="py-3 px-4 font-medium text-right">Closing Bal</th>
                </tr>
              </thead>
              <tbody className="divide-y app-border">
                {annualData.series.map((row) => (
                  <tr
                    key={row.label}
                    onClick={() => setDrillMonthIdx(row.monthIndex)}
                    className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="py-3 px-4 font-medium whitespace-nowrap">
                      {FULL_MONTHS[row.monthIndex]}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-xs app-text-muted whitespace-nowrap">
                      {row.count}
                    </td>
                    <td
                      className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap"
                      style={{color: 'var(--income-text)'}}
                    >
                      {formatMoney(row.income, settings.currency, settings.numberFormat)}
                    </td>
                    <td
                      className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap"
                      style={{color: 'var(--expense-text)'}}
                    >
                      {formatMoney(row.expense, settings.currency, settings.numberFormat)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-medium whitespace-nowrap">
                      {formatMoney(row.net, settings.currency, settings.numberFormat, {
                        showSign: true,
                      })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap">
                      {formatMoney(row.balance, settings.currency, settings.numberFormat)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4 rounded-xl border app-surface overflow-hidden">
          <div className="px-5 py-4 border-b app-border">
            <h2 className="text-base font-semibold">Annual Category Breakdown</h2>
          </div>
          {annualData.categoryBreakdown.length === 0 ? (
            <div className="p-8 text-center text-sm app-text-muted">
              No transactions recorded in {selectedYear}.
            </div>
          ) : (
            <div className="divide-y app-border">
              {annualData.categoryBreakdown.map((item) => (
                <div
                  key={`${item.type}-${item.name}`}
                  className="px-5 py-3 flex items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs app-text-muted">
                      {item.type === 'income' ? 'Income' : 'Expense'}
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
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Month Drill-Down Modal */}
      {drillMonthIdx !== null &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-3xl rounded-2xl border app-surface p-6 shadow-xl max-h-[85vh] flex flex-col animate-mfa-modal">
            <div className="flex items-center justify-between pb-4 border-b app-border">
              <div>
                <h2 className="text-lg font-semibold">
                  {FULL_MONTHS[drillMonthIdx]} {selectedYear} — Full Transactions
                </h2>
                <p className="text-xs app-text-muted font-mono-tabular mt-0.5">
                  {drillTransactions.length} entries · Income{' '}
                  {formatMoney(
                    annualData.series[drillMonthIdx].income,
                    settings.currency,
                    settings.numberFormat
                  )}{' '}
                  · Expenses{' '}
                  {formatMoney(
                    annualData.series[drillMonthIdx].expense,
                    settings.currency,
                    settings.numberFormat
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrillMonthIdx(null)}
                className="p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto my-4">
              {drillTransactions.length === 0 ? (
                <div className="py-12 text-center text-sm app-text-muted">
                  No transactions recorded in {FULL_MONTHS[drillMonthIdx]} {selectedYear}.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b app-border app-surface-elevated text-xs app-text-muted">
                      <th className="py-2.5 px-3 font-medium">Date</th>
                      <th className="py-2.5 px-3 font-medium">Category</th>
                      <th className="py-2.5 px-3 font-medium">Notes</th>
                      <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y app-border">
                    {drillTransactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-2.5 px-3 font-mono-tabular text-xs whitespace-nowrap">
                          {formatDateDisplay(tx.date, settings.dateFormat)}
                        </td>
                        <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                          {catMap.get(tx.categoryId)?.name || 'Others'}
                        </td>
                        <td className="py-2.5 px-3 app-text-secondary">{tx.notes || '—'}</td>
                        <td
                          className="py-2.5 px-3 text-right font-mono-tabular font-semibold whitespace-nowrap"
                          style={{
                            color:
                              tx.type === 'income' ? 'var(--income-text)' : 'var(--expense-text)',
                          }}
                        >
                          {formatMoney(tx.amount, settings.currency, settings.numberFormat, {
                            type: tx.type,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="pt-3 border-t app-border flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  exportTransactionsToExcel(
                    drillTransactions,
                    categories,
                    settings.currency,
                    settings.dateFormat,
                    `MyFirstAccount_${selectedYear}_${SHORT_MONTHS[drillMonthIdx]}`
                  )
                }
                disabled={drillTransactions.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3.5 py-2 text-xs font-medium disabled:opacity-40 min-h-[38px]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Month Excel</span>
              </button>
              <button
                type="button"
                onClick={() => setDrillMonthIdx(null)}
                className="rounded-lg border app-border px-4 py-2 text-xs font-medium min-h-[38px]"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  );
};
