import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { EditorContext } from "./editor-state";
import { toast } from "@/hooks/use-toast";
import type { EditorSnapshot, EffectDefinition, Params } from "@/types/editor";

export function EditorProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(null);
  const [effects, setEffects] = useState<EffectDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const snapshotRef = useRef(snapshot);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const update = useCallback((value: EditorSnapshot) => {
    snapshotRef.current = value;
    setSnapshot(value);
  }, []);
  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setError("Open ASMR Recorder in the desktop app to edit media.");
      return;
    }
    try {
      await queue.current.catch(() => {});
      update(await invoke<EditorSnapshot>("editor_snapshot"));
    } catch (e) {
      setError(String(e));
    }
  }, [update]);
  useEffect(() => {
    void refresh();
    if (isTauri())
      void invoke<EffectDefinition[]>("editor_effects")
        .then(setEffects)
        .catch((e) => setError(String(e)));
  }, [refresh]);

  const execute = useCallback(
    (command: string, params: Params = {}) => {
      setPending((n) => n + 1);
      const task = queue.current
        .catch(() => {})
        .then(async () => {
          try {
            const response = await invoke<{
              result: unknown;
              snapshot: EditorSnapshot;
            }>("editor_execute", {
              command,
              params,
              revision: snapshotRef.current?.revision ?? null,
            });
            update(response.snapshot);
            setError(null);
            const result = response.result as { errors?: string[] } | null;
            if (result?.errors?.length)
              toast({
                title: "Some media could not be imported",
                description: result.errors.join("\n"),
                variant: "destructive",
              });
            return response.result;
          } catch (e) {
            try {
              update(await invoke<EditorSnapshot>("editor_snapshot"));
            } catch {
              /* preserve original operation error */
            }
            setError(String(e));
            throw e;
          } finally {
            setPending((n) => n - 1);
          }
        });
      queue.current = task;
      return task;
    },
    [update],
  );
  const query = useCallback(
    (command: string, params: Params = {}) =>
      invoke("editor_query", { command, params }),
    [],
  );
  const importTake = useCallback(
    (path: string) => {
      setPending((n) => n + 1);
      const task = queue.current
        .catch(() => {})
        .then(async () => {
          try {
            update(
              await invoke<EditorSnapshot>("editor_import_take", { path }),
            );
            setError(null);
          } catch (e) {
            setError(String(e));
            throw e;
          } finally {
            setPending((n) => n - 1);
          }
        });
      queue.current = task;
      return task;
    },
    [update],
  );
  const importFiles = useCallback(async () => {
    const paths = await open({ multiple: true, title: "Import Media" });
    if (paths)
      await execute("file.import", {
        paths: Array.isArray(paths) ? paths : [paths],
      });
  }, [execute]);
  const saveProject = useCallback(
    async (as = false) => {
      const path =
        (!as && snapshotRef.current?.path) ||
        (await save({
          title: "Save Project",
          defaultPath: `${snapshotRef.current?.project.name ?? "Untitled"}.fcproj`,
          filters: [{ name: "Filmcraft Project", extensions: ["fcproj"] }],
        }));
      if (!path) return false;
      await execute("file.saveAs", { path });
      return true;
    },
    [execute],
  );
  const openProject = useCallback(async () => {
    const path = await open({
      title: "Open Project",
      filters: [{ name: "Filmcraft Project", extensions: ["fcproj"] }],
    });
    if (typeof path === "string") await execute("file.open", { path });
  }, [execute]);
  return (
    <EditorContext.Provider
      value={{
        snapshot,
        effects,
        error,
        query,
        busy: pending > 0,
        refresh,
        execute,
        importTake,
        importFiles,
        saveProject,
        openProject,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}
