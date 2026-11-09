# 发布与在线更新

项目地址：https://github.com/Chikomago/CPaste

## 发布版本

1. 同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本，并更新 Cargo 锁文件。
2. 更新 `docs/release-notes.md`，运行 `pnpm build`、`pnpm test:segmentation` 和 `cargo test --manifest-path src-tauri/Cargo.toml --locked`。
3. 推送版本标签，例如 `git tag v0.1.0`、`git push origin v0.1.0`。

Release 工作流会构建 macOS Apple Silicon、macOS Intel 和 Windows x64。各架构安装包先上传到草稿，全部构建成功且更新包与签名齐全后，才生成包含三个平台的 `latest.json` 并公开 Release。失败时保留草稿，不发布缺失架构的更新清单。

可在 Actions 中手动运行 Release，填入已有标签，重试未完成的草稿发布。日常更新应升级版本号。

如需保持版本号并替换现有安装包，可手动运行 Rebuild existing release，填写已发布标签和源码分支。三个架构先独立构建，全部成功后才替换附件并更新清单；替换前会将旧附件备份到 Actions Artifact，保留 30 天。替换期间 Release 会短暂隐藏，失败时恢复旧附件。原标签保持不变，Release 会附上本次构建的源码压缩包和提交链接。同版本不会触发自动升级，已安装用户需要手动下载。

## 更新签名

- 仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`：Tauri 更新签名私钥。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：仅在私钥有密码时填写。
- `src-tauri/tauri.conf.json` 中只保存公钥，用于安装前校验更新包。
- 本机私钥位于 `.private/updater.key`，已被 Git 忽略。应自行备份到安全位置，不能提交或公开。丢失私钥会使已安装版本无法信任后续新密钥签名的更新。

Tauri 更新签名与操作系统代码签名不同。当前 macOS 使用临时签名，没有 Apple 公证；Windows 没有商业代码签名证书。

## 应用行为

正式版启动 15 秒后检查更新，此后每 6 小时检查。用户可在“设置 → 关于”关闭自动检查、手动检查、下载并安装。macOS 安装后可点击“重启应用”；Windows 安装器可能先退出应用以完成替换。失败时显示具体错误，并可重试或手动下载。

开发版不会自动检查或安装更新，但可手动检查更新状态。完整升级验收需使用已安装的较旧正式版，升级到一个更高版本；首个公开版本无法完成这一跨版本测试。
