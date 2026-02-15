fn main() {
    // Add rpath for Swift libraries on macOS
    // This is needed because screencapturekit uses Swift bindings
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    
    tauri_build::build()
}
