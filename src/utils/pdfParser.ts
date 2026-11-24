import * as pdfjsLib from 'pdfjs-dist';
import type {
  Category,
  ImportRowPreview,
  StatementBalanceSummary,
  Transaction,
  TransactionType,
} from '../types/finance';
import {findDuplicateTransaction, validateTransactionInput} from './formatters';

// Configure local bundled worker so PDF parsing works 100% offline
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/* ============================================================================
 * Layout-Agnostic Bank Statement Parser
 * Adapted from verified cell/column/balance-arithmetic engine:
 *   - Gap-based token -> cell grouping (prevents description digits like 10H43 merging with 500,00)
 *   - End-of-cell monetary token isolation + multi-currency sign detection
 *   - Header column detection (Debit / Credit / Amount / Balance) + nearest-column mapping
 *   - Statement-period year & anchor rollover inference (e.g. Dec 2024 -> Jan 2025)
 *   - Opening/Closing balance block reconciliation (Ancien solde / Nouveau solde)
 *   - In-browser OCR fallback via tesseract.js for scanned/image PDFs
 * ========================================================================== */

interface RawPdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TextCell {
  s: string;
  x0: number;
  x1: number;
}

interface ReconstructedPdfLine {
  page: number;
  y: number;
  h: number;
  cells: TextCell[];
}

interface DetectedAmount {
  start: number;
  end: number;
  cents: number;
  sign: -1 | 0 | 1;
}

interface PositionedAmount {
  cents: number;
  sign: -1 | 0 | 1;
  x0: number;
  x1: number;
  xc: number;
}

type ColKind = 'debit' | 'credit' | 'balance' | 'amount';

interface HeaderCol {
  kind: ColKind;
  x0: number;
  x1: number;
  xc: number;
}

interface ParsedDateToken {
  y: number | null;
  mo: number;
  d: number;
  len: number;
}

interface IntermediateRow {
  d: ParsedDateToken;
  date: string;
  desc: string;
  amts: PositionedAmount[];
  cols: HeaderCol[] | null;
  page: number;
  h: number;
  lastY: number;
  cont: number;
  idx: number;
  section: string;
  balanceOnly: boolean;
  drop?: boolean;
  flags: string[];
  cents: number;
  balance: number | null;
  type: TransactionType | null;
}

interface BalanceEvent {
  kind: 'open' | 'close';
  label: string;
  val: number; // signed cents
  at: number;
  section: string;
}

const MONTH_RE =
  /^(jan(uary|vier)?|feb(ruary)?|fev(rier)?|mar(ch|s)?|apr(il)?|avr(il)?|may|mai|jun(e)?|juin|jul(y)?|juil(let)?|aug(ust)?|aou(t)?|sep(t(ember|embre)?)?|oct(ober|obre)?|nov(ember|embre)?|dec(ember|embre)?)$/;

const COLS_RE: Record<ColKind, RegExp> = {
  debit: /d[eé]bit|withdraw|money out|paid out|retrait|sortie/i,
  credit: /cr[eé]dit|deposit|money in|paid in|d[eé]p[oô]t|entr[eé]e|payments? in/i,
  balance: /balance|solde/i,
  amount: /^(amount|montant)/i,
};

