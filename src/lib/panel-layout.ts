import type { PanelLayout } from '../types';

/** Keep these dimensions aligned with Preferences::picker_size in Rust. */
export function panelSize(layout: PanelLayout, details: boolean) {
  if (layout === 'horizontal') return { width: 800, height: details ? 660 : 318 };
  return { width: details ? layout === 'sidebar' ? 728 : 800 : layout === 'sidebar' ? 378 : 342, height: 660 };
}
