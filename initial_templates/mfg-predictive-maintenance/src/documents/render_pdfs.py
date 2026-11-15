"""Render the synthetic plant manuals (md/*.md) to PDF (pdf/*.pdf) for the Genie agent's documents volume.

Dependency: reportlab.   Usage: python render_pdfs.py
Upload: databricks fs cp -r pdf dbfs:/Volumes/<catalog>/<schema>/manuals  (or the setup job's upload task)
"""
import pathlib
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

HERE = pathlib.Path(__file__).parent
ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=16, textColor=colors.HexColor("#0B2545"))
H2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, textColor=colors.HexColor("#13315C"))
BODY = ParagraphStyle("b", parent=ss["BodyText"], fontSize=10, leading=13.5)


def inline(t: str) -> str:
    t = t.replace("≥", ">=").replace("≤", "<=").replace("≈", "~").replace("−", "-").replace("–", "-")
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)


def render(md_path: pathlib.Path, out: pathlib.Path):
    story, table = [], []

    def flush_table():
        if table:
            rows = [[Paragraph(inline(c), BODY) for c in r] for r in table if not set("".join(r)) <= set("-: ")]
            t = Table(rows, repeatRows=1)
            t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                                   ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF6"))]))
            story.extend([t, Spacer(1, 8)])
            table.clear()

    for line in md_path.read_text().splitlines():
        s = line.strip()
        if s.startswith("|"):
            table.append([c.strip() for c in s.strip("|").split("|")])
            continue
        flush_table()
        if not s:
            story.append(Spacer(1, 4))
        elif s.startswith("# "):
            story.append(Paragraph(inline(s[2:]), H1))
        elif s.startswith("## "):
            story.append(Paragraph(inline(s[3:]), H2))
        elif re.match(r"^(- |\d+\. )", s):
            story.append(Paragraph(inline(s), BODY, bulletText=None))
        else:
            story.append(Paragraph(inline(s), BODY))
    flush_table()
    SimpleDocTemplate(str(out), pagesize=LETTER, leftMargin=0.8 * inch, rightMargin=0.8 * inch,
                      title=md_path.stem).build(story)


if __name__ == "__main__":
    (HERE / "pdf").mkdir(exist_ok=True)
    for p in sorted((HERE / "md").glob("*.md")):
        render(p, HERE / "pdf" / f"{p.stem}.pdf")
        print("rendered", p.stem)
