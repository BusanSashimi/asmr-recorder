import { createContext, useContext } from "react";
import type { EditorSnapshot, EffectDefinition, Params } from "@/types/editor";
interface EditorContextValue {
  snapshot: EditorSnapshot | null;
  effects: EffectDefinition[];
  error: string | null;
  busy: boolean;
  query: (command: string, params?: Params) => Promise<unknown>;
  refresh: () => Promise<void>;
  execute: (command: string, params?: Params) => Promise<unknown>;
  importFiles: () => Promise<void>;
  importTake: (path: string) => Promise<void>;
  saveProject: (as?: boolean) => Promise<boolean>;
  openProject: () => Promise<void>;
}
export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor() {
  const context = useContext(EditorContext);
  if (!context) throw new Error("Missing EditorProvider");
  return context;
}
