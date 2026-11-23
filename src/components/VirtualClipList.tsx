import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer, observeElementRect, observeElementOffset, measureElement } from '@tanstack/react-virtual';
import type { Clip, TriggerEdge } from '../types';

// Hiding a native window can temporarily report a zero-sized viewport. Keep the
// last visible range and decoded image nodes rather than treating it as empty.
const observeVisibleRect: typeof observeElementRect = (instance, notify) => observeElementRect(instance, rect => {
  if (rect.width > 0 && rect.height > 0) notify(rect);
});
const observeVisibleOffset: typeof observeElementOffset = (instance, notify) => observeElementOffset(instance, (offset, scrolling) => {
  if (instance.scrollElement && instance.scrollElement.clientWidth > 0 && instance.scrollElement.clientHeight > 0) notify(offset, scrolling);
});
const rowSizes = new WeakMap<Element, number>();
const measureVisibleElement: typeof measureElement = (element, entry, instance) => {
  const value = measureElement(element, entry, instance);
  if (value > 0) rowSizes.set(element, value);
  return value > 0 ? value : rowSizes.get(element) ?? 74;
};

type Props = {
  clips: Clip[];
  className: string;
  edge: TriggerEdge;
  horizontal?: boolean;
  cardWidth?: number;
  columns: number;
  selectedId: number | null;
  resetKey: string;
  maxLines: number;
  style?: React.CSSProperties;
  label?: string;
  children?: ReactNode;
  onVisibleIds?: (ids: number[]) => void;
  renderRow: (clip: Clip) => ReactNode;
};

/** Each virtual item is one row of cards, so two-column layouts stay aligned. */
export function VirtualClipList({ clips, className, edge, columns, selectedId, resetKey, maxLines, style, label, children, renderRow, onVisibleIds, horizontal: horizontalLayout, cardWidth }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scrolledSelection=useRef<number|null>(null);
  const [rect, setRect] = useState({ width: 350, height: 0 });
  const horizontal = horizontalLayout ?? (edge === 'top' || edge === 'bottom');
  const side = edge === 'left' || edge === 'right';
  const lanes = side ? columns : 1;
  const cardSize = horizontal ? cardWidth ?? Math.max(1, rect.height - 14) : Math.max(1, (rect.width - 14 - (lanes - 1) * 7) / lanes);
  const virtual = useVirtualizer({
    count: Math.ceil(clips.length / lanes),
    getScrollElement: () => host.current,
    observeElementRect: observeVisibleRect,
    observeElementOffset: observeVisibleOffset,
    measureElement: measureVisibleElement,
    getItemKey: index => clips[index * lanes].id,
    horizontal,
    estimateSize: index => horizontal || side ? cardSize : clips[index].kind === 'image' ? 150 : Math.max(62, maxLines * 16 + 50),
    gap: 7,
    overscan: 3,
    useFlushSync: false,
    useAnimationFrameWithResizeObserver: true,
  });
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const update = () => {
      if (!node.clientWidth || !node.clientHeight) return;
      setRect(current => current.width === node.clientWidth && current.height === node.clientHeight ? current : { width: node.clientWidth, height: node.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Normal rows observe their own wrapping/height changes. A viewport width
  // notification must not discard every measured height and fall back to estimates.
  const fixedCardSize = horizontal || side ? cardSize : 0;
  useLayoutEffect(() => { virtual.measure(); }, [virtual, fixedCardSize, maxLines, horizontal, lanes]);
  useLayoutEffect(() => { virtual.scrollToOffset(0); }, [virtual, resetKey]);
  useLayoutEffect(() => {
    if (selectedId === null) {scrolledSelection.current=null;return;}
    if(scrolledSelection.current===selectedId)return;
    const index = clips.findIndex(clip => clip.id === selectedId);
    if (index !== -1) {scrolledSelection.current=selectedId;virtual.scrollToIndex(Math.floor(index / lanes), { align: 'auto' });}
  }, [virtual, selectedId, clips, lanes]);
  const items = virtual.getVirtualItems();
  useLayoutEffect(() => {
    const offset = virtual.scrollOffset ?? 0;
    const size = horizontal ? virtual.scrollRect?.width : virtual.scrollRect?.height;
    if (!size) return;
    onVisibleIds?.(items.filter(item => item.end > offset && item.start < offset + size)
      .flatMap(item => clips.slice(item.index * lanes, (item.index + 1) * lanes).map(clip => clip.id)));
  }, [items, virtual.scrollOffset, virtual.scrollRect, horizontal, clips, lanes, onVisibleIds]);
  return <div ref={host} className={`${className} virtual-clip-list`} aria-label={label} style={style}>
    {clips.length > 0 && <div className="virtual-list-content" style={horizontal ? { width: virtual.getTotalSize(), height: '100%' } : { height: virtual.getTotalSize(), width: '100%' }}>
      {virtual.getVirtualItems().map(item => <div key={item.key} data-index={item.index} ref={horizontal || side ? undefined : virtual.measureElement} className="virtual-clip-slot" style={horizontal
        ? { width: cardSize, height: '100%', transform: `translateX(${item.start}px)` }
        : { width: '100%', height: side ? cardSize : undefined, gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`, transform: `translateY(${item.start}px)` }}>
        {clips.slice(item.index * lanes, (item.index + 1) * lanes).map(renderRow)}
      </div>)}
    </div>}
    {children}
  </div>;
}
