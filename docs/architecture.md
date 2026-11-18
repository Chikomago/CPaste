# 代码结构

## 前端

React 页面运行于系统 WebView，入口 `src/main.tsx` 按窗口参数挂载页面。

| 位置 | 职责 |
| --- | --- |
| `src/windows/Picker.tsx` | 主面板、搜索筛选、键盘交互、条目操作及连接侧栏 |
| `src/windows/SettingsWindow.tsx` | 设置分类、偏好保存、权限、备份与诊断模式 |
| `src/windows/PreviewWindow.tsx`、`RuleMenuWindow.tsx` | 独立内容预览和规则列表窗口 |
| `src/components/VirtualClipList.tsx`、`ClipMedia.tsx` | 虚拟列表、图片缩略图、来源应用图标 |
| `src/components/ClipDetails.tsx`、`ClipEditor.tsx`、`TokenDialog.tsx` | 侧栏详情、文本编辑、分词与组词 |
| `src/components/RuleManager.tsx`、`CustomRuleEditor.tsx`、`RuleEditorSplit.tsx` | 规则管理、JS 编辑与左右测试预览、可调整区域高度 |
| `src/components/QuickActionsPanel.tsx`、`QuickTextTools.tsx`、`MediaQuickTools.tsx` | 文本、图片和文件规则入口、执行与撤销重做 |
| `src/components/StorageUsage.tsx`、`SettingsControls.tsx`、`ConfirmDialog.tsx` | 占用明细、统一设置控件、覆盖整个窗口的确认弹窗 |
| `src/lib/api.ts`、`theme.ts`、`shortcuts.ts` | 后端调用、诊断耗时、主题和动画、快捷键解析 |
| `src/lib/clip-content.ts`、`clip-flags.ts`、`clip-images.ts`、`media-cache.ts` | 局部条目更新、乐观状态、图片缓存与请求并发控制 |
| `src/lib/js-rules.ts`、`image-rules.ts`、`use-script-rules.ts` | 可编辑默认规则、旧默认规则升级、规则事件同步 |
| `src/lib/text-tools.ts`、`format-conversions.ts`、`line-numbers.ts` | 默认文字算法及 Markdown／富文本转换 |
| `src/lib/window-activity.ts` | 轻量模式：隐藏后暂停界面刷新，呼出时合并更新 |
| `src/types.ts`、`preferences.ts`、`i18n.ts` | 前后端类型、默认设置、快捷键与中英翻译 |

窗口持有 React 状态，组件通过参数接收数据。后端事件优先更新单个条目，避免规则处理、收藏、置顶或复制后重建整个列表。

## Rust 后端

`src-tauri/src/lib.rs` 负责应用启动、原生面板初始化、托盘、快捷键及 Tauri 命令注册。

| 位置 | 职责 |
| --- | --- |
| `models.rs`、`state.rs`、`preferences.rs` | 数据结构、共享状态、偏好默认值与校验、应用偏好变化 |
| `background.rs` | 有界后台任务池、串行数据库写入 |
| `capture.rs`、`clipboard.rs`、`clips.rs` | 采集、复制粘贴、编辑删除、记录查询与媒体路径读取 |
| `database.rs`、`backup.rs` | SQLite 初始化与迁移、自动清理、可携带单文件备份恢复 |
| `resources.rs`、`storage.rs` | 哈希资源文件、按需缩略图、应用图标、资源回收与分类占用清理 |
| `js_runtime.rs`、`js_rules.rs` | Rust 内嵌 QuickJS、执行预算、规则校验与持久化、规则 JSON 备份恢复 |
| `content_tools.rs`、`image_scripts.rs`、`media_tools.rs` | 文本规则、像素输入输出、编码与另存为、原子更新和撤销重做 |
| `fingerprint.rs` | 内容指纹，保持采集去重与规则更新一致 |
| `segmentation.rs` | 分词、用户词典和可下载内置词典 |
| `windows.rs`、`menus.rs`、`applications.rs` | 窗口显示、定位和焦点、规则与右键菜单、本机应用列表 |
| `shortcuts.rs`、`permissions.rs`、`privacy.rs` | 快捷键、系统权限、敏感内容识别和遮盖 |
| `diagnostics.rs` | 可选本机诊断日志、设备系统信息、后台轮转与导出 |
| `updates.rs` | 检查、下载、验签和安装更新 |

macOS／Windows 代码通过条件编译隔离；命令参数、事件和数据库格式是兼容边界。

## 存储与后台执行

SQLite 保存文本、富文本、文件路径、资源引用和设置。原图、缩略图、应用图标存放于独立资源目录，通过系统资源协议显示，避免 Base64 图像在窗口间重复传输。原图按内容哈希去重，清理时保留仍被引用的文件。可携带备份将原图合入单文件，恢复时先校验再替换。详见[存储说明](storage.md)。

数据库和磁盘工作通过 `background.rs` 执行，最多同时 4 项；设置及记录写入串行。剪贴板传输和图片处理另有限流，避免慢任务占满通道。窗口、系统权限及 macOS 原生按键发送保留在界面线程；文件选择使用异步系统对话框。

规则由 Rust 内的 QuickJS 执行，输入是独立快照，成功后提交。默认规则与用户规则使用相同入口。详见[规则接口](js-rules.md)和[诊断日志](developer-mode.md)。

## 生成文件与验证

`scripts/generate-js-rules.mjs` 从默认 JS 算法生成 `src/lib/builtin-scripts.generated.ts` 及 Rust 测试所需的 JSON，不应直接修改生成文件。

```sh
pnpm build
pnpm test:tools
pnpm test:scroll
pnpm test:js-rules
pnpm test:segmentation
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo fmt --manifest-path src-tauri/Cargo.toml --check
python3 scripts/test-release.py
python3 scripts/check-release.py v1.0.0
```

组件交互回归位于 `scripts/test-content-tools.tsx`、`test-scroll-performance.tsx`；Rust 测试位于 `src-tauri/src/tests.rs` 及各模块。`experiments/macos-native-baseline` 为只读性能对照实验，不参与发布构建。

`.github/workflows/build.yml` 检查 macOS 和 Windows；推送 `v*` 标签后，`release.yml` 构建 Apple Silicon、Intel macOS 及 Windows 安装包，签署在线更新包，验证更新清单后发布 Release。
