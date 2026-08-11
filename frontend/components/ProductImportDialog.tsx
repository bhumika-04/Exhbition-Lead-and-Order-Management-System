'use client';

/**
 * Bulk load of the supplier's catalogue sheet.
 *
 * Two passes on purpose. The first is a preview the server produces with the
 * same validation it will use to write, so what the operator approves is
 * exactly what happens — a preview computed separately would eventually drift
 * from the commit and lie. Nothing is written until Save is pressed.
 */

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  X, Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, ImageOff, Eye,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/apiError';
import {
  parseWorkbook, downloadTemplate,
  type ImportRowInput, type ImportReport,
} from '@/lib/productImport';

type Stage = 'pick' | 'preview' | 'done';

export default function ProductImportDialog({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [rows, setRows] = useState<ImportRowInput[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStage('pick'); setFileName(''); setSheetName(''); setRows([]);
    setReport(null); setError(null); setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = () => { reset(); onClose(); };

  const pick = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    setFileName(file.name);

    try {
      const sheet = await parseWorkbook(file);

      if (sheet.missing.length > 0) {
        const where = sheet.sheetName ? ` The closest match was the "${sheet.sheetName}" tab.` : '';
        setError(
          `No ${sheet.missing.join(', ')} column found in any tab of this file.${where} ` +
          'Download the template to see the expected layout.'
        );
        setBusy(false);
        return;
      }
      if (sheet.rows.length === 0) {
        setError(`The "${sheet.sheetName}" tab has a header but no rows.`);
        setBusy(false);
        return;
      }

      setSheetName(sheet.sheetName ?? '');
      setRows(sheet.rows);
      const preview = await api.importProducts(sheet.rows, true);
      setReport(preview);
      setStage('preview');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not read that file'));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Only the rows that passed. Sending the rejects again would just produce
      // the same errors and slow the commit down.
      const good = rows.filter(r => report?.rows.find(x => x.line === r.line)?.ok);
      const result = await api.importProducts(good, false);
      setReport(result);
      setStage('done');
      onImported();
      toast.success(`${result.created} added, ${result.updated} updated`);
    } catch (err) {
      setError(apiErrorMessage(err, 'The import failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const noImage = report?.rows.filter(r => r.ok && r.image_url && !r.image_stored).length ?? 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px] flex items-center justify-center p-4"
        onClick={close}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          onClick={e => e.stopPropagation()}
          className="bg-card w-full max-w-3xl max-h-[88vh] rounded-xl border border-border shadow-lg flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {stage === 'done' ? 'Import complete' : 'Import products'}
                </p>
                {sheetName && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {fileName} · sheet &ldquo;{sheetName}&rdquo;
                  </p>
                )}
              </div>
            </div>
            <button onClick={close} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-4 overflow-y-auto flex-1">
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-px" />
                <p className="text-xs text-destructive leading-relaxed">{error}</p>
              </div>
            )}

            {stage === 'pick' && (
              <div className="space-y-4">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/40
                             hover:bg-secondary/40 transition-colors py-10 flex flex-col items-center gap-2
                             disabled:opacity-60"
                >
                  {busy
                    ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    : <Upload className="w-6 h-6 text-muted-foreground" />}
                  <span className="text-sm font-medium text-foreground">
                    {busy ? 'Reading…' : 'Choose an Excel or CSV file'}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    BARCODE · COLOUR · WSP · SIZE · IMAGE LINK
                  </span>
                </button>

                <div className="rounded-lg bg-secondary/50 border border-border px-3.5 py-3">
                  <p className="text-xs font-medium text-foreground mb-1.5">Brackets mean a set</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <code className="font-mono">(Sea Green,Ivory)</code> ships both colours together — 2 pcs per size.{' '}
                    <code className="font-mono">(M,L,XL,2XL)</code> ships all four sizes — 4 pcs per colour. Bracket
                    both and they multiply. Without brackets the values are a choice and carry no minimum.
                  </p>
                  <button onClick={downloadTemplate}
                          className="text-[11px] font-medium text-primary hover:underline mt-2">
                    Download the template
                  </button>
                </div>
              </div>
            )}

            {(stage === 'preview' || stage === 'done') && report && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Stat label={stage === 'done' ? 'Added' : 'To add'}
                        value={stage === 'done' ? report.created : report.rows.filter(r => r.action === 'create').length} />
                  <Stat label={stage === 'done' ? 'Updated' : 'To update'}
                        value={stage === 'done' ? report.updated : report.rows.filter(r => r.action === 'update').length} />
                  {report.invalid > 0 && <Stat label="Skipped" value={report.invalid} tone="bad" />}
                  {stage === 'done' && noImage > 0 && <Stat label="No image" value={noImage} tone="warn" />}
                </div>

                {/* Said plainly, because the table looks identical before and
                    after the write — without this the operator cannot tell
                    which side of the save they are on. */}
                {stage === 'preview' && (
                  <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
                    <Eye className="w-4 h-4 text-muted-foreground shrink-0 mt-px" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">Preview only — nothing has been saved yet.</span>{' '}
                      Check the rows below, then press Save to write them to the catalogue.
                      {report.invalid > 0 && ` The ${report.invalid} row${report.invalid === 1 ? '' : 's'} marked in red will be left out.`}
                    </p>
                  </div>
                )}

                {stage === 'done' && noImage > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5">
                    <ImageOff className="w-4 h-4 text-warning shrink-0 mt-px" />
                    <p className="text-[11px] text-foreground leading-relaxed">
                      {noImage} {noImage === 1 ? 'image' : 'images'} could not be downloaded, so those products have a
                      link but no picture on the Sales Order. Google Drive links must be shared as
                      &ldquo;Anyone with the link&rdquo; — a restricted file returns a sign-in page instead of an image.
                    </p>
                  </div>
                )}

                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-[42vh]">
                    <table className="w-full text-[11px]">
                      <thead className="bg-secondary/60 sticky top-0">
                        <tr className="text-left text-muted-foreground">
                          <Th>Row</Th><Th>Barcode</Th><Th>Colour</Th><Th>Size</Th>
                          <Th>Min pcs</Th><Th>Price</Th><Th>Result</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map(r => (
                          <tr key={r.line} className="border-t border-border">
                            <Td className="text-muted-foreground tabular">{r.line}</Td>
                            <Td className="font-mono">{r.barcode ?? '—'}</Td>
                            <Td>
                              <Axis values={r.colours} isSet={r.colour_is_set} />
                            </Td>
                            <Td>
                              <Axis values={r.sizes} isSet={r.size_is_set} />
                            </Td>
                            <Td className="tabular">
                              {r.minimum_pieces > 1
                                ? <span className="font-semibold text-foreground">{r.minimum_pieces}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </Td>
                            <Td className="tabular">{r.price != null ? `₹${r.price.toLocaleString('en-IN')}` : '—'}</Td>
                            <Td>
                              {r.ok
                                ? <span className="text-muted-foreground capitalize">{r.action}d</span>
                                : <span className="text-destructive">{r.errors.join('; ')}</span>}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border shrink-0">
            {stage === 'preview' && (
              <>
                <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>Choose another file</Button>
                <Button size="sm" onClick={commit} disabled={busy || (report?.valid ?? 0) === 0} className="gap-1.5">
                  {busy
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    : <><CheckCircle2 className="w-3.5 h-3.5" /> Save {report?.valid ?? 0} product{report?.valid === 1 ? '' : 's'}</>}
                </Button>
              </>
            )}
            {stage !== 'preview' && (
              <Button size="sm" variant={stage === 'done' ? 'default' : 'ghost'} onClick={close}>
                {stage === 'done' ? 'Done' : 'Cancel'}
              </Button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={e => pick(e.target.files?.[0] ?? null)}
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Values with the set shown as brackets, matching the sheet's own notation. */
function Axis({ values, isSet }: { values: string[]; isSet: boolean }) {
  if (values.length === 0) return <span className="text-muted-foreground">—</span>;
  const text = values.join(', ');
  return isSet
    ? <span className="font-medium text-primary">({text})</span>
    : <span className="text-foreground">{text}</span>;
}

function Stat({ label, value, tone = 'ok' }: { label: string; value: number; tone?: 'ok' | 'bad' | 'warn' }) {
  const colour = tone === 'bad'
    ? 'border-destructive/25 bg-destructive/[0.07] text-destructive'
    : tone === 'warn'
      ? 'border-warning/30 bg-warning/[0.08] text-foreground'
      : 'border-border bg-secondary/50 text-foreground';
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1.5 ${colour}`}>
      <span className="text-sm font-bold tabular">{value}</span>
      <span className="text-[11px]">{label}</span>
    </span>
  );
}

const Th = ({ children }: { children: React.ReactNode }) =>
  <th className="px-2.5 py-2 font-medium whitespace-nowrap">{children}</th>;

const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) =>
  <td className={`px-2.5 py-1.5 align-top ${className}`}>{children}</td>;
