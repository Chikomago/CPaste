# 项目介绍

<p align="center"><img src="assets/branding/logo.svg" width="96" alt="CPaste" /></p>

Windows 和 macOS 本机剪贴板记录应用。使用 Tauri 2、React、Rust 和 SQLite。

本项目使用 Codex 进行代码开发，本人负责提出需求，并提供产品、交互与技术方案的决策。

支持剪贴板分词和编辑，支持设置使用上下左右侧边栏和常规跟随光标视图。


下载安装包：[GitHub Releases](https://github.com/Chikomago/CPaste/releases/latest)。macOS 支持 Apple Silicon 和 Intel，Windows 支持 x64。

## 功能

- 保存文本、富文本、图片和文件记录，支持搜索、排序、编辑、置顶和收藏。
- 使用快捷键呼出面板，支持居中、跟随光标及上下左右四侧布局；底部左侧显示历史总条数。
- 支持纯文本、文件路径粘贴，来源应用黑名单、敏感内容遮盖，以及备份与恢复。
- “设置 → 关于”提供作者、项目地址、协议与更新检查，支持下载并安装签名验证的更新包。

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


## 协议

 [GPL-3.0-only](LICENSE)
