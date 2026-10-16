import { CommandInput } from "./command-input";
import { useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useEditor } from "@/contexts/editor-state";
import { commandFields, fieldLabel, fieldValue } from "@/lib/editor-fields";
import type { Command, Params } from "@/types/editor";

export function CommandsPanel({ category }: { category?: string }) {
  const { snapshot } = useEditor();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Command | null>(null);
  const commands = (snapshot?.commands ?? []).filter(
    (c) =>
      !/(\.inspect|\.list|\.get|\.read|\.tick|\.poll|\.status)$/i.test(c.id) &&
      (category
        ? category === "proxies"
          ? /^media\.(createProxies|attachProxies|detachProxies|reconnectFullRes|toggleProxies)$/.test(
              c.id,
            )
          : c.id.startsWith(category === "narration" ? "tts" : category)
        : true) &&
      `${c.label} ${c.menu.join(" ")} ${c.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const groups = Array.from(
    new Set(
      commands.map((c) => c.menu.join(" / ") || fieldLabel(c.id.split(".")[0])),
    ),
  );
  return (
    <div className="editor-panel-body">
      <label className="editor-search">
        <Search className="h-3.5 w-3.5" />
        <input
          aria-label="Search editing actions"
          placeholder="Find an action…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {groups.map((g) => (
        <details key={g} open={!!search || !!category}>
          <summary className="editor-section-title">{g}</summary>
          {commands
            .filter(
              (c) =>
                (c.menu.join(" / ") || fieldLabel(c.id.split(".")[0])) === g,
            )
            .map((c) => (
              <button
                className="editor-list-row justify-between"
                key={c.id}
                disabled={!c.enabled}
                title={c.reason ?? c.label}
                onClick={() => setActive(c)}
              >
                <span>{c.label}</span>
                <small className="text-tertiary-foreground">
                  {c.shortcut?.replaceAll("Cmd", "⌘").replaceAll("Alt", "⌥")}
                </small>
              </button>
            ))}
        </details>
      ))}
      {active && (
        <CommandDialog command={active} onClose={() => setActive(null)} />
      )}
    </div>
  );
}

export function CommandDialog({
  command,
  onClose,
}: {
  command: Command;
  onClose: () => void;
}) {
  const { snapshot, execute, busy, saveProject } = useEditor();
  const replacesProject =
    /^file\.(newProject|newProjectFromTemplate|open|revert|close|closeProject|closeAllProjects)$/.test(
      command.id,
    );
  const [saveBeforeReplace, setSaveBeforeReplace] = useState(true);
  const fields = useMemo(() => commandFields(command.params), [command.params]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        f.defaultValue ??
          (f.name === "clips"
            ? (snapshot?.state.selection ?? []).join(",")
            : f.name === "clip"
              ? (snapshot?.state.selection[0] ?? "")
              : f.name === "items"
                ? (snapshot?.state.project_selection ?? []).join(",")
                : f.name === "item"
                  ? (snapshot?.state.project_selection[0] ?? "")
                  : ""),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    try {
      const params: Params = {};
      for (const f of fields) {
        const text = values[f.name] ?? "";
        if (text === "") continue;
        params[f.name] = fieldValue(f, text);
      }
      if (
        replacesProject &&
        snapshot?.dirty &&
        saveBeforeReplace &&
        !(await saveProject())
      )
        return;
      await execute(command.id, params);
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{command.label}</DialogTitle>
          <DialogDescription>
            {command.menu.join(" › ") || "Edit the current selection"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="overflow-y-auto min-h-0 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          id="editor-command"
        >
          {replacesProject && snapshot?.dirty && (
            <label className="flex gap-2 items-center text-callout">
              <input
                type="checkbox"
                checked={saveBeforeReplace}
                onChange={(e) => setSaveBeforeReplace(e.target.checked)}
              />
              Save current project before replacing it
            </label>
          )}
          {fields.length === 0 && (
            <p>
              Apply {command.label.replace("…", "").toLowerCase()} to the
              current project?
            </p>
          )}
          {fields.map((f) => (
            <label key={f.name} className="block text-callout">
              <span className="block mb-1">
                {fieldLabel(f.name)}
                {f.optional && (
                  <span className="text-tertiary-foreground"> · optional</span>
                )}
              </span>
              <div className="flex gap-2">
                <CommandInput
                  field={f}
                  value={values[f.name] ?? ""}
                  onChange={(v) => setValues({ ...values, [f.name]: v })}
                />
                {/path|file/i.test(f.name) && (
                  <Button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const exporting =
                          /export|save|collect|consolidate/i.test(command.id);
                        const path = exporting
                          ? await save({ title: command.label })
                          : await open({
                              multiple: f.type.startsWith("["),
                              title: command.label,
                            });
                        if (path)
                          setValues((v) => ({
                            ...v,
                            [f.name]: Array.isArray(path)
                              ? path.join("\n")
                              : path,
                          }));
                      })().catch((e) => setError(String(e)));
                    }}
                  >
                    Choose…
                  </Button>
                )}
              </div>
            </label>
          ))}
          {error && (
            <p role="alert" className="text-destructive text-callout">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="editor-command"
            variant="accent"
            disabled={busy}
          >
            {busy ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
