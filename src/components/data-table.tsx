'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import clsx from 'clsx';

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessor?: (row: T) => any;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortFn?: (a: T, b: T) => number;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  hideable?: boolean; // If false, column cannot be hidden in column customizer
}

export interface DataTableProps<T> {
  tableId: string;
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (row: T) => string;
  emptyMessage?: string;
  className?: string;
  toolbarActions?: React.ReactNode;
}

interface StoredTablePrefs {
  order?: string[];
  widths?: Record<string, number>;
  hidden?: string[];
  sort?: { id: string; dir: 'asc' | 'desc' } | null;
}

export function DataTable<T>({
  tableId,
  data,
  columns,
  keyExtractor,
  emptyMessage = 'No matching records found.',
  className,
  toolbarActions,
}: DataTableProps<T>) {
  const storageKey = `engos_table_${tableId}_prefs`;

  // Default states
  const defaultOrder = useMemo(() => columns.map((col) => col.id), [columns]);
  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {};
    columns.forEach((col) => {
      if (col.defaultWidth) map[col.id] = col.defaultWidth;
    });
    return map;
  }, [columns]);

  // Persistent preferences state
  const [columnOrder, setColumnOrder] = useState<string[]>(defaultOrder);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(defaultWidths);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [sortState, setSortState] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);

  // Settings dropdown open/closed
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Drag & drop state for column reordering
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed: StoredTablePrefs = JSON.parse(raw);
        if (parsed.order && Array.isArray(parsed.order)) {
          // Keep only valid columns that exist in current definitions + append any new ones
          const validOrder = parsed.order.filter((id) => columns.some((c) => c.id === id));
          const missing = columns.filter((c) => !validOrder.includes(c.id)).map((c) => c.id);
          setColumnOrder([...validOrder, ...missing]);
        }
        if (parsed.widths && typeof parsed.widths === 'object') {
          setColumnWidths((prev) => ({ ...prev, ...parsed.widths }));
        }
        if (parsed.hidden && Array.isArray(parsed.hidden)) {
          setHiddenColumns(parsed.hidden);
        }
        if (parsed.sort) {
          setSortState(parsed.sort);
        }
      }
    } catch {
      // Ignore parse/storage errors
    }
  }, [storageKey, columns]);

  // Save preferences to localStorage whenever they change
  const savePrefs = useCallback(
    (newOrder: string[], newWidths: Record<string, number>, newHidden: string[], newSort: { id: string; dir: 'asc' | 'desc' } | null) => {
      try {
        const payload: StoredTablePrefs = {
          order: newOrder,
          widths: newWidths,
          hidden: newHidden,
          sort: newSort,
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {
        // Ignore storage errors
      }
    },
    [storageKey]
  );

  // Close settings popover when clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }
    if (settingsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [settingsOpen]);

  // Reset to default layout
  const resetLayout = () => {
    setColumnOrder(defaultOrder);
    setColumnWidths(defaultWidths);
    setHiddenColumns([]);
    setSortState(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore
    }
  };

  // Column map for quick lookup
  const columnMap = useMemo(() => {
    const map = new Map<string, ColumnDef<T>>();
    columns.forEach((col) => map.set(col.id, col));
    return map;
  }, [columns]);

  // Ordered and visible columns
  const activeColumns = useMemo(() => {
    return columnOrder
      .map((id) => columnMap.get(id))
      .filter((col): col is ColumnDef<T> => col !== undefined)
      .filter((col) => !hiddenColumns.includes(col.id));
  }, [columnOrder, columnMap, hiddenColumns]);

  // Toggle sort direction on column header click
  const handleSortClick = (col: ColumnDef<T>) => {
    if (col.sortable === false && !col.accessor && !col.sortFn) return;

    let nextSort: { id: string; dir: 'asc' | 'desc' } | null = null;
    if (!sortState || sortState.id !== col.id) {
      nextSort = { id: col.id, dir: 'asc' };
    } else if (sortState.dir === 'asc') {
      nextSort = { id: col.id, dir: 'desc' };
    } else {
      nextSort = null;
    }

    setSortState(nextSort);
    savePrefs(columnOrder, columnWidths, hiddenColumns, nextSort);
  };

  // Sort rows based on active sortState
  const sortedData = useMemo(() => {
    if (!sortState) return data;
    const col = columnMap.get(sortState.id);
    if (!col) return data;

    const copy = [...data];
    copy.sort((a, b) => {
      if (col.sortFn) {
        const res = col.sortFn(a, b);
        return sortState.dir === 'asc' ? res : -res;
      }
      if (col.accessor) {
        const valA = col.accessor(a);
        const valB = col.accessor(b);

        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortState.dir === 'asc' ? valA - valB : valB - valA;
        }

        if (valA instanceof Date && valB instanceof Date) {
          return sortState.dir === 'asc' ? valA.getTime() - valB.getTime() : valB.getTime() - valA.getTime();
        }

        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        return sortState.dir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
      }
      return 0;
    });
    return copy;
  }, [data, sortState, columnMap]);

  // Column Resizing via Pointer Events
  const resizingRef = useRef<{
    colId: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const startResize = (e: React.PointerEvent, col: ColumnDef<T>, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    resizingRef.current = {
      colId: col.id,
      startX: e.clientX,
      startWidth: currentWidth || col.defaultWidth || 160,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    const { colId, startX, startWidth } = resizingRef.current;
    const col = columnMap.get(colId);
    const min = col?.minWidth ?? 80;
    const max = col?.maxWidth ?? 800;

    const deltaX = e.clientX - startX;
    const newWidth = Math.max(min, Math.min(max, startWidth + deltaX));

    setColumnWidths((prev) => ({
      ...prev,
      [colId]: newWidth,
    }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    const target = e.currentTarget as HTMLElement;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    const finalWidths = { ...columnWidths };
    resizingRef.current = null;
    savePrefs(columnOrder, finalWidths, hiddenColumns, sortState);
  };

  // Drag and Drop Reordering Handlers
  const handleDragStart = (e: React.DragEvent, colId: string) => {
    setDraggedColId(colId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', colId);
  };

  const handleDragOver = (e: React.DragEvent, targetColId: string) => {
    e.preventDefault();
    if (draggedColId && draggedColId !== targetColId) {
      setDragOverColId(targetColId);
    }
  };

  const handleDragLeave = () => {
    setDragOverColId(null);
  };

  const handleDrop = (e: React.DragEvent, targetColId: string) => {
    e.preventDefault();
    setDragOverColId(null);
    if (!draggedColId || draggedColId === targetColId) return;

    const newOrder = [...columnOrder];
    const fromIndex = newOrder.indexOf(draggedColId);
    const toIndex = newOrder.indexOf(targetColId);

    if (fromIndex !== -1 && toIndex !== -1) {
      newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, draggedColId);
      setColumnOrder(newOrder);
      savePrefs(newOrder, columnWidths, hiddenColumns, sortState);
    }
    setDraggedColId(null);
  };

  const toggleColumnVisibility = (colId: string) => {
    let nextHidden: string[];
    if (hiddenColumns.includes(colId)) {
      nextHidden = hiddenColumns.filter((id) => id !== colId);
    } else {
      nextHidden = [...hiddenColumns, colId];
    }
    setHiddenColumns(nextHidden);
    savePrefs(columnOrder, columnWidths, nextHidden, sortState);
  };

  return (
    <div className={clsx('space-y-2', className)}>
      {/* Top Table Toolbar with Controls */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {toolbarActions}
        </div>

        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setSettingsOpen((prev) => !prev)}
            className={clsx(
              'btn btn-sm btn-secondary flex items-center gap-1.5 transition-colors shadow-xs',
              settingsOpen && 'border-ink bg-surface-strong text-ink'
            )}
            title="Show or hide table columns"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="font-medium">Columns (Show/Hide)</span>
            <span className="text-[11px] text-muted-soft font-mono">({activeColumns.length}/{columns.length})</span>
          </button>

          {/* Column Customizer Popover */}
          {settingsOpen ? (
            <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-hairline bg-surface p-3 shadow-lg">
              <div className="flex items-center justify-between pb-2 border-b border-hairline">
                <span className="text-caption font-semibold text-ink">Customize Columns</span>
                <button
                  type="button"
                  onClick={resetLayout}
                  className="text-[11px] text-primary hover:underline"
                >
                  Reset layout
                </button>
              </div>

              <p className="py-2 text-[11px] text-muted-soft">
                Drag column headers left or right to reorder. Drag borders to resize.
              </p>

              <div className="max-h-56 overflow-y-auto space-y-1.5 pt-1">
                {columns.map((col) => {
                  const isVisible = !hiddenColumns.includes(col.id);
                  const canToggle = col.hideable !== false;
                  return (
                    <label
                      key={col.id}
                      className={clsx(
                        'flex items-center justify-between gap-2 rounded px-1.5 py-1 text-caption text-ink cursor-pointer hover:bg-canvas-soft',
                        !canToggle && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      <span className="truncate">{col.header}</span>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        disabled={!canToggle}
                        onChange={() => toggleColumnVisibility(col.id)}
                        className="rounded border-hairline-strong text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Main Table Container with Independent Horizontal & Vertical Layout */}
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="table w-full border-collapse text-left select-none">
          <thead>
            <tr className="border-b border-hairline bg-canvas-soft">
              {activeColumns.map((col) => {
                const width = columnWidths[col.id];
                const isSorted = sortState?.id === col.id;
                const isDragging = draggedColId === col.id;
                const isDragOver = dragOverColId === col.id;
                const isSortable = col.sortable !== false && (Boolean(col.accessor) || Boolean(col.sortFn));

                return (
                  <th
                    key={col.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, col.id)}
                    onDragOver={(e) => handleDragOver(e, col.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col.id)}
                    style={{ width: width ? `${width}px` : undefined, minWidth: `${col.minWidth ?? 80}px` }}
                    className={clsx(
                      'group relative px-base py-3 text-caption font-semibold text-muted tracking-wider uppercase transition-colors',
                      isSortable ? 'cursor-pointer hover:text-ink hover:bg-surface-strong/50' : 'cursor-default',
                      isDragging && 'opacity-40 bg-surface-strong',
                      isDragOver && 'border-l-2 border-primary bg-primary/5',
                      col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                    )}
                    onClick={() => isSortable && handleSortClick(col)}
                  >
                    <div className="flex items-center gap-1.5 justify-between">
                      <span className="truncate" title={`Drag to move "${col.header}"`}>
                        {col.header}
                      </span>

                      {/* Sort indicator */}
                      <span className="inline-flex shrink-0 items-center text-ink text-xs">
                        {isSorted ? (
                          sortState.dir === 'asc' ? (
                            <span className="text-primary font-bold">↑</span>
                          ) : (
                            <span className="text-primary font-bold">↓</span>
                          )
                        ) : isSortable ? (
                          <span className="text-muted-soft opacity-0 group-hover:opacity-100 transition-opacity">↕</span>
                        ) : null}
                      </span>
                    </div>

                    {/* Column Resizer Handle */}
                    <div
                      onPointerDown={(e) => startResize(e, col, width || 160)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize hover:bg-primary/50 transition-colors z-10 select-none touch-none"
                      title="Drag to resize column"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={activeColumns.length}
                  className="px-base py-8 text-center text-body-sm text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((row) => (
                <tr key={keyExtractor(row)} className="hover:bg-canvas-soft/60 transition-colors">
                  {activeColumns.map((col) => {
                    const content = col.cell ? col.cell(row) : col.accessor ? col.accessor(row) : null;
                    return (
                      <td
                        key={col.id}
                        className={clsx(
                          'px-base py-3 text-body-sm text-body align-middle',
                          col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                        )}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