const AMT_RE =
  /(?<![A-Za-zÀ-ÿ\d.,/])((?:[-+−–]\s*(?:€\s*)?|€\s*)?)(\d{1,3}(?:[ \u00A0\u202F.,']\d{3})+[.,]\d{2}|\d+[.,]\d{2})(?!\d)(?:\s?(CR|DR|EUR|€)(?![A-Za-z])|(-)(?![\w]))?/gi;

const BAL_ROW_RE =
  /^(opening|closing|previous|new|old|brought forward|carried forward|balance|solde|ancien solde|nouveau solde|total)/i;

const FOOT_RE =
  /page|total|solde|balance|statement|relev[eé]|iban|bic\b|siret|www\.|@|continued|suite|registered|©|mediateur|garantie|opposition/i;

const OPEN_RE =
  /^(ancien solde|solde pr[eé]c[eé]dent|solde initial|opening balance|previous balance|balance brought forward|brought forward)/i;

const CLOSE_RE =
  /^(nouveau solde|solde final|solde de cl[oô]ture|closing balance|new balance|balance carried forward|carried forward)/i;

const CUT_RE =
  /\s+(?:(?:REF|REFERENCE|R[eé]f[eé]rence|IDENT|MANDAT|DATE DE VALEUR|CARTE NUMERO)\b|COMPTE\s+FR\d|\d{8,})/i;

function isValidCalendarDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function monthNum(w: string): number | null {
  const s = w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f.]/g, '');
  if (!MONTH_RE.test(s)) return null;
  if (s.startsWith('juin')) return 6;
  if (s.startsWith('juil')) return 7;
  const map: Record<string, number> = {
    jan: 1,
    feb: 2,
    fev: 2,
    mar: 3,
    apr: 4,
    avr: 4,
    may: 5,
    mai: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    aou: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return map[s.slice(0, 3)] || null;
}

function parseDateAtStart(s: string): ParsedDateToken | null {
  const pad = (n: number | string) => String(n).padStart(2, '0');
  const out = (y: number | null, mo: number, d: number, len: number): ParsedDateToken => ({
    y,
    mo: +mo,
    d: +d,
    len,
  });
  const full = (y: number | string, mo: number | string, d: number | string, len: number) => {
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    return isValidCalendarDate(iso) ? out(+y, +mo, +d, len) : null;
  };

  let m: RegExpExecArray | null;
  if ((m = /^\s*(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s))) {
    return full(m[1], m[2], m[3], m[0].length);
  }
  if ((m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/.exec(s))) {
    const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return full(yr, +m[2], +m[1], m[0].length);
  }
  if ((m = /^\s*(\d{1,2})[ \t\u00A0]+([A-Za-zÀ-ÿ.]{3,10})[ \t\u00A0]+(\d{4}|\d{2})(?!\d)/.exec(s))) {
    const mo = monthNum(m[2]);
    if (mo) {
      const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return full(yr, mo, +m[1], m[0].length);
    }
  }
  if ((m = /^\s*(\d{1,2})[ \t\u00A0]+([A-Za-zÀ-ÿ.]{3,10})(?![A-Za-zÀ-ÿ\d])/.exec(s))) {
    const mo = monthNum(m[2]);
    if (mo && +m[1] >= 1 && +m[1] <= 31) return out(null, mo, +m[1], m[0].length);
  }
  if ((m = /^\s*(\d{2})[/.](\d{2})(?![\d/.\-])/.exec(s))) {
    const d = +m[1];
    const mo = +m[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return out(null, mo, d, m[0].length);
  }
  return null;
}

function amountToCents(core: string): number {
  const c = core.replace(/[ \u00A0\u202F']/g, '');
  const i = Math.max(c.lastIndexOf('.'), c.lastIndexOf(','));
  const intPart = parseInt(c.slice(0, i).replace(/[.,]/g, ''), 10) || 0;
  const fracPart = parseInt(c.slice(i + 1), 10) || 0;
  return intPart * 100 + fracPart;
}

function findAmounts(s: string): DetectedAmount[] {
  const out: DetectedAmount[] = [];
  AMT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMT_RE.exec(s))) {
    // Reject amounts glued to preceding digits/letters/slashes/dots (e.g. "10H43 500,00" -> never "43 500,00")
    if (m.index > 0 && /[A-Za-zÀ-ÿ\d.,/]/.test(s[m.index - 1])) continue;
    let sign: -1 | 0 | 1 = 0;
    const prefix = m[1] || '';
    if (/[-−–]/.test(prefix)) sign = -1;
    else if (/\+/.test(prefix)) sign = 1;
    const ind = m[3] && m[3].toUpperCase();
    if (ind === 'DR' || m[4] === '-') sign = -1;
    else if (ind === 'CR') sign = 1;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      cents: amountToCents(m[2]),
      sign,
    });
  }
  return out;
}

function pdfItemsToLines(items: RawPdfItem[], page: number): ReconstructedPdfLine[] {
  const its = items
    .filter((i) => i.str && i.str.trim() !== '')
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Array<{y: number; h: number; items: RawPdfItem[]}> = [];
  for (const it of its) {
    const h = it.h || 10;
    let L = lines[lines.length - 1];
    // 4pt minimum handles slightly offset column baselines (e.g. Livret A dates off by 1-3pt)
    // while keeping 9pt continuation lines separate
    if (!L || Math.abs(L.y - it.y) > Math.max(4, h * 0.55)) {
      L = {y: it.y, h, items: []};
      lines.push(L);
    }
    L.items.push(it);
  }

  return lines.map((L) => {
    L.items.sort((a, b) => a.x - b.x);
    const cells: TextCell[] = [];
    for (const it of L.items) {
      const c = cells[cells.length - 1];
      const gap = c ? it.x - c.x1 : 0;
      const h = it.h || 10;
      if (c && gap < h * 0.6) {
        c.s += (gap > h * 0.12 ? ' ' : '') + it.str;
        c.x1 = Math.max(c.x1, it.x + it.w);
      } else {
        cells.push({s: it.str, x0: it.x, x1: it.x + it.w});
      }
    }
    return {page, y: L.y, h: L.h, cells};
  });
}

function headerCols(cells: TextCell[]): HeaderCol[] | null {
  const cols: HeaderCol[] = [];
  for (const c of cells) {
    const kind = (['debit', 'credit', 'balance', 'amount'] as ColKind[]).find((k) =>
      COLS_RE[k].test(c.s.trim())
    );
    if (kind && c.s.trim().length <= 24) {
      cols.push({kind, x0: c.x0, x1: c.x1, xc: (c.x0 + c.x1) / 2});
    }
  }
  const kinds = new Set(cols.map((c) => c.kind));
  const ok =
    (kinds.has('debit') && kinds.has('credit')) ||
    (kinds.size >= 2 &&
      (kinds.has('amount') || kinds.has('debit') || kinds.has('credit')) &&
      kinds.has('balance'));
  return ok ? cols : null;
}

function nearestCol(cols: HeaderCol[], a: PositionedAmount): HeaderCol | null {
  let best: HeaderCol | null = null;
  let bd = 1e9;
  for (const c of cols) {
    const d = Math.min(Math.abs(a.x1 - c.x1), Math.abs(a.xc - c.xc), Math.abs(a.x0 - c.x0));
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function splitCells(cells: TextCell[]): {desc: string; amts: PositionedAmount[]} {
  const amts: PositionedAmount[] = [];
  const desc: string[] = [];
  for (const c of cells) {
    const text = c.s;
    const len = Math.max(1, text.length);
    const found = findAmounts(text);
    const keep: DetectedAmount[] = [];
    for (let i = found.length - 1; i >= 0; i--) {
      const a = found[i];
      const tail = keep.length ? text.slice(a.end, keep[0].start) : text.slice(a.end);
      if (tail.trim() === '') keep.unshift(a);
      else break;
    }
    const cut = keep.length ? keep[0].start : len;
    const left = text.slice(0, cut).trim();
    if (left) desc.push(left);
    for (const a of keep) {
      const px = (p: number) => c.x0 + (p / len) * (c.x1 - c.x0);
      const x0 = px(a.start);
      const x1 = px(a.end);
      amts.push({cents: a.cents, sign: a.sign, x0, x1, xc: (x0 + x1) / 2});
    }
  }
  return {desc: desc.join(' ').replace(/\s+/g, ' ').trim(), amts};
}

function detectSectionChange(joined: string): string | null {
  if (/compte\s+courant\s+postal|vos\s+op[ée]rations\s+ccp/i.test(joined)) {
    return 'Compte Courant Postal (CCP)';
  }
  if (/livret\s+a\s+n°|comptes\s+d['’]épargne|^livret\s+a\b/i.test(joined)) {
    return 'Livret A';
  }
  return null;
}

function shortDesc(full: string): string {
  const m = CUT_RE.exec(full);
  const s = (m ? full.slice(0, m.index) : full).replace(/\s+/g, ' ').trim();
  return (s || full).slice(0, 120);
}

function suggestCategoryId(
  notes: string,
  type: TransactionType,
  categories: Category[]
): string {
  const lower = notes.toLowerCase();
  const typeCats = categories.filter((c) => c.type === type);
  const others =
    typeCats.find((c) => c.isFixed && c.name.toLowerCase() === 'others') || typeCats[0];

  // Prioritize custom category names created by the user
  for (const cat of typeCats) {
    if (!cat.isFixed && lower.includes(cat.name.toLowerCase())) return cat.id;
  }

  // Match French telecom providers to any user custom Telephone/Mobile category
  if (type === 'expense') {
    const telecomCat = typeCats.find((c) =>
      /telephone|téléphone|telecom|mobile|phone/i.test(c.name)
    );
    if (
      telecomCat &&
      ['sfr', 'bouygues', 'orange', 'free mobile', 'sosh', 'red by sfr'].some((kw) =>
        lower.includes(kw)
      )
    ) {
      return telecomCat.id;
    }
  }

  const rules: Array<{pattern: RegExp; targets: string[]}> =
    type === 'income'
      ? [
          {pattern: /salaire|ansamble|paie|salary|payroll|wages|stipend/i, targets: ['Salary']},
          {pattern: /freelance|consulting|invoice|client|upwork|fiverr/i, targets: ['Freelance']},
          {
            pattern: /interets?\s+acquis|interet|dividend|interest|mutual|stock|invest|zerodha|groww/i,
            targets: ['Investments'],
          },
        ]
      : [
          {
            pattern: /\b(i3f|immobiliere|loyer|rent|lease|landlord|housing)\b/i,
            targets: ['Housing', 'Rent'],
          },
          {
            pattern:
              /macif|mutuelle|mutavie|amm|assurance|\b(axa|maif|groupama)\b|cotisations?\s+sant|pharmacie|m[eé]decin|docteur|dentiste|h[oô]pital|cpam|pharmacy|medical|hospital|clinic|doctor|health/i,
            targets: ['Insurance', 'Healthcare', 'Medical'],
          },
          {
            pattern:
              /\b(sfr|bouygues|orange|free\s*mobile|sosh|freebox|livebox|edf|engie|gaz|eau)\b|cotisation|electricity|internet|broadband|water|gas|jio|airtel|recharge|bill|emi/i,
            targets: ['Telephone', 'Internet', 'Bills'],
          },
          {
            pattern:
              /pension|alimentaire|mle\.anita|anita|tuition|school|college|education/i,
            targets: ['Education'],
          },
          {
            pattern:
              /suban|nazar|h market|leclerc|auchan|\blidl\b|monoprix|supermarch|boulangerie|restaurant|traiteur|swiggy|zomato|cafe|grocery|supermarket|milk|bakery|\bfood\b/i,
            targets: ['Food'],
          },
          {
            pattern:
              /sncf|ratp|navigo|essence|petrol|petrole|diesel|netto|peage|\b(uber|ola|rapido|metro|bus|train|irctc|flight|toll)\b|parking/i,
            targets: ['Transport'],
          },
          {
            pattern:
              /achat\s+cb|carrefour|amazon|flipkart|myntra|\bfnac\b|decathlon|shopping|mall|store|cloth/i,
            targets: ['Shopping'],
          },
        ];

  for (const rule of rules) {
    if (rule.pattern.test(notes)) {
      for (const target of rule.targets) {
        const matched = typeCats.find((c) => c.name.toLowerCase() === target.toLowerCase());
        if (matched) return matched.id;
      }
    }
  }

  return others?.id || '';
}

function parseStatementLines(
  lines: ReconstructedPdfLine[],
  existingTransactions: Transaction[],
  categories: Category[],
  fallbackYear?: number
): {rows: ImportRowPreview[]; balances: StatementBalanceSummary[]} {
  const pad = (n: number) => String(n).padStart(2, '0');

  // 1. Detect statement document year & latest explicit anchor date for Dec->Jan rollover
  const yc: Record<string, number> = {};
  const explicit: string[] = [];
  let docYear: number | null = null;

  for (const L of lines) {
    const txt = L.cells.map((c) => c.s).join(' ');
    const re = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})\b|\b(20\d{2})-(\d{2})-(\d{2})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) {
      const y = m[3] || m[4];
      const mo = +(m[3] ? m[2] : m[5]);
      const d = +(m[3] ? m[1] : m[6]);
      const iso = `${y}-${pad(mo)}-${pad(d)}`;
      if (isValidCalendarDate(iso)) {
        yc[y] = (yc[y] || 0) + 1;
        explicit.push(iso);
      }
    }
  }

  const ys = Object.keys(yc).sort((a, b) => yc[b] - yc[a]);
  if (ys.length) {
    docYear = +ys[0];
  } else {
    for (const L of lines) {
      const mm = /\b(20\d{2})\b/.exec(L.cells.map((c) => c.s).join(' '));
      if (mm) {
        docYear = +mm[1];
        break;
      }
    }
    if (!docYear) docYear = fallbackYear || new Date().getFullYear();
  }

  const anchor =
    explicit
      .filter((s) => +s.slice(0, 4) === docYear)
      .sort()
      .pop() || null;

  // 2. Scan lines into candidate transaction rows, header columns & open/close events
  const rows: IntermediateRow[] = [];
  const events: BalanceEvent[] = [];
  let cols: HeaderCol[] | null = null;
  let prev: IntermediateRow | null = null;
  let currentSection = 'Compte Courant Postal (CCP)';

  for (const L of lines) {
    const joined = L.cells.map((c) => c.s).join(' ').trim();
    const detectedSec = detectSectionChange(joined);
    if (detectedSec) {
      currentSection = detectedSec;
    }

    const hc = headerCols(L.cells);
    if (hc) {
      cols = hc;
      prev = null;
      continue;
    }

    const isOpen = OPEN_RE.test(joined);
    const isClose = !isOpen && CLOSE_RE.test(joined);
    if (isOpen || isClose) {
      const am = splitCells(L.cells).amts;
      const a = am[am.length - 1];
      if (a) {
        const labelMatch = isOpen
          ? /^(ancien\s+solde\s+au\s+\d{1,2}\/\d{1,2}\/\d{4}|opening\s+balance)/i.exec(joined)
          : /^(nouveau\s+solde\s+au\s+\d{1,2}\/\d{1,2}\/\d{4}|closing\s+balance)/i.exec(joined);
        events.push({
          kind: isOpen ? 'open' : 'close',
          label: labelMatch
            ? labelMatch[1]
            : isOpen
              ? 'Opening Balance'
              : 'Closing Balance',
          val: a.sign < 0 ? -a.cents : a.cents,
          at: rows.length,
          section: currentSection,
        });
      }
      prev = null;
      continue;
    }

    // Stop continuation merging at section boundaries or "Total des opérations"
    if (/total\s+des\s+op[ée]rations/i.test(joined)) {
      prev = null;
      continue;
    }

    const text = L.cells.map((c) => c.s).join('\t');
    const d = parseDateAtStart(text);
    if (!d) {
      if (!prev) continue;
      const {desc, amts} = splitCells(L.cells);
      if (amts.length && !prev.amts.length && !FOOT_RE.test(desc)) {
        prev.amts = amts;
        prev.cols = cols;
        if (desc) prev.desc += (prev.desc ? ' — ' : '') + desc;
        prev.lastY = L.y;
        continue;
      }
      if (
        !amts.length &&
        desc &&
        prev.cont < 4 &&
        L.page === prev.page &&
        prev.lastY - L.y <= Math.max(L.h, prev.h) * 2.6 &&
        !FOOT_RE.test(desc) &&
        desc.length <= 200
      ) {
        prev.desc += (prev.desc ? ' — ' : '') + desc;
        prev.cont++;
        prev.lastY = L.y;
      }
      continue;
    }

    // Strip leading date (and optional second value date) across cells cleanly
    let consumed = d.len;
    const d2 = parseDateAtStart(text.slice(consumed));
    if (d2 && /^[\s\t]/.test(text.slice(consumed))) consumed += d2.len;

    const rest: TextCell[] = [];
    let pos = 0;
    for (let i = 0; i < L.cells.length; i++) {
      const c = L.cells[i];
      const end = pos + c.s.length;
      if (end <= consumed) {
        pos = end + 1;
        continue;
      }
      if (pos < consumed) {
        const keep = c.s.slice(consumed - pos);
        rest.push({
          s: keep,
          x0: c.x0 + (c.x1 - c.x0) * ((consumed - pos) / Math.max(1, c.s.length)),
          x1: c.x1,
        });
      } else {
        rest.push(c);
      }
      pos = end + 1;
    }

    const {desc, amts} = splitCells(rest);
    const row: IntermediateRow = {
      d,
      date: '',
      desc,
      amts,
      cols,
      page: L.page,
      h: L.h,
      lastY: L.y,
      cont: 0,
      idx: rows.length,
      section: currentSection,
      balanceOnly: BAL_ROW_RE.test(desc),
      flags: [],
      cents: 0,
      balance: null,
      type: null,
    };
    rows.push(row);
    prev = row;
  }

  // 3. Resolve ISO dates with anchor-year rollover
  rows.forEach((r) => {
    let y = r.d.y;
    if (!y) {
      y = docYear!;
      if (anchor && `${docYear}-${pad(r.d.mo)}-${pad(r.d.d)}` > anchor) {
        y = docYear! - 1;
      }
    }
    const iso = `${y}-${pad(r.d.mo)}-${pad(r.d.d)}`;
    r.date = isValidCalendarDate(iso) ? iso : '';
  });

  const dated = rows.filter((r) => r.date);
  const isDescending = dated.length > 1 && dated[0].date > dated[dated.length - 1].date;
  const earlier = (i: number) => rows[isDescending ? i + 1 : i - 1];
  const lastSigned = (r: IntermediateRow) => {
    const a = r.amts[r.amts.length - 1];
    return a ? (a.sign < 0 ? -a.cents : a.cents) : null;
  };

  // Detect headerless (amount, balance) two-column statements
  let tests = 0;
  let hits = 0;
  rows.forEach((r, i) => {
    if (r.cols || r.amts.length < 2 || r.balanceOnly) return;
    const nb = earlier(i);
    if (!nb) return;
    const nbBal =
      nb.balanceOnly || (!nb.cols && nb.amts.length >= 2) ? lastSigned(nb) : null;
    if (nbBal === null) return;
    tests++;
    const ls = lastSigned(r);
    if (ls !== null && Math.abs(ls - nbBal) === r.amts[0].cents) hits++;
  });
  const headerlessBalance = tests > 0 && hits / tests >= 0.6;

  // 4. Resolve cents & income/expense type via column geometry (then fallback heuristics)
  const out: IntermediateRow[] = [];
  for (const r of rows) {
    if (r.balanceOnly) {
      r.balance = lastSigned(r);
      continue;
    }
    if (!r.amts.length) {
      r.drop = true;
      continue;
    }

    if (r.cols) {
      const by: Record<ColKind, PositionedAmount[]> = {
        debit: [],
        credit: [],
        amount: [],
        balance: [],
      };
      for (const a of r.amts) {
        const c = nearestCol(r.cols, a);
        if (c) by[c.kind].push(a);
      }
      if (by.balance.length) {
        const lastB = by.balance[by.balance.length - 1];
        r.balance = lastB.sign < 0 ? -lastB.cents : lastB.cents;
      }
      if (by.debit.length && by.credit.length) {
        r.cents = by.debit[0].cents;
        r.type = 'expense';
        r.flags.push('both');
      } else if (by.debit.length) {
        r.cents = by.debit[0].cents;
        r.type = 'expense';
      } else if (by.credit.length) {
        r.cents = by.credit[0].cents;
        r.type = 'income';
      } else if (by.amount.length) {
        const a = by.amount[0];
        r.cents = a.cents;
        if (a.sign) r.type = a.sign < 0 ? 'expense' : 'income';
      } else {
        r.balanceOnly = true;
        continue;
      }
    } else {
      let a = r.amts;
      if (a.length >= 2 && headerlessBalance) {
        r.balance = lastSigned(r);
        a = a.slice(0, a.length - 1);
      }
      r.cents = a[0].cents;
      if (a[0].sign) {
        r.type = a[0].sign < 0 ? 'expense' : 'income';
      } else {
        // Plain-text fallback keyword check when no PDF columns exist
        const lower = r.desc.toLowerCase();
        if (
          /^virement\s+de\b/i.test(r.desc) ||
          /\b(cr|credit|crédit|interets?\s+acquis|salaire|refund|cashback)\b/i.test(lower)
        ) {
          r.type = 'income';
        } else {
          r.type = 'expense';
        }
      }
    }
    out.push(r);
  }

  // 5. Balance arithmetic check (for statements with running balance column)
  rows.forEach((r, i) => {
    if (r.balanceOnly || r.drop || r.balance === null) return;
    const nb = earlier(i);
    if (!nb || nb.balance === null) return;
    const diff = r.balance - nb.balance;
    let dt: TransactionType | null = null;
    if (diff === r.cents) dt = 'income';
    else if (diff === -r.cents) dt = 'expense';
    if (dt && !r.type) r.type = dt;
    else if (dt && r.type && r.type !== dt) r.flags.push('balance');
    else if (!dt) r.flags.push('balance');
  });

  // 6. Group into account blocks using open/close balance events
  interface AccountBlock {
    section: string;
    open: number | null;
    openLabel: string;
    close: number | null;
    closeLabel: string;
    rows: IntermediateRow[];
  }
  const blocks: AccountBlock[] = [
    {
      section: out[0]?.section || 'Compte Courant Postal (CCP)',
      open: null,
      openLabel: 'Opening Balance',
      close: null,
      closeLabel: 'Closing Balance',
      rows: [],
    },
  ];
  let ei = 0;
  const blockNet = (b: AccountBlock) =>
    b.rows.reduce((s, x) => s + (x.type === 'income' ? x.cents : -x.cents), 0);

  const applyEvents = (upto: number) => {
    while (ei < events.length && events[ei].at <= upto) {
      const e = events[ei++];
      const cur = blocks[blocks.length - 1];
      if (e.kind === 'open') {
        if (!cur.rows.length) {
          cur.open = e.val;
          cur.openLabel = e.label;
          cur.section = e.section;
        } else if (cur.open !== null && cur.open + blockNet(cur) === e.val) {
          // Continuation page opening balance of the same account
        } else {
          blocks.push({
            section: e.section,
            open: e.val,
            openLabel: e.label,
            close: null,
            closeLabel: 'Closing Balance',
            rows: [],
          });
        }
      } else {
        cur.close = e.val;
        cur.closeLabel = e.label;
      }
    }
  };

  for (const r of out) {
    if (!(r.cents > 0)) continue;
    if (!r.type) r.type = 'expense';
    applyEvents(r.idx);
    const cur = blocks[blocks.length - 1];
    cur.rows.push(r);
  }
  applyEvents(Infinity);

  const balances: StatementBalanceSummary[] = blocks
    .filter((b) => b.rows.length > 0 || b.open !== null || b.close !== null)
    .map((b, i) => {
      let incCents = 0;
      let expCents = 0;
      for (const x of b.rows) {
        if (x.type === 'income') incCents += x.cents;
        else expCents += x.cents;
      }
      let reconciled: boolean | null = null;
      let reconciliationDiff: number | null = null;
      if (b.open !== null && b.close !== null) {
        const diffCents = b.close - (b.open + incCents - expCents);
        reconciled = diffCents === 0;
        reconciliationDiff = diffCents / 100;
      }
      return {
        accountSection:
          b.section || (i === 0 ? 'Compte Courant Postal (CCP)' : `Account ${i + 1}`),
        openingLabel: b.openLabel,
        openingAmount: b.open !== null ? b.open / 100 : null,
        closingLabel: b.closeLabel,
        closingAmount: b.close !== null ? b.close / 100 : null,
        incomeTotal: incCents / 100,
        expenseTotal: expCents / 100,
        reconciled,
        reconciliationDiff,
      };
    });

  // 7. Build ImportRowPreview entries with duplicate detection & validation
  const seenBatchKeys = new Set<string>();
  const previewRows: ImportRowPreview[] = [];
  let rowCounter = 1;

  for (const r of out) {
    if (!(r.cents > 0)) continue;
    const type: TransactionType = r.type || 'expense';
    const fullDesc = (r.desc || '').replace(/\s+/g, ' ').trim();
    const notes = fullDesc.slice(0, 180) || 'Imported Entry';
    const amount = r.cents / 100;
    const categoryId = suggestCategoryId(notes, type, categories);

    const validation = validateTransactionInput({
      date: r.date,
      amount,
      categoryId,
      type,
    });

    const dupExisting = validation.isValid
      ? findDuplicateTransaction(
          {date: r.date, amount, type, notes},
          existingTransactions
        )
      : undefined;

    const batchKey = `${r.date}|${type}|${r.cents}|${shortDesc(fullDesc).toLowerCase()}`;
    const isBatchDup = seenBatchKeys.has(batchKey);
    seenBatchKeys.add(batchKey);

    const isDuplicate = Boolean(dupExisting) || isBatchDup;
    const duplicateReason = dupExisting
      ? `Matches existing ledger entry ${dupExisting.id}`
      : isBatchDup
        ? 'Duplicate row within this PDF file'
        : undefined;

    previewRows.push({
      rowIndex: rowCounter++,
      rawLine: fullDesc,
      date: r.date,
      amount,
      type,
      categoryId,
      notes,
      accountSection: r.section,
      isValid: validation.isValid,
      validationErrors: validation.errors,
      isDuplicate,
      duplicateReason,
      selected: validation.isValid && !isDuplicate,
    });
  }

  return {rows: previewRows, balances};
}

export function parseStatementFromRawPages(
  pages: Array<{pageNum: number; items: RawPdfItem[]}>,
  existingTransactions: Transaction[],
  categories: Category[]
): {
  rows: ImportRowPreview[];
  balances: StatementBalanceSummary[];
  extractedLineCount: number;
} {
  const lines: ReconstructedPdfLine[] = [];
  for (const p of pages) {
    lines.push(...pdfItemsToLines(p.items, p.pageNum));
  }
  const {rows, balances} = parseStatementLines(lines, existingTransactions, categories);
  return {rows, balances, extractedLineCount: lines.length};
}

export async function parsePdfTransactions(
  file: File,
  existingTransactions: Transaction[],
  categories: Category[],
  onProgress?: (status: string) => void
): Promise<{
  rows: ImportRowPreview[];
  balances: StatementBalanceSummary[];
  totalPages: number;
  extractedLineCount: number;
  usedOcr: boolean;
}> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(arrayBuffer)});
  const pdf = await loadingTask.promise;

  const lines: ReconstructedPdfLine[] = [];
  let totalTextItems = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(`Reading PDF page ${pageNum} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    totalTextItems += textContent.items.length;

    const rawItems: RawPdfItem[] = [];
    for (const item of textContent.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tr = item.transform as number[];
      const h = Math.abs(tr[3]) || ('height' in item ? Number(item.height) : 10) || 10;
      const w =
        'width' in item && Number(item.width) > 0
          ? Number(item.width)
          : item.str.length * h * 0.5;
      rawItems.push({
        str: item.str,
        x: tr[4],
        y: tr[5],
        w,
        h,
      });
    }

    lines.push(...pdfItemsToLines(rawItems, pageNum));
  }

  let usedOcr = false;
  if (totalTextItems === 0) {
    usedOcr = true;
    onProgress?.('Scanned/image PDF detected — initializing in-browser OCR...');
    const {createWorker} = await import('tesseract.js');
    const worker = await createWorker('fra+eng');

    try {
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        onProgress?.(`Running OCR on page ${pageNum} of ${pdf.numPages}...`);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({scale: 2.2});
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) continue;

        await page.render({canvasContext: ctx2d, viewport, canvas}).promise;
        const ocrResult = await worker.recognize(canvas, {}, {blocks: true});
        const pageData = ocrResult.data as unknown as {
          blocks?: Array<{
            paragraphs?: Array<{
              lines?: Array<{
                text?: string;
                words?: Array<{
                  text: string;
                  bbox: {x0: number; x1: number; y0: number; y1: number};
                }>;
              }>;
            }>;
          }>;
          text?: string;
        };

        const ocrItems: RawPdfItem[] = [];
        if (pageData.blocks) {
          for (const block of pageData.blocks) {
            for (const para of block.paragraphs || []) {
              for (const ocrLine of para.lines || []) {
                for (const w of ocrLine.words || []) {
                  if (!w.text?.trim()) continue;
                  const h = Math.max(10, w.bbox.y1 - w.bbox.y0);
                  ocrItems.push({
                    str: w.text.trim(),
                    x: w.bbox.x0,
                    y: canvas.height - w.bbox.y0, // Flip to ascending-upward coordinate space
                    w: Math.max(4, w.bbox.x1 - w.bbox.x0),
                    h,
                  });
                }
              }
            }
          }
        }

        if (ocrItems.length > 0) {
          lines.push(...pdfItemsToLines(ocrItems, pageNum));
        } else if (pageData.text) {
          const fallbackLines = pageData.text.split('\n');
          fallbackLines.forEach((rawLine, idx) => {
            const text = rawLine.replace(/\s+/g, ' ').trim();
            if (!text) return;
            lines.push({
              page: pageNum,
              y: (fallbackLines.length - idx) * 20,
              h: 12,
              cells: [{s: text, x0: 0, x1: canvas.width * 0.8}],
            });
          });
        }
      }
    } finally {
      await worker.terminate();
    }
  }

  const {rows, balances} = parseStatementLines(lines, existingTransactions, categories);

  return {
    rows,
    balances,
    totalPages: pdf.numPages,
    extractedLineCount: lines.length,
    usedOcr,
  };
}

export function parsePastedStatementText(
  rawText: string,
  existingTransactions: Transaction[],
  categories: Category[]
): {rows: ImportRowPreview[]; balances: StatementBalanceSummary[]} {
  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  const reconstructed: ReconstructedPdfLine[] = rawLines.map((lineText, idx) => {
    const parts = lineText.split(/\t|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    let cursor = 0;
    const cells: TextCell[] = (parts.length > 0 ? parts : [lineText.trim()]).map((p) => {
      const x0 = cursor;
      const x1 = cursor + p.length * 8;
      cursor = x1 + 24;
      return {s: p, x0, x1};
    });
    return {
      page: 1,
      y: (rawLines.length - idx) * 20,
      h: 12,
      cells,
    };
  });

  return parseStatementLines(reconstructed, existingTransactions, categories);
}
