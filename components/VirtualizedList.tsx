import React, { useRef, useState, useLayoutEffect, CSSProperties, ReactNode, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';

export interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number, style?: CSSProperties) => ReactNode;
  height?: number;
  maxHeight?: number;
  minHeight?: number;
  width?: number | string;
  className?: string;
  emptyPlaceholder?: ReactNode;
  overscanCount?: number;
  getItemKey?: (item: T, index: number) => string | number;
  onScroll?: (props: { scrollOffset: number; scrollDirection: 'forward' | 'backward' }) => void;
  header?: ReactNode;
  footer?: ReactNode;
}

/**
 * High-FPS Zero-Blank-Flash VirtualizedList
 * - Uses quantized chunk windowing so normal wheel/trackpad scrolling runs at 120fps
 *   on the GPU compositor without triggering React re-renders on every pixel.
 * - Uses generous viewport-adaptive overscan (~950px above & below) + synchronous
 *   flushSync guard on large scrollbar jumps so rapid scrolling NEVER flashes white.
 */
export function VirtualizedList<T>({
  items,
  itemHeight,
  renderItem,
  height,
  maxHeight = 650,
  minHeight = 120,
  width = '100%',
  className = '',
  emptyPlaceholder,
  overscanCount = 12,
  getItemKey,
  onScroll,
  header,
  footer,
}: VirtualizedListProps<T>): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  const [measuredHeight, setMeasuredHeight] = useState<number>(() => {
    if (height && height > 0) return height;
    return typeof window !== 'undefined' ? Math.max(window.innerHeight - 200, 600) : 700;
  });

  // Generous overscan (~950px above and below viewport) prevents blank checkerboarding on fast flicks
  const effectiveOverscan = useMemo(() => {
    const minByPixels = Math.ceil(950 / Math.max(itemHeight, 1));
    return Math.max(overscanCount, minByPixels);
  }, [overscanCount, itemHeight]);

  // Quantize window shifts into multi-row chunks so scrolling 1px doesn't trigger React renders
  const chunkStep = useMemo(() => {
    return Math.max(1, Math.floor(effectiveOverscan / 3));
  }, [effectiveOverscan]);

  const computeWindowForScroll = useCallback(
    (scrollOffset: number, total: number, viewportH: number) => {
      if (total === 0) return { startIndex: 0, endIndex: 0 };
      if (!height && total <= 120) {
        return { startIndex: 0, endIndex: total - 1 };
      }
      const rawFirstVisible = Math.max(0, Math.floor(scrollOffset / itemHeight));
      const quantizedFirst = Math.floor(rawFirstVisible / chunkStep) * chunkStep;
      const start = Math.max(0, quantizedFirst - effectiveOverscan);
      const visibleCount = Math.ceil(viewportH / itemHeight) + chunkStep;
      const end = Math.min(total - 1, quantizedFirst + visibleCount + effectiveOverscan);
      return { startIndex: start, endIndex: end };
    },
    [height, itemHeight, chunkStep, effectiveOverscan]
  );

  const [windowRange, setWindowRange] = useState<{ startIndex: number; endIndex: number }>(() =>
    computeWindowForScroll(0, items.length, measuredHeight)
  );
  const committedRangeRef = useRef(windowRange);
  committedRangeRef.current = windowRange;

  useLayoutEffect(() => {
    if (height && height > 0) {
      setMeasuredHeight(height);
      const next = computeWindowForScroll(lastScrollTop.current, items.length, height);
      setWindowRange((prev) =>
        prev.startIndex === next.startIndex && prev.endIndex === next.endIndex ? prev : next
      );
      return;
    }

    const updateHeight = () => {
      const container = containerRef.current;
      const topOffset = container ? Math.max(0, container.getBoundingClientRect().top) : 180;
      const viewportAvailable =
        typeof window !== 'undefined' ? Math.max(window.innerHeight - topOffset - 24, 520) : 650;
      const calculated = Math.min(Math.max(viewportAvailable, minHeight), Math.max(maxHeight, 750));
      setMeasuredHeight(calculated);
      const curScroll = container ? container.scrollTop : lastScrollTop.current;
      const next = computeWindowForScroll(curScroll, items.length, calculated);
      setWindowRange((prev) =>
        prev.startIndex === next.startIndex && prev.endIndex === next.endIndex ? prev : next
      );
    };

    updateHeight();
    window.addEventListener('resize', updateHeight, { passive: true });
    return () => {
      window.removeEventListener('resize', updateHeight);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [height, maxHeight, minHeight, items.length, computeWindowForScroll]);

  const totalCount = items.length;
  const totalContentHeight = totalCount * itemHeight;

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const newScrollTop = e.currentTarget.scrollTop;
      const direction = newScrollTop > lastScrollTop.current ? 'forward' : 'backward';
      lastScrollTop.current = newScrollTop;

      if (onScroll) {
        onScroll({
          scrollOffset: newScrollTop,
          scrollDirection: direction,
        });
      }

      const nextRange = computeWindowForScroll(newScrollTop, totalCount, measuredHeight);
      const current = committedRangeRef.current;
      if (nextRange.startIndex === current.startIndex && nextRange.endIndex === current.endIndex) {
        return;
      }

      // Check if viewport is close to outrunning currently rendered DOM rows (e.g. fast scrollbar drag)
      const topRenderedPx = current.startIndex * itemHeight;
      const bottomRenderedPx = (current.endIndex + 1) * itemHeight;
      const safetyMarginPx = itemHeight * 3;
      const isOutrunningBuffer =
        newScrollTop < topRenderedPx + safetyMarginPx ||
        newScrollTop + measuredHeight > bottomRenderedPx - safetyMarginPx;

      if (isOutrunningBuffer) {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        committedRangeRef.current = nextRange;
        flushSync(() => {
          setWindowRange(nextRange);
        });
      } else if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          const latestRange = computeWindowForScroll(lastScrollTop.current, totalCount, measuredHeight);
          const prevCommitted = committedRangeRef.current;
          if (
            latestRange.startIndex !== prevCommitted.startIndex ||
            latestRange.endIndex !== prevCommitted.endIndex
          ) {
            committedRangeRef.current = latestRange;
            setWindowRange(latestRange);
          }
        });
      }
    },
    [onScroll, computeWindowForScroll, totalCount, measuredHeight, itemHeight]
  );

  if (totalCount === 0) {
    return (
      <div
        ref={containerRef}
        className={`w-full overflow-hidden flex flex-col justify-center items-center ${className}`}
        style={{ minHeight, width }}
      >
        {emptyPlaceholder || (
          <div className="p-8 text-center text-gray-400 font-medium text-sm">
            No records to display
          </div>
        )}
      </div>
    );
  }

  // Open flow for small lists (<= 120 items) without fixed height
  if (!height && totalCount <= 120) {
    return (
      <div
        ref={containerRef}
        className={`w-full relative ${className}`}
        style={{ width }}
      >
        {header && <div className="sticky top-0 z-20 shrink-0">{header}</div>}
        <div className="w-full divide-y divide-white/5">
          {items.map((item, index) => {
            const key = getItemKey ? getItemKey(item, index) : `virt_item_${index}`;
            return (
              <React.Fragment key={key}>
                {renderItem(item, index, undefined)}
              </React.Fragment>
            );
          })}
        </div>
        {footer && <div className="shrink-0">{footer}</div>}
      </div>
    );
  }

  const clampedStart = Math.min(windowRange.startIndex, Math.max(0, totalCount - 1));
  const clampedEnd = Math.min(windowRange.endIndex, totalCount - 1);
  const offsetY = clampedStart * itemHeight;
  const visibleItems = items.slice(clampedStart, clampedEnd + 1);

  const containerStyle: CSSProperties = {
    height: height ? height : Math.min(measuredHeight, Math.max(totalContentHeight, minHeight)),
    maxHeight: Math.max(maxHeight, 750),
    minHeight: Math.min(minHeight, totalContentHeight),
    width,
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehaviorY: 'contain',
    WebkitOverflowScrolling: 'touch',
    contain: 'layout paint',
    position: 'relative',
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`custom-scrollbar touch-pan-y relative ${className}`}
      style={containerStyle}
    >
      {header && <div className="sticky top-0 z-20 shrink-0">{header}</div>}

      {/* Sizer spacer div maintaining exact native scrollbar thumb physics */}
      <div
        style={{
          height: totalContentHeight,
          width: '100%',
          position: 'relative',
          contain: 'layout style',
        }}
      >
        {/* Positioned slice container */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translate3d(0, ${offsetY}px, 0)`,
          }}
        >
          {visibleItems.map((item, localIdx) => {
            const index = clampedStart + localIdx;
            const key = getItemKey ? getItemKey(item, index) : `virt_item_${index}`;
            const itemStyle: CSSProperties = {
              height: itemHeight,
              boxSizing: 'border-box',
            };
            return (
              <React.Fragment key={key}>
                {renderItem(item, index, itemStyle)}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  );
}

export interface VirtualizedTableProps<T> {
  items: T[];
  rowHeight: number;
  renderRow: (item: T, index: number, style?: CSSProperties) => ReactNode;
  columns?: { header: ReactNode; width?: string | number; className?: string }[];
  columnsHeader?: ReactNode;
  headerCellClassName?: string;
  disableHorizontalScroll?: boolean;
  height?: number;
  maxHeight?: number;
  minHeight?: number;
  minTableWidth?: number;
  emptyPlaceholder?: ReactNode;
  className?: string;
  getItemKey?: (item: T, index: number) => string | number;
  onRowClick?: (item: T) => void;
}

/**
 * VirtualizedTable provides 120fps zero-lag scrolling for dense desktop tables
 * with sticky columns header and zero backdrop-blur overhead.
 */
export function VirtualizedTable<T>({
  items,
  rowHeight,
  renderRow,
  columns,
  columnsHeader,
  headerCellClassName = 'px-4',
  disableHorizontalScroll = false,
  height,
  maxHeight = 650,
  minHeight = 200,
  minTableWidth,
  emptyPlaceholder,
  className = '',
  getItemKey,
  onRowClick,
}: VirtualizedTableProps<T>): React.ReactElement {
  const effectiveMinWidth = disableHorizontalScroll ? undefined : minTableWidth;

  const renderedHeader = columnsHeader || (columns ? (
    <div
      className="flex items-center w-full min-w-0 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 py-2 border-b border-white/10 bg-slate-950"
      style={{ minWidth: effectiveMinWidth || undefined }}
    >
      {columns.map((col, idx) => (
        <div
          key={`col_th_${idx}`}
          className={`${headerCellClassName} min-w-0 truncate ${col.className || ''}`}
          style={{ width: col.width, flexShrink: 0 }}
        >
          {col.header}
        </div>
      ))}
    </div>
  ) : null);

  return (
    <div
      className={`w-full max-w-full min-w-0 ${
        disableHorizontalScroll ? 'overflow-x-hidden' : 'overflow-x-auto custom-scrollbar'
      } border border-white/5 rounded-xl bg-slate-900 ${className}`}
    >
      <div className="w-full min-w-0" style={{ minWidth: effectiveMinWidth || '100%' }}>
        {/* Sticky Table Header */}
        {renderedHeader && (
          <div className="sticky top-0 z-10 bg-slate-950 select-none">
            {renderedHeader}
          </div>
        )}

        {/* Virtualized Rows List */}
        <VirtualizedList
          items={items}
          itemHeight={rowHeight}
          height={height}
          maxHeight={maxHeight}
          minHeight={minHeight}
          getItemKey={getItemKey}
          emptyPlaceholder={emptyPlaceholder}
          renderItem={(item, index, style) => (
            <div
              onClick={() => onRowClick && onRowClick(item)}
              className={`flex items-center w-full min-w-0 overflow-hidden border-b border-white/5 hover:bg-sky-500/10 ${onRowClick ? 'cursor-pointer' : ''}`}
              style={style}
            >
              {renderRow(item, index, style)}
            </div>
          )}
        />
      </div>
    </div>
  );
}

export interface VirtualizedGridProps<T> {
  items: T[];
  columns?: number;
  itemHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  gap?: number;
  maxHeight?: number;
  minHeight?: number;
  emptyPlaceholder?: ReactNode;
  className?: string;
  getItemKey?: (item: T, index: number) => string | number;
}

/**
 * VirtualizedGrid divides items into row chunks for multi-column responsive card layouts.
 */
export function VirtualizedGrid<T>({
  items,
  columns = 2,
  itemHeight,
  renderItem,
  gap = 12,
  maxHeight = 700,
  minHeight = 200,
  emptyPlaceholder,
  className = '',
  getItemKey,
}: VirtualizedGridProps<T>): React.ReactElement {
  const rows = useMemo(() => {
    const chunked: T[][] = [];
    for (let i = 0; i < items.length; i += columns) {
      chunked.push(items.slice(i, i + columns));
    }
    return chunked;
  }, [items, columns]);

  return (
    <VirtualizedList
      items={rows}
      itemHeight={itemHeight + gap}
      maxHeight={maxHeight}
      minHeight={minHeight}
      className={className}
      emptyPlaceholder={emptyPlaceholder}
      getItemKey={(_, rowIdx) => `grid_row_${rowIdx}`}
      renderItem={(rowItems, rowIdx) => (
        <div
          className="grid gap-3 items-stretch"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            height: itemHeight,
            marginBottom: gap,
          }}
        >
          {rowItems.map((item, colIdx) => {
            const globalIndex = rowIdx * columns + colIdx;
            const key = getItemKey ? getItemKey(item, globalIndex) : `grid_cell_${globalIndex}`;
            return (
              <div key={key} className="h-full">
                {renderItem(item, globalIndex)}
              </div>
            );
          })}
        </div>
      )}
    />
  );
}
