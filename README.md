# 项目介绍

<p align="center"><img src="assets/branding/logo.svg" width="96" alt="CPaste" /></p>

一款本机剪贴板记录应用，剪贴板在日常工作中是非常高频的应用。因此使用CPaste后，你除了可以使用常规剪贴板的基础功能，还可以通过分词或规则引擎来进一步编辑剪贴板内容，实现即时的内容处理和输出。

完全本地无任何联网权限。


[下载安装包](https://github.com/Chikomago/CPaste/releases/latest)

## 功能

- 基础：保存文本、富文本、图片和文件记录，支持搜索、排序、编辑、置顶和收藏。
- 侧栏：使用快捷键呼出面板，支持居中、跟随光标。
- 设置：支持纯文本、文件路径粘贴，来源应用黑名单、敏感内容遮盖，以及备份与恢复。
- 分词：支持 **UTF-8 编码的 `.txt` 和 `.dict` 文本文件**，可使用每行一个词或 jieba 格式：
- 规则：Rust层内嵌 QuickJS 处理脚本，你也可以自行编写js来达成你想要的规则。


## 开发
```功能功能功能


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


## 协议

 [GPL-3.0-only](LICENSE)
