'use client';

import { Layers, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Quantity per size x colour combination.
 *
 * One block per colour; the size fields run ACROSS it and wrap. That is how a
 * size run is written on paper and how the supplier's own sheet reads, and it
 * puts the longer axis on the horizontal — four sizes in one colour is a short
 * wide strip rather than a tall narrow column with dead space beside it.
 *
 * Design rules this follows, learnt the hard way:
 *  - Fields FLOW, they do not sit in a fixed table. A table is only ever as
 *    wide as its widest row, so the block could not use the width it was given
 *    and could not shrink onto a phone either. Wrapping does both.
 *  - Every field keeps its own size label, because a wrapped cell would
 *    otherwise lose the column heading that explained it.
 *  - Empty cells are BLANK, not "0". A placeholder zero in every cell reads as
 *    a wall of noughts and hides the ones actually filled in.
 *  - Nothing is red until the operator has tried to continue. A form that
 *    opens already complaining teaches people to ignore it.
 *  - Totals appear only once there is something to total; a column of dashes is
 *    just visual debris.
 *  - Most orders touch two or three combinations out of the grid, so filling
 *    every cell by hand is the exception. Hence the quick-fill row.
 */
export default function QtyMatrix({
  sizes, colours, qty, onChange, onBulk, comboKey,
  sizeIsSet = false, colourIsSet = false, invalid = false,
}: {
  sizes: string[];
  colours: string[];
  /**
   * A set ships whole — one indivisible unit — so it cannot carry different
   * counts per size or per colour: asking for "1 in M, 2 in L" of something
   * sold as a set invites an order the supplier cannot fill piecemeal. Either
   * flag therefore collapses the WHOLE matrix to a SINGLE box, regardless of
   * how many sizes or colours the set spans; the value typed there is written
   * to every underlying combination.
   */
  sizeIsSet?: boolean;
  colourIsSet?: boolean;
  qty: Record<string, number>;
  onChange: (key: string, value: number) => void;
  /** Replaces the whole map: quick fill and clear. */
  onBulk?: (next: Record<string, number>) => void;
  comboKey: (size: string | null, colour: string | null) => string;
  /** Set once a save has been attempted, so errors surface at the right time. */
  invalid?: boolean;
}) {
  const get = (s: string | null, c: string | null) => qty[comboKey(s, c)] ?? 0;

  const clean = (raw: string) => {
    // Strip anything that is not a digit, so a stray character from a phone
    // keyboard cannot silently wipe the cell.
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0;
  };

  const set = (s: string | null, c: string | null, raw: string) =>
    onChange(comboKey(s, c), clean(raw));

  const axisSizes: (string | null)[] = sizes.length ? sizes : [null];
  const axisColours: (string | null)[] = colours.length ? colours : [null];

  // Sold as a set: either flag collapses every size AND every colour into one
  // box. The operator types one number — how many sets — not one per size.
  const isSet = sizeIsSet || colourIsSet;

  const boxSizes:   (string | null)[] = isSet ? [null] : axisSizes;
  const boxColours: (string | null)[] = isSet ? [null] : axisColours;

  /** Every combination one box stands for. */
  const membersOf = (s: string | null, c: string | null) =>
    isSet
      ? axisSizes.flatMap(x => axisColours.map(y => ({ size: x, colour: y })))
      : [{ size: s, colour: c }];

  const boxValue = (s: string | null, c: string | null) => {
    const first = membersOf(s, c)[0];
    return get(first.size, first.colour);
  };

  const setBox = (s: string | null, c: string | null, raw: string) => {
    const n = clean(raw);
    // Written through onBulk so all members change in one update — one onChange
    // per member would each read a stale qty and the last would win alone.
    if (!onBulk) { for (const m of membersOf(s, c)) set(m.size, m.colour, raw); return; }
    const next = { ...qty };
    for (const m of membersOf(s, c)) next[comboKey(m.size, m.colour)] = n;
    onBulk(next);
  };
  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  // Counted in BOXES, not combinations: a set is one thing to type.
  const cellCount = boxSizes.length * boxColours.length;
  const perBox = (axisSizes.length * axisColours.length) / cellCount;

  const fillAll = (n: number) => {
    if (!onBulk) return;
    const next: Record<string, number> = {};
    for (const s of axisSizes) for (const c of axisColours) next[comboKey(s, c)] = n;
    onBulk(next);
  };

  // Single combination: one field, no grid.
  if (cellCount === 1) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground">
          {perBox > 1 ? 'Sets' : 'Quantity'}
        </span>
        <Cell value={boxValue(boxSizes[0], boxColours[0])}
              invalid={invalid && total === 0}
              onChange={v => setBox(boxSizes[0], boxColours[0], v)} />
        <span className="text-xs text-muted-foreground">
          {perBox > 1 ? `x ${perBox} pcs = ${total} pieces` : 'pieces'}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Head */}
      <div className="flex items-center gap-2 flex-wrap">
        <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">
          {colours.length && sizes.length ? 'Pieces per size and colour'
            : sizes.length ? 'Pieces per size' : 'Pieces per colour'}
        </span>

        <span className={cn(
          'ml-auto text-xs font-semibold tabular px-1.5 py-0.5 rounded-md',
          total > 0        ? 'text-foreground bg-secondary'
            : invalid      ? 'text-destructive bg-destructive/10'
            :                'text-muted-foreground',
        )}>
          {total} pc
        </span>
      </div>

      {/*
        One wrapping row of fields per colour, rather than a fixed table.

        A table gives every cell the same column, so the block is only ever as
        wide as its widest row and the rest of the card is dead space — and with
        one colour and four sizes it collapsed into a tall thin strip. Flowing
        the fields horizontally lets them use whatever width the card has and
        wrap onto a second line when it runs out, so the same component suits a
        phone and a desktop without a breakpoint.

        Each field carries its own size label, so a wrapped row is still
        readable — in a table, a cell that wraps loses its heading.

        The colour blocks wrap too, on the same principle: two colours in one
        size were two nearly-empty bands stacked down the card when they fit
        side by side with room to spare. basis-[190px] is the width at which a
        colour name and a couple of fields stay legible; below that the block
        takes its own line.
      */}
      <div className="flex flex-wrap gap-1.5">
        {/* isSet never reaches this branch (it always collapses to cellCount
            === 1 above), so boxColours/boxSizes are the real axes here and
            get/set need no indirection through a box's members. */}
        {boxColours.map(c => {
          const rowTotal = axisSizes.reduce((sum, sz) => sum + get(sz, c), 0);
          return (
            <div key={c ?? '_'}
                 className="flex-1 basis-[190px] min-w-0
                            rounded-lg border border-border bg-card px-2 py-1.5">
              {colours.length > 0 && (
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-foreground truncate" title={c ?? undefined}>
                    {c}
                  </span>
                  <span className="ml-auto text-[10px] font-semibold text-muted-foreground tabular shrink-0">
                    {rowTotal > 0 ? `${rowTotal} pc` : ''}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {boxSizes.map(sz => (
                  <label key={sz ?? '_'} className="flex flex-col items-center gap-0.5">
                    {sz && (
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase leading-none">
                        {sz}
                      </span>
                    )}
                    <Cell value={get(sz, c)}
                          invalid={invalid && total === 0}
                          onChange={v => set(sz, c, v)} />
                  </label>
                ))}
              </div>
            </div>
          );
        })}

        {/* Per-size totals across every colour, only once more than one colour
            makes them mean something. basis-full forces its own line — it is a
            sibling of the colour blocks now, and would otherwise wrap up
            alongside one of them as though it belonged to it. */}
        {colours.length > 1 && sizes.length > 0 && (
          <div className="basis-full flex flex-wrap gap-1.5 px-2 -mt-0.5">
            {sizes.map(sz => {
              const colTotal = axisColours.reduce((sum, c) => sum + get(sz, c), 0);
              return (
                <span key={sz}
                      className="w-[46px] sm:w-[58px] text-center text-[10px] font-semibold
                                 text-muted-foreground tabular">
                  {colTotal > 0 ? `${sz} ${colTotal}` : ''}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick fill: most orders touch a couple of cells, but "one of each"
          is common enough to be worth a tap rather than six. */}
      {onBulk && (
        <div className="flex items-center gap-1.5">
          {/* perBox is always 1 here — isSet always collapses to the single-box
              branch above, so this grid never renders for a set. */}
          <span className="text-[10px] text-muted-foreground">Quick fill</span>
          {[1, 2, 5].map(n => (
            <button key={n} type="button" onClick={() => fillAll(n)}
                    className="h-6 px-2 rounded-md border border-border bg-card text-[11px]
                               font-medium text-muted-foreground hover:border-input hover:bg-secondary/60">
              {n} each
            </button>
          ))}
          {total > 0 && (
            <button type="button" onClick={() => fillAll(0)}
                    className="h-6 px-1.5 rounded-md text-[11px] text-muted-foreground hover:text-destructive
                               inline-flex items-center gap-0.5">
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Cell({
  value, onChange, invalid,
}: {
  value: number; onChange: (v: string) => void; invalid?: boolean;
}) {
  return (
    <input
      // text + inputMode/pattern rather than type="number": on iOS a number
      // input still offers "e", "+" and "-" and silently reports an empty value
      // for anything it considers invalid, so a typo can blank a quantity
      // without the operator seeing it. Digits are filtered in the handler.
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="next"
      autoComplete="off"
      maxLength={4}
      // Blank at zero, with no placeholder: an unfilled cell should look empty,
      // not like it already holds a value.
      value={value === 0 ? '' : value}
      onChange={e => onChange(e.target.value)}
      onFocus={e => e.target.select()}
      className={cn(
        // Narrower on a phone: three colours at 58px plus the size label and a
        // totals column overflows 360px, and a horizontal scroll inside a form
        // is the kind of thing people simply do not find.
        'w-[46px] sm:w-[58px] h-9 rounded-md border text-center text-sm tabular transition-colors',
        '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        'focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-input',
        value > 0
          ? 'border-primary/35 bg-primary/[0.07] text-foreground font-semibold'
          : invalid
            ? 'border-destructive/40 bg-card text-foreground'
            : 'border-border bg-card text-foreground hover:border-input',
      )}
    />
  );
}
