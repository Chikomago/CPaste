# 代码结构

## 前端

`src/main.tsx` 只负责根据窗口参数挂载页面，并加载全局样式。

| 位置 | 职责 |
| --- | --- |
| `src/windows/` | `Picker` 管理选择面板交互；`SettingsWindow` 管理设置；`PreviewWindow` 管理独立预览窗口 |
| `src/components/` | 来源应用图标、图片缩略图、内容预览，以及设置中的选择框、数字输入框和开关 |
| `src/lib/` | Tauri 调用、快捷键、主题、条目摘要与格式化函数 |
| `src/types.ts` | 前后端传输类型与窗口事件类型 |
| `src/preferences.ts`、`src/i18n.ts` | 偏好默认值、快捷键配置和界面翻译 |

窗口持有自己的 React 状态。共享组件通过参数接收数据；工具模块不导入窗口组件。Tauri 命令统一通过 `src/lib/api.ts` 调用。

## Rust 后端

`src-tauri/src/lib.rs` 负责启动、托盘事件、原生面板初始化和 Tauri 命令注册。

| 位置 | 职责 |
| --- | --- |
| `models.rs`、`state.rs` | 数据结构、共享状态访问、时间与错误转换 |
| `database.rs`、`backup.rs` | 数据库初始化、迁移、清理、容量统计及备份恢复 |
| `capture.rs`、`clipboard.rs`、`clips.rs` | 剪贴板采集，记录编辑与复制粘贴，记录查询及图片和图标读取 |
| `windows.rs`、`menus.rs`、`applications.rs` | 窗口显示和定位、预览窗口、原生菜单及本机应用发现 |
| `preferences.rs`、`shortcuts.rs`、`permissions.rs`、`privacy.rs` | 偏好应用与校验、快捷键、系统权限和敏感内容识别 |

后端模块显式导入依赖。macOS 和 Windows 专用实现保留平台条件编译。命令名、命令参数、事件名和数据库格式是兼容边界，移动代码时应保持这些接口稳定。

## 验证

```sh
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

现有 Rust 回归测试集中在 `src-tauri/src/tests.rs`。Windows 原生行为仍需在 Windows 环境验证。
