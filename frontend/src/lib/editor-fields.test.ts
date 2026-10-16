import { expect, it } from "vitest";
import { commandFields, fieldValue } from "./editor-fields";
it("parses nested descriptions and choices without splitting nested commas", () => {
  const f = commandFields(
    '{"clip":id,"position":[x,y]?,"text":str="New Text","mode":"roll|ripple"}',
  );
  expect(f.map((x) => x.name)).toEqual(["clip", "position", "text", "mode"]);
  expect(f[2].defaultValue).toBe("New Text");
  expect(f[3].choices).toEqual(["roll", "ripple"]);
  expect(fieldValue(f[0], "9007199254740993")).toEqual({
    $integer: "9007199254740993",
  });
  expect(fieldValue(f[1], "1, 2")).toEqual([1, 2]);
});
it("preserves nested large IDs and typed parameter values", () => {
  const [moves] = commandFields('{"moves":[{"clip":id,"time":ticks}]}');
  expect(
    fieldValue(
      moves,
      '[{"clip":{"$integer":"9007199254740993"},"time":{"$integer":"9144576000000000"}}]',
    ),
  ).toEqual([
    {
      clip: { $integer: "9007199254740993" },
      time: { $integer: "9144576000000000" },
    },
  ]);
  const [value] = commandFields('{"value":any}');
  expect(fieldValue(value, "12.5")).toBe(12.5);
  expect(fieldValue(value, '"123"')).toBe("123");
  expect(fieldValue(value, "false")).toBe(false);
  const [ticks] = commandFields('{"time":i64}');
  expect(fieldValue(ticks, "9144576000000001")).toEqual({
    $integer: "9144576000000001",
  });
});
