# 规则

在「设置 → 规则」管理。由 Rust 内的 QuickJS 同步执行。默认提供的规则也是独立 JS 源码，与用户规则使用相同执行方式，不提供按 ID 调用其他规则的接口。

## 能力边界

| 宿主提供 | 用户 JS 实现 |
| --- | --- |
| 读取条目，图片解码为 RGBA 像素 | 文本清理、正则替换、文件名／路径处理及任意像素算法 |
| 图片编码、更新历史、撤销／重做、系统另存为窗口 | 决定返回内容、编码格式及替换记录或另存为 |
| `Intl.Segmenter`，支持 `grapheme`／`word`／`sentence` | 分段处理；`segment()` 返回数组，locale 不参与语言选择 |

可使用标准 JS。没有浏览器、Node.js、网络、文件系统、系统命令、剪贴板、模块加载或定时器 API；文件路径仅作为文本。入口不接受 Promise。宿主不提供 `image.resize()` 等图片算法接口。

## 输入与输出

`transform`、`context` 及以下输出字段均为 **CPaste 约定，非JS 原生 API**。

| 类型 | 入口 | 返回值 |
| --- | --- | --- |
| 文本 | `transform(text, context)` | `string` 或 `{ text, html?, rtf? }` |
| 图片 | `transform(pixels, context)` | `{ width, height, data, encoding?, saveAs? }`，或沿用输入尺寸的像素数组 |
| 文件 | `transform(files, context)` | 要复制的文本，不修改原文件 |

- `context`：文本含 `text/html/rtf`；图片含 `width/height/format`（小写原始编码格式，如 `png`、`jpeg`）；文件含 `files: Array<{ name, path }>`。默认格式转换规则另含 `converted`。
- `pixels.data`：按行排列的 RGBA，每像素 4 字节。输入为 `Uint8ClampedArray`；返回可用 `Uint8Array` 或 `Uint8ClampedArray`，长度须为 `width * height * 4`。
- `encoding: { format, quality? }`：替换原记录，支持撤销；`saveAs: { format, quality? }`：另存为，不改历史。两者互斥，均省略时以 PNG 替换记录。`format` 取当前构建支持的编码格式；`quality` 仅用于 JPEG，范围 1–100，默认 80，透明区域合成为白底。

文本示例：

```js
function transform(text) {
  return text.trim();
}
```

图片示例：

```js
function transform(pixels) {
  return { ...pixels, encoding: { format: "jpeg", quality: 80 } };
  // 将 encoding 改成 saveAs，即由用户选择保存路径。
}
```

输入为独立快照，规则成功后一次性提交；异常不提交中间结果。额外返回字段不产生宿主能力。

## 试运行与限制

图片、文件使用 JSON 测试：图片为 `{ width, height, data? }`，省略 `data` 时生成空白像素；文件为 `{ files: [{ name, path }] }`。试运行不修改历史、剪贴板或文件，也不打开保存窗口。

| 项目 | 限制 |
| --- | --- |
| JS 内存／执行时间 | 文本、文件：32 MB／1.5 秒；图片：128 MB／5–30 秒，按像素数量调整 |
| 图片尺寸 | 单边 ≤16384，总像素 ≤6400 万 |
| 规则源码 | ≤128 KB |
| 文本返回值 | 非空；text ≤1 MB，html／rtf 各 ≤4 MB |

规则存于 `app_settings.js_rules`，随备份恢复。生成默认源码：`pnpm generate:js-rules`；验证：`pnpm test:js-rules`。

## 管理与备份

「设置 → 规则」的总开关默认开启；关闭后隐藏面板规则入口并停用规则快捷键，保留已配置的规则。备份导出全部规则及各自的启用状态为 JSON。恢复前校验文件，确认后覆盖现有规则，不改剪贴板记录，也不执行导入的规则。
