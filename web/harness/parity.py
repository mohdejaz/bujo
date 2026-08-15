#!/usr/bin/env python3
"""Parity check: run the same command script through bujo.py and the JS port,
normalize away prompts/timestamps, and diff. Exit 0 if identical."""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCRIPT = os.path.join(HERE, "script.txt")

ANSI = re.compile(r"\x1b\[[0-9;]*m")
PROMPT = re.compile(r"^\(.*\)( » \d+)?$")
TS = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+")
MD = re.compile(r"\b\d{2}/\d{2}\b")


def normalize_py(text):
    out = []
    for line in text.split("\n"):
        line = ANSI.sub("", line)
        if line.startswith("bujo - type ") or line.startswith("using database:"):
            continue  # startup banner, not command output
        if line.startswith("# "):
            out.append(line[2:])
        elif PROMPT.match(line):
            continue  # path prompt echoed before each command
        else:
            out.append(line)
    return scrub(out)


def normalize_js(text):
    return scrub(text.split("\n"))


def scrub(lines):
    lines = [MD.sub("<MD>", TS.sub("<TS>", l)) for l in lines]
    while lines and lines[-1] == "":
        lines.pop()
    return lines


def main():
    with open(SCRIPT) as f:
        script = f.read()

    db_path = os.path.join(tempfile.mkdtemp(), "bujo.db")
    env = dict(os.environ, BUJO_DB=db_path, COLUMNS="80")
    py = subprocess.run(
        [sys.executable, os.path.join(ROOT, "bujo.py")],
        input=script, capture_output=True, text=True, env=env,
    ).stdout

    js = subprocess.run(
        ["node", os.path.join(HERE, "run_js.js"), SCRIPT],
        capture_output=True, text=True,
    )
    if js.returncode != 0:
        print("JS runner failed:\n" + js.stderr)
        return 2

    a = normalize_py(py)
    b = normalize_js(js.stdout)

    if a == b:
        print(f"PARITY OK — {len(a)} output lines match")
        return 0

    print("PARITY MISMATCH")
    import difflib
    for d in difflib.unified_diff(a, b, "bujo.py", "bujo.js", lineterm=""):
        print(d)
    return 1


if __name__ == "__main__":
    sys.exit(main())
