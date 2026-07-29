import { type ReactNode } from "react";
import { cn } from "../../lib/utils/cn.js";

export type ColumnAlign = "left" | "right" | "center";

export interface DataTableColumn<T> {
  /** Stable column id; also used to read a default cell value from the row. */
  key: string;
  header: ReactNode;
  /** Custom cell renderer. Omit to render `row[key]` as text. */
  render?: (row: T, index: number) => ReactNode;
  align?: ColumnAlign;
  /** Extra classes applied to both the header and body cells. */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Accessible table caption describing the contents. Required for a11y. */
  caption: string;
  /** Keep the caption for screen readers but hide it visually. */
  hideCaption?: boolean;
  /** Derive a stable React key per row. Defaults to the row index. */
  getRowKey?: (row: T, index: number) => string;
  /** Shown in place of the body when there are no rows. */
  emptyState?: ReactNode;
  className?: string;
}

const ALIGN_CLASS: Record<ColumnAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * Money gets the serif, which carries tabular numerals with it (see the
 * `.font-serif` base rule) so a column of figures stops jittering when a 1
 * replaces a 0 — the whole reason the role exists.
 *
 * Right alignment is the signal because in this kit it already IS the signal:
 * every `align: "right"` column across both apps is a currency amount, and
 * nothing else is right-aligned. Deriving it costs no API change; a parallel
 * `numeric` flag would be a second source of truth for the same fact and would
 * silently disagree with the alignment the first time someone set only one.
 */
const NUMERIC_CELL = "font-serif text-[0.9375rem]";

function defaultCell<T>(row: T, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return String(value);
}

/**
 * Accessible, generic data table. Renders a semantic <table> with a <caption>,
 * `scope="col"` headers, and a horizontal-scroll wrapper so wide tables never
 * force the page to scroll. Column definitions are typed against the row shape.
 */
export function DataTable<T>({
  columns,
  rows,
  caption,
  hideCaption = false,
  getRowKey,
  emptyState,
  className,
}: DataTableProps<T>) {
  const hasRows = rows.length > 0;

  return (
    <div
      className={cn(
        "w-full overflow-x-auto rounded-xl border border-border bg-card shadow-lift-1",
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">
        <caption
          className={cn(
            hideCaption ? "sr-only" : "px-4 pt-4 text-left text-sm text-muted-foreground",
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  // Small, wide-tracked, and quiet: the header row labels the
                  // data without competing with it for the eye.
                  "whitespace-nowrap px-4 py-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.09em] text-muted-foreground",
                  ALIGN_CLASS[column.align ?? "left"],
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            rows.map((row, rowIndex) => (
              <tr
                key={getRowKey ? getRowKey(row, rowIndex) : rowIndex}
                className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/60"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-4 py-2.5 align-middle text-foreground",
                      ALIGN_CLASS[column.align ?? "left"],
                      column.align === "right" && NUMERIC_CELL,
                      column.className,
                    )}
                  >
                    {column.render ? column.render(row, rowIndex) : defaultCell(row, column.key)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10">
                {emptyState ?? (
                  <p className="text-center text-sm text-muted-foreground">Nothing to show yet.</p>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
