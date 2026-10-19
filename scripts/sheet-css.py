# Regenerates src/report/sheet-css.ts from docs/sheet-mock.html (the approved look), minus the mock's toggle buttons.
import re
from pathlib import Path
root = Path(__file__).resolve().parent.parent
css = re.search(r"<style>(.*?)</style>", (root / "docs/sheet-mock.html").read_text(encoding="utf-8"), re.S).group(1)
lines = css.split("\n")
start = next(i for i, l in enumerate(lines) if l.strip().startswith(".toggle {"))
end = next(i for i, l in enumerate(lines) if l.strip().startswith(".toggle button.on"))
del lines[start:end + 1]
(root / "src/report/sheet-css.ts").write_text(
    "// Generated from docs/sheet-mock.html (the approved look). Edit the mock, then run scripts/sheet-css.py.\n"
    "export const SHEET_CSS = " + repr("\n".join(lines)) + ";\n", encoding="utf-8")
