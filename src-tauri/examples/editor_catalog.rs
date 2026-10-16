//! Regenerate the pinned runtime feature inventory without starting the UI.
fn main() {
    let commands: Vec<_> = filmcraft_engine::command_specs()
        .iter()
        .map(|c| {
            serde_json::json!({
                "id":c.id,"label":c.label,"menu":c.menu,"params":c.params,"shortcut":c.shortcut
            })
        })
        .collect();
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "revision":"8309f21a6c3f34ddf190af7fd9bfd913053a1fd5",
            "commands": commands, "effects":filmcraft_project::effect_defs()
        }))
        .unwrap()
    );
}
