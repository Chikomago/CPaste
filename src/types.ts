

export type Kind = 'text' | 'rich' | 'image' | 'files';
export type Clip = { id: number; kind: Kind; title: string; plain_text: string; files: string[]; source_app: string; source_path: string; created_at: string; updated_at: string; use_count: number; pinned: boolean; favorite: boolean; sensitive_masked: boolean };
export type ClipSort = 'created' | 'used' | 'modified';
export type TriggerEdge = 'none' | 'left' | 'right' | 'top' | 'bottom';
export type PickerOpening = { edge: TriggerEdge; width: number; height: number };
export type PreviewPlacement = { id: number; edge: TriggerEdge; anchor_x: number; anchor_y: number };
export type ActionShortcut = 'paste' | 'paste_plain' | 'paste_original' | 'copy' | 'copy_plain' | 'copy_original' | 'preview' | 'segment' | 'edit' | 'favorite' | 'pin' | 'delete';
export type Preferences = { retention_days: number; max_items: number; max_storage_mb: number; capture_text: boolean; capture_rich: boolean; capture_image: boolean; capture_files: boolean; default_plain_paste: boolean; default_file_paths: boolean; close_after_paste: boolean; return_to_top_after_paste: boolean; default_filter: 'all' | 'favorite'; default_plain_copy: boolean; default_copy_file_paths: boolean; paste_on_single_click: boolean; launch_at_login: boolean; show_tray_icon: boolean; show_dock_icon: boolean; popup_position: 'center' | 'cursor' | Exclude<TriggerEdge, 'none'>; side_columns: 1 | 2; edge_card_size: number; hover_preview: boolean; show_source_app_icon: boolean; auto_check_updates: boolean; item_max_lines: number; segment_builtin_dictionary: boolean; segment_custom_dictionary: boolean; segment_custom_words: string; theme: 'system' | 'light' | 'dark'; language: 'zh-CN' | 'en-US'; accent_color: string; shortcut: string; action_shortcuts: Record<ActionShortcut, string>; excluded_apps: string[]; sensitive_action: 'save' | 'skip' | 'mask' };
export type InstalledApp = { name: string; path: string };
export type Filter = Kind | 'all' | 'code' | 'favorite';
export type PreviewClip = Pick<Clip, 'id' | 'kind' | 'plain_text' | 'files' | 'source_app' | 'created_at' | 'sensitive_masked'> & { file_sizes: (number | null)[] };
