fn main() {
    let mut attributes = tauri_build::Attributes::new();

    // tauri-build only embeds its default app manifest into binary targets. Unit test
    // executables built from the lib target therefore load comctl32 v5 and fail at
    // startup with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139). Embed the same manifest
    // into every link target instead, including lib unit tests.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
