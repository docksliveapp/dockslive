import React, { useRef, useState, useEffect, useLayoutEffect, CSSProperties, ReactNode, useMemo, useCallback } from 'react';

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
 * Ultra high-performance VirtualizedList
 * Renders only visible items in the viewport with overscan buffers.
 * Prevents main thread blocking and memory bloat on mobile and desktop.
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
  overscanCount = 4,
  getItemKey,
  onScroll,
  header,
  footer,
}: VirtualizedListProps<T>): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState<number>(() => {
    if (height && height > 0) return height;
    return typeof window !== 'undefined' ? Math.min(window.innerHeight * 0.65, maxHeight) : 400;
  });

  const lastScrollTop = useRef(0);

  // Measure container height dynamically
  useLayoutEffect(() => {
    if (height && height > 0) {
      setMeasuredHeight(height);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      const rect = container.getBoundingClientRect();
      const available = rect.height > 0 ? rect.height : (container.parentElement?.clientHeight || 450);
      const calculated = Math.min(Math.max(available, minHeight), maxHeight);
      setMeasuredHeight(calculated);
    };

    updateHeight();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateHeight();
      });
      resizeObserver.observe(container);
      if (container.parentElement) {
        resizeObserver.observe(container.parentElement);
      }
    }

    window.addEventListener('resize', updateHeight);
    return () => {
      window.removeEventListener('resize', updateHeight);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [height, maxHeight, minHeight]);

  const totalCount = items.length;
  const totalContentHeight = totalCount * itemHeight;

  // Handle scroll events with smooth passive tracking
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const newScrollTop = e.currentTarget.scrollTop;
      const direction = newScrollTop > lastScrollTop.current ? 'forward' : 'backward';
      lastScrollTop.current = newScrollTop;
      setScrollTop(newScrollTop);

      if (onScroll) {
        onScroll({
          scrollOffset: newScrollTop,
          scrollDirection: direction,
        });
      }
    },
    [onScroll]
  );

  // Calculate visible range based on scrollTop and measured viewport
  const { startIndex, endIndex, offsetY } = useMemo(() => {
    if (totalCount === 0) {
      return { startIndex: 0, endIndex: 0, offsetY: 0 };
    }
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscanCount);
    const visibleCount = Math.ceil(measuredHeight / itemHeight);
    const end = Math.min(totalCount - 1, start + visibleCount + overscanCount * 2);
    const offset = start * itemHeight;
    return { startIndex: start, endIndex: end, offsetY: offset };
  }, [scrollTop, itemHeight, measuredHeight, overscanCount, totalCount]);

  if (totalCount === 0) {
    return (
      <div 
        ref={containerRef}
        className={`w-full overflow-hidden flex flex-col justify-center items-center ${className}`}
        style={{ minHeight, maxHeight, width }}
      >
        {emptyPlaceholder || (
          <div className="p-8 text-center text-gray-400 font-medium text-sm">
            No records to display
          </div>
        )}
      </div>
    );
  }

  // Slice visible items
  const visibleItems = items.slice(startIndex, endIndex + 1);

  // Determine container style
  const containerStyle: CSSProperties = {
    height: height ? height : Math.min(measuredHeight, Math.max(totalContentHeight, minHeight)),
    maxHeight,
    minHeight: Math.min(minHeight, totalContentHeight),
    width,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
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

      {/* Sizer spacer div maintaining native scrollbar thumb physics */}
      <div
        style={{
          height: totalContentHeight,
          width: '100%',
          position: 'relative',
          pointerEvents: 'none',
        }}
      >
        {/* Render container translated to visible offset */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${offsetY}px)`,
            willChange: 'transform',
            pointerEvents: 'auto',
          }}
        >
          {visibleItems.map((item, localIdx) => {
            const index = startIndex + localIdx;
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
 * VirtualizedTable provides smooth scrolling for dense desktop tables
 * with sticky columns header and lag-free row rendering.
 */
export function VirtualizedTable<T>({
  items,
  rowHeight,
  renderRow,
  columns,
  columnsHeader,
  height,
  maxHeight = 650,
  minHeight = 200,
  minTableWidth,
  emptyPlaceholder,
  className = '',
  getItemKey,
  onRowClick,
}: VirtualizedTableProps<T>): React.ReactElement {
  const renderedHeader = columnsHeader || (columns ? (
    <div 
      className="flex items-center text-xs font-bold uppercase tracking-wider text-gray-400 py-3 border-b border-white/10 bg-slate-950/90"
      style={{ minWidth: minTableWidth || undefined }}
    >
      {columns.map((col, idx) => (
        <div 
          key={`col_th_${idx}`} 
          className={`px-4 truncate ${col.className || ''}`}
          style={{ width: col.width, flexShrink: 0 }}
        >
          {col.header}
        </div>
      ))}
    </div>
  ) : null);

  return (
    <div className={`w-full overflow-x-auto custom-scrollbar border border-white/5 rounded-2xl bg-slate-900/60 backdrop-blur-md ${className}`}>
      <div style={{ minWidth: minTableWidth || '100%' }}>
        {/* Sticky Table Header */}
        {renderedHeader && (
          <div className="sticky top-0 z-10 bg-slate-950/95 border-b border-white/10 select-none">
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
              className={`flex items-center border-b border-white/5 hover:bg-white/5 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
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
  // Chunk items into rows
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
            marginBottom: gap
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
