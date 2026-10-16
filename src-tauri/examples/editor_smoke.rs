//! Generates synthetic media and a project for native UI smoke testing.
//! Run: cargo run --manifest-path src-tauri/Cargo.toml --example editor_smoke
use filmcraft_engine::{FsServices, Session};
use serde_json::json;
use std::sync::Arc;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    filmcraft_platform::register();
    let root = std::env::temp_dir().join("asmr-editor-smoke");
    std::fs::create_dir_all(&root)?;
    let mut s = Session::new(Arc::new(FsServices));
    s.execute(
        "file.newSequence",
        json!({"name":"Editor Smoke Test","width":640,"height":360,"fps":30,"video":2,"audio":2}),
    )?;
    s.execute(
        "file.newColorMatte",
        json!({"name":"Blue test card","color":"#336699","seconds":3}),
    )?;
    let item = s.state.project_selection[0];
    s.execute(
        "timeline.place",
        json!({"item":item.0,"track":"V1","frame":0}),
    )?;
    s.execute(
        "graphics.newText",
        json!({"text":"ASMR Editor","newClip":true,"seconds":3,"size":48,"position":[320,180]}),
    )?;
    s.execute(
        "captions.add",
        json!({"text":"Synthetic editing smoke test","seconds":0.25,"durationSeconds":2}),
    )?;
    s.execute("markers.add", json!({"name":"Check frame","frame":30}))?;
    let file = root.join("smoke.fcproj");
    s.execute("file.saveAs", json!({"path":file}))?;
    s.sync_persistence();
    let output = root.join("smoke.mp4");
    let report=s.execute("file.exportMedia",json!({"path":output,"format":"h264","range":"entire","width":640,"height":360,"burnCaptions":true,"wait":true}))?;
    println!("Export: {}", report);
    assert!(std::fs::metadata(&output)?.len() > 1024);
    let mut loaded = Session::new(Arc::new(FsServices));
    loaded.execute("file.open", json!({"path":file}))?;
    assert_eq!(
        loaded.active_sequence().unwrap().caption_tracks[0]
            .captions
            .len(),
        1
    );
    let imported = loaded.execute("file.import", json!({"paths":[output]}))?;
    let source = imported["items"][0].as_u64().ok_or("Import failed")?;
    loaded.execute("source.open", json!({"item":source}))?;
    loaded.execute("markers.markIn", json!({"target":"source","frame":15}))?;
    loaded.execute("markers.markOut", json!({"target":"source","frame":44}))?;
    let view =
        filmcraft_engine::clip_ops::source_view(&loaded, filmcraft_engine::project::ItemId(source))
            .unwrap();
    assert_eq!(view.rate.frame_at(view.selected_range().duration), 30);
    println!(
        "Project: {}\nMedia: {}\nFormats: {}",
        file.display(),
        output.display(),
        loaded.execute("export.formats", json!({}))?
    );
    loaded.shutdown();
    s.shutdown();
    Ok(())
}
