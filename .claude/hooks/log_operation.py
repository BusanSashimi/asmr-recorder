#!/usr/bin/env python3
"""Append a record of each Claude Code operation to docs/logs/<YYYY-MM-DD>.md.

Wired as a UserPromptSubmit hook (records the submitted prompt) and a
PostToolUse hook for all tools (records each tool use). Reads the hook payload
as JSON on stdin and appends a timestamped markdown line to the dated log.

Designed to be safe: it never reads more than stdin, swallows all errors, and
always exits 0 so it can never block or fail a tool call.
"""
import sys
import os
import json
import datetime


def summarize(tool, ti):
    """Return a short human-readable summary of a tool's input."""
    if not isinstance(ti, dict):
        return str(ti)
    if tool == "Bash":
        return ti.get("command", "")
    if tool in ("Edit", "Write", "Read", "NotebookEdit"):
        return ti.get("file_path", "")
    if tool in ("Glob", "Grep"):
        return ti.get("pattern", "")
    if tool in ("Task", "Agent"):
        return ti.get("description", "")
    if tool == "Skill":
        return ti.get("skill", "")
    if tool == "Workflow":
        return ti.get("name", "(inline script)")
    try:
        return json.dumps(ti, ensure_ascii=False)
    except Exception:
        return str(ti)


def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        return
    if not isinstance(data, dict):
        return

    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    logdir = os.path.join(root, "docs", "logs")
    os.makedirs(logdir, exist_ok=True)

    now = datetime.datetime.now()
    date = now.strftime("%Y-%m-%d")
    ts = now.strftime("%H:%M:%S")
    logpath = os.path.join(logdir, date + ".md")

    # Determine the event; fall back to inferring it from the payload shape.
    event = data.get("hook_event_name") or (
        "UserPromptSubmit" if data.get("prompt") and not data.get("tool_name")
        else "PostToolUse"
    )

    if event == "UserPromptSubmit":
        prompt = " ".join((data.get("prompt") or "").split())
        if len(prompt) > 800:
            prompt = prompt[:800] + " …"
        line = "\n## {} — Prompt\n> {}\n".format(ts, prompt or "(empty)")
    elif event == "PostToolUse":
        tool = data.get("tool_name", "?")
        summary = " ".join(str(summarize(tool, data.get("tool_input") or {})).split())
        if len(summary) > 400:
            summary = summary[:400] + " …"
        line = "- `{}` **{}** — {}".format(ts, tool, summary)
    else:
        line = "- `{}` _{}_".format(ts, event)

    if not os.path.exists(logpath):
        header = (
            "# Claude session operations log — {}\n\n"
            "_Auto-recorded by the `.claude/hooks/log_operation.py` hook "
            "(UserPromptSubmit + PostToolUse)._\n".format(date)
        )
        with open(logpath, "a", encoding="utf-8") as f:
            f.write(header)

    with open(logpath, "a", encoding="utf-8") as f:
        f.write(line + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
