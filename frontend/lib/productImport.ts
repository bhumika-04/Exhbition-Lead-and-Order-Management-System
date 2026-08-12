/**
 * Reading the supplier's catalogue sheet in the browser.
 *
 * Parsing here rather than on the server means the operator sees the preview
 * immediately and the API needs no spreadsheet library. The server still
 * validates every row — this file only turns a workbook into rows.
 */

import * as XLSX from 'xlsx';

export interface ImportRowInput {
  line: number;
  barcode: string;
  colour: string;
  wsp: string;
  size: string;
  image_link: string;
  fabric?: string;
  name?: string;
}

export interface ImportRowResult {
  line: number;
  barcode: string | null;
  ok: boolean;
  action: 'create' | 'update' | 'ignored' | 'skip';
  colours: string[];
  sizes: string[];
  colour_is_set: boolean;
  size_is_set: boolean;
  minimum_pieces: number;
  price: number | null;
  image_url: string | null;
  image_stored: boolean;
  errors: string[];
}

export interface ImportReport {
  total: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  ignored: number;
  dry_run: boolean;
  rows: ImportRowResult[];
}

/**
 * Column names are matched loosely — a header may be "WSP", "wsp" or
 * "W.S.P.", and "PRODUCT IMAGE LINK" and "IMAGE LINK" are the same column.
 * Anchoring on exact strings would reject a sheet for a stray space.
 */
const HEADER_ALIASES: Record<keyof Omit<ImportRowInput, 'line'>, string[]> = {
  barcode:   ['barcode', 'bar code', 'sku', 'design', 'design no', 'designno'],
  colour:    ['colour', 'color', 'colours', 'colors'],
  wsp:       ['wsp', 'price', 'rate', 'wholesale', 'wholesaleprice', 'wholesellingprice'],
  size:      ['size', 'sizes'],
  image_link: ['imagelink', 'productimagelink', 'image', 'imageurl', 'photo', 'picture'],
  fabric:    ['fabric', 'material'],
  name:      ['name', 'productname', 'description'],
};

const canonical = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function findColumns(header: unknown[]): Partial<Record<keyof ImportRowInput, number>> {
  const map: Partial<Record<keyof ImportRowInput, number>> = {};
  header.forEach((cell, index) => {
    const key = canonical(cell);
    if (!key) return;
    (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).forEach(field => {
      if (map[field] === undefined && HEADER_ALIASES[field].some(a => canonical(a) === key)) {
        map[field] = index;
      }
    });
  });
  return map;
}

export interface ParsedSheet {
  rows: ImportRowInput[];
  missing: string[];       // required columns the sheet does not have
  skippedBlank: number;
  sheetName?: string;      // which worksheet the rows came from
}

const REQUIRED: [keyof ImportRowInput, string][] = [
  ['barcode', 'BARCODE'], ['colour', 'COLOUR'], ['wsp', 'WSP'], ['size', 'SIZE'],
];

/**
 * Locates the header row in one worksheet and scores how well it matches.
 *
 * The score is what lets the caller choose between worksheets. A catalogue
 * exported from Google Sheets carries helper tabs behind the XLOOKUPs on the
 * visible one, and those tabs often have a barcode column of their own — so
 * "first sheet" and even "first sheet with a barcode column" both pick the
 * wrong one. The sheet with the most required columns is the real catalogue.
 */
function scoreSheet(sheet: XLSX.WorkSheet) {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: '' });

  let best = { score: 0, headerIndex: -1, columns: {} as Partial<Record<keyof ImportRowInput, number>> };

  // Scans further than it looks: with blank rows kept, a title and some spacing
  // above the header eat into this window.
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const columns = findColumns(grid[i] ?? []);
    const score = REQUIRED.filter(([f]) => columns[f] !== undefined).length;
    if (score > best.score) best = { score, headerIndex: i, columns };
    if (score === REQUIRED.length) break;    // nothing can beat a full match
  }

  return { ...best, grid };
}

/**
 * Turns the first worksheet into rows.
 *
 * The header is located rather than assumed to be row 1, because these sheets
 * often carry a title or a blank line above it — reading row 1 blindly would
 * report "no BARCODE column" on a perfectly good file.
 */
