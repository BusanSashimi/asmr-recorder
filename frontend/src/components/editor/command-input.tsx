import {
  commandFields,
  fieldLabel,
  fieldValue,
  type CommandField,
} from "@/lib/editor-fields";
import { Button } from "@/components/ui/button";
// The engine publishes a compact parameter DSL. Complex values are edited as
// labeled rows; JSON is an internal serialization detail, never an input format.
export function CommandInput({
  field,
  value,
  onChange,
}: {
  field: CommandField;
  value: string;
  onChange: (v: string) => void;
}) {
  const f = field,
    type = f.type.trim();
  if (type.startsWith("any") || type.startsWith("num|"))
    return <TypedValue value={value} onChange={onChange} />;
  const structured =
    type.startsWith("ExportSettings") ||
    type.startsWith("{") ||
    type.startsWith("[{") ||
    type.startsWith("[[") ||
    /^path\b/.test(type);
  if (structured) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        value ||
          (type.startsWith("{") || type.startsWith("ExportSettings")
            ? "{}"
            : "[]"),
      );
    } catch {
      parsed = type.startsWith("{") ? {} : [];
    }
    if (type.startsWith("[[") || /^path\b/.test(type)) {
      const rows = Array.isArray(parsed) ? (parsed as number[][]) : [];
      return (
        <div className="w-full space-y-1">
          {rows.map((row, i) => (
            <div className="flex gap-1" key={i}>
              {[0, 1].map((n) => (
                <input
                  key={n}
                  type="number"
                  step="any"
                  className="editor-input w-full min-w-0"
                  aria-label={`${f.name} point ${i + 1} ${n ? "Y" : "X"}`}
                  value={row[n] ?? 0}
                  onChange={(e) =>
                    onChange(
                      JSON.stringify(
                        rows.map((r, j) =>
                          j === i
                            ? r.map((v, k) =>
                                k === n ? Number(e.target.value) : v,
                              )
                            : r,
                        ),
                      ),
                    )
                  }
                />
              ))}
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  onChange(JSON.stringify(rows.filter((_, j) => j !== i)))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            onClick={() => onChange(JSON.stringify([...rows, [0, 0]]))}
          >
            Add Point
          </Button>
        </div>
      );
    }
    const array = type.startsWith("["),
      fields = commandFields(type.slice(array ? 1 : 0));
    const rows = array ? (Array.isArray(parsed) ? parsed : []) : [parsed];
    return (
      <div className="w-full space-y-2">
        {rows.map((row, i) => (
          <fieldset
            key={i}
            className="border border-separator rounded-md p-2 space-y-2"
          >
            {fields.length ? (
              fields.map((child) => {
                const val = (row as Record<string, unknown>)?.[child.name];
                const text =
                  val == null
                    ? ""
                    : typeof val === "object" && "$integer" in val
                      ? String(val.$integer)
                      : typeof val === "object"
                        ? JSON.stringify(val)
                        : String(val);
                return (
                  <label className="block text-caption" key={child.name}>
                    {fieldLabel(child.name)}
                    <CommandInput
                      field={child}
                      value={text}
                      onChange={(text) => {
                        let v: unknown = text;
                        try {
                          v = fieldValue(child, text);
                        } catch {
                          /* incomplete number remains editable */
                        }
                        const next = { ...(row as object), [child.name]: v };
                        onChange(
                          JSON.stringify(
                            array
                              ? rows.map((r, j) => (j === i ? next : r))
                              : next,
                          ),
                        );
                      }}
                    />
                  </label>
                );
              })
            ) : (
              <KeyValues
                value={row as Record<string, unknown>}
                onChange={(v) => onChange(JSON.stringify(v))}
              />
            )}
            {array && (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  onChange(JSON.stringify(rows.filter((_, j) => j !== i)))
                }
              >
                Remove Row
              </Button>
            )}
          </fieldset>
        ))}
        {array && (
          <Button
            type="button"
            size="sm"
            onClick={() => onChange(JSON.stringify([...rows, {}]))}
          >
            Add Row
          </Button>
        )}
      </div>
    );
  }
  if (type.startsWith("bool"))
    return (
      <select
        className="editor-input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Default</option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  if (f.choices.length)
    return (
      <select
        className="editor-input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Default</option>
        {f.choices.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    );
  return (
    <input
      className="editor-input w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        type.startsWith("[") ? "Separate values with commas" : undefined
      }
    />
  );
}
function KeyValues({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const rows = Object.entries(value ?? {});
  return (
    <div className="space-y-1">
      {rows.map(([k, v], i) => (
        <div className="flex gap-1" key={i}>
          <input
            className="editor-input w-1/2"
            aria-label={`Property ${i + 1} name`}
            value={k}
            onChange={(e) =>
              onChange(
                Object.fromEntries(
                  rows.map(([key, val], j) =>
                    j === i ? [e.target.value, val] : [key, val],
                  ),
                ),
              )
            }
          />
          <input
            className="editor-input w-1/2"
            aria-label={`Property ${i + 1} value`}
            value={String(v)}
            onChange={(e) => {
              const t = e.target.value;
              onChange({
                ...value,
                [k]:
                  t === "true"
                    ? true
                    : t === "false"
                      ? false
                      : t.trim() !== "" && Number.isFinite(Number(t))
                        ? Number(t)
                        : t,
              });
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        onClick={() =>
          onChange({ ...value, [`property${rows.length + 1}`]: "" })
        }
      >
        Add Property
      </Button>
    </div>
  );
}

function TypedValue({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  let parsed: unknown = "";
  try {
    parsed = JSON.parse(value);
  } catch {
    /* blank default */
  }
  const kind = Array.isArray(parsed) ? "point" : typeof parsed;
  return (
    <div className="w-full flex gap-1">
      <select
        className="editor-input"
        aria-label="Value type"
        value={kind}
        onChange={(e) =>
          onChange(
            JSON.stringify(
              e.target.value === "number"
                ? 0
                : e.target.value === "boolean"
                  ? false
                  : e.target.value === "point"
                    ? [0, 0]
                    : "",
            ),
          )
        }
      >
        <option value="string">Text</option>
        <option value="number">Number</option>
        <option value="boolean">Toggle</option>
        <option value="point">Point</option>
      </select>
      {kind === "boolean" ? (
        <input
          type="checkbox"
          aria-label="Value"
          checked={!!parsed}
          onChange={(e) => onChange(JSON.stringify(e.target.checked))}
        />
      ) : kind === "point" ? (
        (parsed as number[]).map((v, i) => (
          <input
            className="editor-input w-1/3"
            type="number"
            step="any"
            key={i}
            aria-label={i ? "Y" : "X"}
            value={v}
            onChange={(e) =>
              onChange(
                JSON.stringify(
                  (parsed as number[]).map((n, j) =>
                    i === j ? Number(e.target.value) : n,
                  ),
                ),
              )
            }
          />
        ))
      ) : (
        <input
          className="editor-input w-full min-w-0"
          aria-label="Value"
          type={kind === "number" ? "number" : "text"}
          step="any"
          value={String(parsed ?? "")}
          onChange={(e) =>
            onChange(
              JSON.stringify(
                kind === "number" ? Number(e.target.value) : e.target.value,
              ),
            )
          }
        />
      )}
    </div>
  );
}
