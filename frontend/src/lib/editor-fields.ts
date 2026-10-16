import { integer } from "./editor-time";
export interface CommandField {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
  choices: string[];
}
// Upstream descriptions are a compact DSL, not JSON Schema. Parse only top-level
// fields; nested commas and explanatory strings must not turn into form fields.
export function commandFields(description: string): CommandField[] {
  const fields: CommandField[] = [];
  let depth = 0,
    quote = false,
    start = -1;
  for (let i = 0; i < description.length; i++) {
    const ch = description[i];
    if (ch === '"' && description[i - 1] !== "\\") quote = !quote;
    if (!quote && "{[(".includes(ch)) depth++;
    if (!quote && "}])".includes(ch)) depth--;
    if (start < 0 && ch === "{" && depth === 1) start = i + 1;
    if (
      start >= 0 &&
      !quote &&
      ((ch === "," && depth === 1) || (ch === "}" && depth === 0))
    ) {
      const fragment = description.slice(start, i).trim();
      const match = fragment.match(/^"([^"]+)"\s*:\s*(.*)$/s);
      if (match) {
        const [, name, type] = match;
        const defaultValue = type
          .match(/=\s*("[^"]*"|[^,\s?)]+)/)?.[1]
          ?.replace(/^"|"$/g, "");
        const choices = [...type.matchAll(/"([^"[\]]+)"/g)]
          .flatMap((m) => m[1].split("|"))
          .filter((x) => x !== "…");
        fields.push({
          name,
          type,
          optional: type.includes("?") || defaultValue !== undefined,
          defaultValue,
          choices: choices.length > 1 ? choices : [],
        });
      }
      start = ch === "}" ? -1 : i + 1;
    }
  }
  return fields.filter(
    (f, i) => fields.findIndex((x) => x.name === f.name) === i,
  );
}
export function fieldValue(field: CommandField, text: string): unknown {
  if (field.type.startsWith("any") || field.type.startsWith("num|"))
    return JSON.parse(text);
  if (
    (field.type.startsWith("ExportSettings") ||
      field.type.startsWith("{") ||
      field.type.startsWith("[{") ||
      field.type.startsWith("[[") ||
      /^path\b/.test(field.type)) &&
    /^[{[]/.test(text)
  )
    return JSON.parse(text);
  if (field.type.startsWith("bool")) return text === "true";
  if (field.type.startsWith("[")) {
    const parts = text
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (/\bid\b|itemId|clipId/.test(field.type)) return parts.map(integer);
    if (/\bstr\b|"/.test(field.type)) return parts;
    return parts.map((x) => {
      const n = Number(x);
      if (!Number.isFinite(n)) throw new Error(`${field.name} needs numbers`);
      return n;
    });
  }
  if (
    /^(ticks?|mediaTicks|timelineTicks|id|itemId|clipId|binId|trackId|i64|u64)\b/.test(
      field.type,
    ) &&
    /^-?\d+$/.test(text)
  )
    return integer(text);
  if (/^(index|id).*\|/.test(field.type) && !/^[-+]?\d/.test(text)) return text;
  if (
    /^(f64|f32|u32|u64|i64|int\b|f\b|n\b|word\b|frames?\b|index\b|num\b|lufs\b|char\b|pct\b|percent\b|px\b|seconds\b|[0-9])/.test(
      field.type,
    )
  ) {
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(`${field.name} needs a number`);
    return n;
  }
  return text;
}
export function fieldLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (x) => x.toUpperCase());
}
