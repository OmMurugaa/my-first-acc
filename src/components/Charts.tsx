import React, {useState} from 'react';
import type {CurrencyCode, NumberFormat} from '../types/finance';
import {formatMoney} from '../utils/formatters';

interface CategoryBarItem {
  label: string;
  amount: number;
  type: 'income' | 'expense';
}

export const CategoryBarChart: React.FC<{
  items: CategoryBarItem[];
  currency: CurrencyCode;
  numberFormat: NumberFormat;
}> = ({items, currency, numberFormat}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm app-text-muted">
        No category activity recorded for this month.
      </div>
    );
  }

  const maxVal = Math.max(...items.map((i) => i.amount), 1);

  return (
    <div className="space-y-3">
      {items.map((item, idx) => {
        const pct = Math.max(2, Math.round((item.amount / maxVal) * 100));
        const isHovered = hoveredIdx === idx;
        return (
          <div
            key={`${item.type}-${item.label}`}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            className="space-y-1.5"
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">{item.label}</span>
                <span className="app-text-muted">·</span>
                <span
                  className={
                    item.type === 'income' ? 'text-emerald-500' : 'text-rose-500'
                  }
                >
                  {item.type === 'income' ? 'Income' : 'Expense'}
                </span>
              </div>
              <span className="font-mono-tabular font-semibold">
                {formatMoney(item.amount, currency, numberFormat)}
              </span>
            </div>
            <div className="h-3 w-full rounded-md overflow-hidden app-surface-elevated border app-border">
              <div
                className={`h-full rounded-sm transition-opacity ${
                  item.type === 'income' ? 'bg-emerald-500' : 'bg-rose-500'
                } ${isHovered ? 'opacity-100' : 'opacity-85'}`}
                style={{width: `${pct}%`}}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export interface MonthlySeriesPoint {
  monthIndex: number; // 0..11
  label: string;
  income: number;
  expense: number;
  balance: number;
}

export const AnnualComparisonChart: React.FC<{
  data: MonthlySeriesPoint[];
  currency: CurrencyCode;
  numberFormat: NumberFormat;
  onSelectMonth?: (monthIndex: number) => void;
}> = ({data, currency, numberFormat, onSelectMonth}) => {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  const width = 760;
  const height = 270;
  const padL = 48;
  const padR = 20;
  const padT = 20;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxVal = Math.max(
    ...data.flatMap((d) => [d.income, d.expense, Math.abs(d.balance)]),
    100
  );

  const groupW = plotW / 12;
  const barW = Math.max(8, Math.min(16, groupW * 0.28));

  const yForValue = (val: number) => {
    const clamped = Math.max(0, val);
    return padT + plotH - (clamped / maxVal) * plotH;
  };

  // Balance trend line points
  const minBal = Math.min(...data.map((d) => d.balance), 0);
  const maxBal = Math.max(...data.map((d) => d.balance), 100);
  const balRange = Math.max(maxBal - minBal, 1);

  const balancePoints = data
    .map((d, idx) => {
      const cx = padL + idx * groupW + groupW / 2;
      const cy = padT + plotH - ((d.balance - minBal) / balRange) * (plotH * 0.85) - 6;
      return `${cx},${cy}`;
    })
    .join(' ');

  const activePoint = hoveredMonth !== null ? data[hoveredMonth] : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            <span>Income</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
            <span>Expenses</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" />
            <span>Closing Balance Trend</span>
          </span>
        </div>

        {activePoint ? (
          <div className="font-mono-tabular app-text-secondary">
            {activePoint.label}: In {formatMoney(activePoint.income, currency, numberFormat)} · Out{' '}
            {formatMoney(activePoint.expense, currency, numberFormat)} · Bal{' '}
            {formatMoney(activePoint.balance, currency, numberFormat)}
          </div>
        ) : (
          <div className="app-text-muted">Click any month bar to view month transactions</div>
        )}
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[560px] h-auto select-none"
          role="img"
          aria-label="Annual Income, Expenses, and Balance Chart"
        >
          {/* Horizontal guide lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padT + plotH - ratio * plotH;
            const labelVal = Math.round(maxVal * ratio);
            return (
              <g key={ratio}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="currentColor"
                  opacity={0.55}
                  className="font-mono-tabular"
                >
                  {labelVal >= 1000 ? `${Math.round(labelVal / 1000)}k` : labelVal}
                </text>
              </g>
            );
          })}

          {/* Monthly grouped bars */}
          {data.map((d, idx) => {
            const gx = padL + idx * groupW;
            const center = gx + groupW / 2;
            const incY = yForValue(d.income);
            const incH = Math.max(2, padT + plotH - incY);
            const expY = yForValue(d.expense);
            const expH = Math.max(2, padT + plotH - expY);
            const isHovered = hoveredMonth === idx;

            return (
              <g
                key={d.label}
                onMouseEnter={() => setHoveredMonth(idx)}
                onMouseLeave={() => setHoveredMonth(null)}
                onClick={() => onSelectMonth?.(d.monthIndex)}
                className="cursor-pointer"
              >
                <rect
                  x={gx + 2}
                  y={padT}
                  width={groupW - 4}
                  height={plotH}
                  rx={4}
                  fill="currentColor"
                  fillOpacity={isHovered ? 0.06 : 0}
                />
                <rect
                  x={center - barW - 2}
                  y={d.income > 0 ? incY : padT + plotH - 2}
                  width={barW}
                  height={d.income > 0 ? incH : 2}
                  rx={2}
                  fill="#10B981"
                  opacity={isHovered ? 1 : 0.85}
                />
                <rect
                  x={center + 2}
                  y={d.expense > 0 ? expY : padT + plotH - 2}
                  width={barW}
                  height={d.expense > 0 ? expH : 2}
                  rx={2}
                  fill="#F43F5E"
                  opacity={isHovered ? 1 : 0.85}
                />
                <text
                  x={center}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill="currentColor"
                  opacity={isHovered ? 1 : 0.7}
                  fontWeight={isHovered ? 700 : 500}
                >
                  {d.label}
                </text>
              </g>
            );
          })}

          {/* Balance line overlay */}
          <polyline
            fill="none"
            stroke="#FBBF24"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={balancePoints}
            pointerEvents="none"
          />
          {data.map((d, idx) => {
            const cx = padL + idx * groupW + groupW / 2;
            const cy = padT + plotH - ((d.balance - minBal) / balRange) * (plotH * 0.85) - 6;
            return (
              <circle
                key={`pt-${d.label}`}
                cx={cx}
                cy={cy}
                r={hoveredMonth === idx ? 4.5 : 3}
                fill="#FBBF24"
                pointerEvents="none"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
};