export async function parseWorkbook(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer();
  // cellDates keeps a date-formatted cell readable; without it a stray date in
  // the price column arrives as an Excel serial number and imports as ₹45000.
  const book = XLSX.read(buffer, { type: 'array', cellDates: true });

  if (book.SheetNames.length === 0)
    return { rows: [], missing: REQUIRED.map(([, l]) => l), skippedBlank: 0 };

  // Every worksheet is scored and the best one wins. See scoreSheet.
  let chosen: ReturnType<typeof scoreSheet> | null = null;
  let chosenName = '';
  for (const name of book.SheetNames) {
    const candidate = scoreSheet(book.Sheets[name]);
    if (!chosen || candidate.score > chosen.score) { chosen = candidate; chosenName = name; }
    if (chosen.score === REQUIRED.length) break;
  }

  const { grid, headerIndex, columns } = chosen!;
  const missing = REQUIRED.filter(([f]) => columns[f] === undefined).map(([, label]) => label);
  if (headerIndex === -1 || missing.length > 0)
    return { rows: [], missing, skippedBlank: 0, sheetName: chosenName };

  const cell = (row: unknown[], field: keyof ImportRowInput): string => {
    const index = columns[field];
    return index === undefined ? '' : String(row[index] ?? '').trim();
  };

  const rows: ImportRowInput[] = [];
  let skippedBlank = 0;

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const barcode = cell(row, 'barcode');
    const colour = cell(row, 'colour');
    const size = cell(row, 'size');
    const wsp = cell(row, 'wsp');

    // A row with nothing in any meaningful column is spacing, not an error.
    if (!barcode && !colour && !size && !wsp) { skippedBlank++; continue; }

    rows.push({
      line: i + 1,               // 1-based, so it matches the row number in Excel
      barcode, colour, wsp, size,
      image_link: cell(row, 'image_link'),
      fabric: cell(row, 'fabric') || undefined,
      name: cell(row, 'name') || undefined,
    });
  }

  return { rows, missing, skippedBlank, sheetName: chosenName };
}

/** The blank sheet, with one worked example of each bracket case. */
export function downloadTemplate() {
  const rows = [
    ['BARCODE', 'COLOUR', 'WSP', 'SIZE', 'IMAGE LINK', 'FABRIC', 'NAME'],
    ['A1215065', 'Sea Green, Ivory', '6295', 'FREE SIZE', '', 'Shimmer', ''],
    ['A1215069', '(Sea Green,Ivory)', '6295', 'FREE SIZE', '', 'Shimmer', ''],
    ['A1215067', 'Navy', '5595', '(M,L,XL,2XL)', '', 'Cotton', ''],
    ['A1174830', '(Grey,Mouse)', '7195', '(M,L,XL)', '', 'Silk', ''],
    [],
    ['Brackets mean the values ship together as a SET.'],
    ['(Sea Green,Ivory) = the customer takes both colours: 2 pcs per size.'],
    ['(M,L,XL,2XL) = the customer takes all four sizes: 4 pcs per colour.'],
    ['Both bracketed = every colour in every size, so (Grey,Mouse) x (M,L,XL) is 6 pcs.'],
    ['Without brackets the values are a choice and carry no minimum.'],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 34 }, { wch: 14 }, { wch: 18 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Products');
  XLSX.writeFile(book, 'tejoo-product-import-template.xlsx');
}

/** The live catalogue, in the same shape the importer reads back. */
export function exportProducts(products: {
  barcode: string; colour?: string | null; price: number; size?: string | null;
  image_url?: string | null; fabric?: string | null; name?: string | null;
  colour_is_set: boolean; size_is_set: boolean;
}[]) {
  const bracket = (csv: string | null | undefined, isSet: boolean) => {
    const value = (csv ?? '').trim();
    // Re-exported with brackets so the file round-trips: importing what was
    // exported must not quietly turn a set back into a list of choices.
    return isSet && value ? `(${value})` : value;
  };

  const rows = [
    ['BARCODE', 'COLOUR', 'WSP', 'SIZE', 'IMAGE LINK', 'FABRIC', 'NAME'],
    ...products.map(p => [
      p.barcode,
      bracket(p.colour, p.colour_is_set),
      p.price,
      bracket(p.size, p.size_is_set),
      p.image_url ?? '',
      p.fabric ?? '',
      p.name ?? '',
    ]),
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 34 }, { wch: 14 }, { wch: 18 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Products');

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(book, `tejoo-products-${stamp}.xlsx`);
}
