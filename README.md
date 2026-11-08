# 项目介绍

<p align="center"><img src="assets/branding/logo.svg" width="96" alt="CPaste" /></p>

Windows 和 macOS 本机剪贴板记录应用。使用 Tauri 2、React、Rust 和 SQLite。

本项目使用 Codex 进行代码开发，本人负责提出需求，并提供产品、交互与技术方案的决策。

支持剪贴板分词和编辑，支持设置使用上下左右侧边栏和常规跟随光标视图。


## 分词

支持 **UTF-8 编码的 `.txt` 和 `.dict` 文本文件**，可使用每行一个词或 jieba 格式：

```text
自定义词语 100 nz
```

## 开发

分词引擎使用 [jieba-rs](https://github.com/messense/jieba-rs)。

需要 Node.js 20+、pnpm、Rust 1.90+，以及 [Tauri 对应平台的构建依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
pnpm install
pnpm tauri dev
```

构建安装包：`pnpm tauri build`。首次构建需要下载 Rust 依赖。

代码目录与模块职责见 [代码结构](docs/architecture.md)。

## 权限

macOS 首次直接粘贴可能需要在“系统设置 → 隐私与安全性 → 辅助功能”中允许 CPaste 控制键盘；

## 感谢

CPaste 的界面与交互设计参考了 [EcoPaste](https://github.com/EcoPasteHub/EcoPaste)，感谢 EcoPaste 项目提供的设计启发。


## 下载与更新

在 [GitHub Releases](https://github.com/Chikomago/CPaste/releases) 下载安装包。macOS 提供 Apple Silicon 和 Intel 版本，Windows 提供 x64 版本。

“设置 → 关于”提供版本、作者、项目地址、协议和在线更新。默认在启动后及每 6 小时检查更新，由用户确认下载和安装；更新包必须通过签名校验。开发版不自动检查或安装更新。

## 协议

Copyright © 2026 chikomago。项目采用 [GPL-3.0-only](LICENSE)，仅限 GPL 第 3 版。

发布流程与更新密钥管理见 [发布说明](docs/releasing.md)。
