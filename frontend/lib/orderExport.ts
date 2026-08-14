/**
 * Orders page → Excel export.
 *
 * With item details on: one row per item line, with the order-level columns
 * (order no., customer, status, totals) merged down across that order's rows
 * — so a five-item order reads as one block instead of its number and
 * customer repeating five times. An order with no items still gets one row.
 *
 * With item details off: one row per order, summary columns only.
 */

import * as XLSX from 'xlsx';
import type { OrderListItem } from './types';
import { ORDER_STATUS_LABELS } from './orders';

const SUMMARY_HEADER = [
  'Created', 'Customer', 'Company', 'Order No', 'Status',
  'Items', 'Pieces', 'Order Value', 'Advance', 'Balance', 'Exhibition',
];

const DETAIL_HEADER = [
  'Created', 'Customer', 'Company', 'Order No', 'Status',
  'Item Barcode', 'Colour', 'Size', 'Pieces', 'Rate', 'Amount',
  'Order Value', 'Advance', 'Balance', 'Exhibition',
];

// Columns carried at order level in the detail sheet — merged across
// however many item rows the order has. Item-line columns are never merged.
const ORDER_LEVEL_COLS = [0, 1, 2, 3, 4, 11, 12, 13, 14];

export function exportOrders(orders: OrderListItem[], includeItems: boolean) {
  const sheet = includeItems ? buildDetailSheet(orders) : buildSummarySheet(orders);

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Orders');

  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = includeItems ? 'with-items' : 'summary';
  XLSX.writeFile(book, `tejoo-orders-${suffix}-${stamp}.xlsx`);
}

function buildSummarySheet(orders: OrderListItem[]) {
  const rows: (string | number)[][] = [SUMMARY_HEADER];
  let orderValueSum = 0;
  let advanceSum = 0;

  for (const o of orders) {
    const balance = o.effective_value - o.advance_amount;
    rows.push([
      new Date(o.created_at).toLocaleDateString('en-IN'),
      o.lead_name || 'Unknown',
      o.lead_company_name || '',
      o.order_number,
      ORDER_STATUS_LABELS[o.status_code],
      o.item_count,
      o.total_pieces,
      o.effective_value,
      o.advance_amount,
      balance,
      o.exhibition_name || '',
    ]);
    orderValueSum += o.effective_value;
    advanceSum += o.advance_amount;
  }

  rows.push([]);
  rows.push(['', '', '', '', 'TOTAL', '', '', orderValueSum, advanceSum, orderValueSum - advanceSum, '']);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 11 },
    { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 },
  ];
  return sheet;
}

function buildDetailSheet(orders: OrderListItem[]) {
  const rows: (string | number)[][] = [DETAIL_HEADER];
  const merges: XLSX.Range[] = [];
  let orderValueSum = 0;
  let advanceSum = 0;

  for (const o of orders) {
    const items = o.items && o.items.length > 0 ? o.items : [null];
    const startRow = rows.length; // 0-indexed sheet row this order begins at
    const balance = o.effective_value - o.advance_amount;

    items.forEach((item, i) => {
      rows.push([
        i === 0 ? new Date(o.created_at).toLocaleDateString('en-IN') : '',
        i === 0 ? (o.lead_name || 'Unknown') : '',
        i === 0 ? (o.lead_company_name || '') : '',
        i === 0 ? o.order_number : '',
        i === 0 ? ORDER_STATUS_LABELS[o.status_code] : '',
        item?.barcode || '',
        item?.colour || '',
        item?.size || '',
        item?.pieces ?? '',
        item?.rate ?? '',
        item?.amount ?? '',
        i === 0 ? o.effective_value : '',
        i === 0 ? o.advance_amount : '',
        i === 0 ? balance : '',
        i === 0 ? (o.exhibition_name || '') : '',
      ]);
    });

    orderValueSum += o.effective_value;
    advanceSum += o.advance_amount;

    if (items.length > 1) {
      const endRow = rows.length - 1;
      for (const col of ORDER_LEVEL_COLS) {
        merges.push({ s: { r: startRow, c: col }, e: { r: endRow, c: col } });
      }
    }
  }

  // Totals row, one blank row below the data so it never looks merged into
  // the last order's block.
  rows.push([]);
  rows.push([
    '', '', '', '', 'TOTAL', '', '', '', '', '', '',
    orderValueSum, advanceSum, orderValueSum - advanceSum, '',
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = merges;
  sheet['!cols'] = [
    { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 11 },
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 11 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 },
  ];
  return sheet;
}
