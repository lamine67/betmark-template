# coding: utf-8
# Серверный генератор PDF-отчёта Live-трекера (проект)
import json
import sys

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import Flowable, SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
pdfmetrics.registerFont(TTFont("DejaVu", f"{FONT_DIR}/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", f"{FONT_DIR}/DejaVuSans-Bold.ttf"))

PAGE = A4
NAVY = colors.HexColor("#1a2a4a")
GRAY = colors.HexColor("#6b7280")
LINE = colors.HexColor("#e2e5eb")
TEXT = colors.HexColor("#33394a")

BEST_BG = colors.HexColor("#e3f0fc")
BEST_BORDER = colors.HexColor("#2f6fb8")
UP_TEXT = colors.HexColor("#1a7f37")
DOWN_TEXT = colors.HexColor("#c22b2b")
UNAVAILABLE_TEXT = colors.HexColor("#b8860b")
DIVIDER_BG = colors.HexColor("#eef1f5")

styles = {
    "h2": ParagraphStyle("h2", fontName="DejaVu-Bold", fontSize=12, textColor=NAVY, spaceBefore=6, spaceAfter=3),
    "body": ParagraphStyle("body", fontName="DejaVu", fontSize=9, textColor=TEXT, leading=12),
    "small": ParagraphStyle("small", fontName="DejaVu", fontSize=7.5, textColor=GRAY, leading=10),
}
CAPTION_CELL = ParagraphStyle("caption", fontName="DejaVu-Bold", fontSize=9.5, textColor=colors.white)
DIVIDER_CELL = ParagraphStyle("divider", fontName="DejaVu-Bold", fontSize=9.5, textColor=NAVY)
INFO_LABEL = ParagraphStyle("info_label", fontName="DejaVu-Bold", fontSize=7.5, textColor=NAVY, leading=9)
INFO_VALUE = ParagraphStyle("info_value", fontName="DejaVu", fontSize=7.5, textColor=TEXT, leading=9)

def main():
    in_path, out_path = sys.argv[1], sys.argv[2]
    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    match = data["match"]
    bookmakers = data["bookmakers"]
    moments = data["moments"]
    OUTCOMES = [tuple(x) for x in data.get("outcomes", [("1", "П1"), ("X", "X"), ("2", "П2")])]
    prematch = bool(match.get("prematch"))
    tennis = bool(match.get("tennis"))  # теннис - вместо голов выигранные сеты, под счётом по сетам геймы и очки

    global PAGE
    MARGIN = 6 * mm  # страница всегда книжная; поля узкие, чтобы колонкам хватало ширины
    usable = PAGE[0] - 2 * MARGIN
    label_w = 10 * mm
    col_w = [label_w] + [(usable - label_w) / len(bookmakers)] * len(bookmakers)
    colpt = col_w[1]
    longest = max((max(len(w) for w in str(b).split()) for b in bookmakers), default=6)
    name_font = max(4.5, min(8, (colpt - 4) / (max(longest, 5) * 0.76)))
    num_font = max(5.5, min(8.5, (colpt - 3) / (6 * 0.68)))
    row_pad = 2 if PAGE[0] > PAGE[1] else 3  # в альбомной странице строки журнала плотнее, чтобы страниц было не больше
    hdr_style = ParagraphStyle("hdr", fontName="DejaVu-Bold", fontSize=name_font, leading=name_font + 1.5, textColor=colors.white, alignment=TA_CENTER)

    vertical = len(bookmakers) > 9  # много контор: названия читаются снизу вверх, каждое в своей узкой колонке

    class VText(Flowable):
        def __init__(self, text, size):
            super().__init__()
            self.text, self.size = text, size
            self.tw = pdfmetrics.stringWidth(text, "DejaVu-Bold", size)

        def wrap(self, availW, availH):
            self.w = availW
            return availW, self.tw + 5

        def draw(self):
            c = self.canv
            c.saveState()
            c.setFillColor(colors.white)
            c.setFont("DejaVu-Bold", self.size)
            c.translate(self.w / 2 + self.size * 0.33, 2)
            c.rotate(90)
            c.drawString(0, 0, self.text)
            c.restoreState()

    v_font = max(5.5, min(8, colpt - 5))

    def hdr(name):
        if vertical:
            return VText(str(name), v_font)
        return Paragraph(str(name), hdr_style)

    def header_bar(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, PAGE[1] - 17 * mm, PAGE[0], 17 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("DejaVu-Bold", 13)
        canvas.drawString(MARGIN, PAGE[1] - 9 * mm, f"{match['home']} — {match['away']}")
        canvas.setFillColor(colors.HexColor("#c9d4e8"))
        canvas.setFont("DejaVu", 8.5)
        canvas.drawString(MARGIN, PAGE[1] - 13.5 * mm, f"{match['sport']} · {match['league']}")
        canvas.setFillColor(colors.HexColor("#8fa6cc"))
        canvas.setFont("DejaVu", 7)
        canvas.drawRightString(PAGE[0] - MARGIN, 6 * mm, f"Стр. {doc.page}")
        canvas.drawString(MARGIN, 6 * mm, match.get("footer") or "Betmark — отчёт по live-коэффициентам")
        canvas.restoreState()

    def best_prices(prices):
        best = {k: None for k, _lab in OUTCOMES}
        for bk_prices in prices.values():
            if bk_prices is None:
                continue
            for k, _lab in OUTCOMES:
                v = bk_prices.get(k)
                if v is None:
                    continue
                if best[k] is None or v > best[k]:
                    best[k] = v
        return best

    def snapshot_table(prices, caption, prev_prices=None, divider=False, show_header=False, unavailable_now=None):
        n_cols = 1 + len(bookmakers)
        best = best_prices(prices)
        cap_style = DIVIDER_CELL if divider else CAPTION_CELL
        cap_bg = DIVIDER_BG if divider else NAVY
        cap_line = LINE if divider else colors.white
        unavailable_now = unavailable_now or set()

        data_rows = []
        if show_header:
            data_rows.append([""] + [hdr(b) for b in bookmakers])
        data_rows.append([Paragraph(caption, cap_style)] + [""] * (n_cols - 1))

        directions = {}
        unavailable_cells = set()
        for outcome, label in OUTCOMES:
            row = [label]
            for bk in bookmakers:
                bk_prices = prices.get(bk)
                price = bk_prices.get(outcome) if bk_prices else None
                if price is None:
                    if bk in unavailable_now:
                        row.append("—*")
                        unavailable_cells.add(bk)
                    else:
                        row.append("—")
                    continue
                row.append(f"{price:.2f}")
                if prev_prices is not None:
                    prev_bk = prev_prices.get(bk)
                    prev_price = prev_bk.get(outcome) if prev_bk else None
                    if prev_price is not None:
                        d = round(price - prev_price, 2)
                        if abs(d) > 0.001:
                            directions[(outcome, bk)] = "up" if d > 0 else "down"
            data_rows.append(row)

        cap_row = 1 if show_header else 0
        t = Table(data_rows, colWidths=col_w)
        cmds = [
            ("SPAN", (0, cap_row), (-1, cap_row)),
            ("BACKGROUND", (0, cap_row), (-1, cap_row), cap_bg),
            ("LINEBELOW", (0, cap_row), (-1, cap_row), 0.6, cap_line),
            ("TOPPADDING", (0, cap_row), (-1, cap_row), 3),
            ("BOTTOMPADDING", (0, cap_row), (-1, cap_row), 3),
            ("LEFTPADDING", (0, cap_row), (-1, cap_row), 8),
            ("FONTNAME", (0, cap_row + 1), (0, -1), "DejaVu-Bold"),
            ("FONTSIZE", (0, cap_row), (-1, -1), num_font),
            ("TEXTCOLOR", (0, cap_row + 1), (0, -1), NAVY),
            ("ALIGN", (1, cap_row + 1), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, cap_row + 1), (-1, -1), 3),
            ("BOTTOMPADDING", (0, cap_row + 1), (-1, -1), 3),
            ("INNERGRID", (0, cap_row + 1), (-1, -1), 0.4, LINE),
            ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ]
        if show_header:
            cmds += [
                ("FONTNAME", (0, 0), (-1, 0), "DejaVu-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8.5),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ALIGN", (1, 0), (-1, 0), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, 0), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2.5),
                ("LEFTPADDING", (0, 0), (0, 0), 8),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.white),
            ]
        for r, (outcome, _) in enumerate(OUTCOMES, start=cap_row + 1):
            for c, bk in enumerate(bookmakers, start=1):
                bk_prices = prices.get(bk)
                price = bk_prices.get(outcome) if bk_prices else None
                if price is None:
                    if bk in unavailable_now:
                        cmds.append(("TEXTCOLOR", (c, r), (c, r), UNAVAILABLE_TEXT))
                        cmds.append(("FONTNAME", (c, r), (c, r), "DejaVu-Bold"))
                    continue
                is_best = best[outcome] is not None and abs(price - best[outcome]) < 0.001
                direction = directions.get((outcome, bk))
                if is_best:
                    cmds.append(("BACKGROUND", (c, r), (c, r), BEST_BG))
                    cmds.append(("BOX", (c, r), (c, r), 0.7, BEST_BORDER))
                    cmds.append(("FONTNAME", (c, r), (c, r), "DejaVu-Bold"))
                if direction == "up":
                    cmds.append(("TEXTCOLOR", (c, r), (c, r), UP_TEXT))
                    cmds.append(("FONTNAME", (c, r), (c, r), "DejaVu-Bold"))
                elif direction == "down":
                    cmds.append(("TEXTCOLOR", (c, r), (c, r), DOWN_TEXT))
                    cmds.append(("FONTNAME", (c, r), (c, r), "DejaVu-Bold"))
        cmds += [("LEFTPADDING", (1, 0), (-1, -1), 1), ("RIGHTPADDING", (1, 0), (-1, -1), 1)]
        t.setStyle(TableStyle(cmds))
        return t

    doc = SimpleDocTemplate(
        out_path, pagesize=PAGE,
        topMargin=17 * mm - 6 * 25.4 / 72 * mm, bottomMargin=10 * mm, leftMargin=MARGIN, rightMargin=MARGIN,
    )
    story = []

    def lbl(text):
        return Paragraph(text, INFO_LABEL)

    def val(text):
        return Paragraph(text, INFO_VALUE)

    is_live = bool(match.get("live"))
    score_label = "Текущий счёт" if is_live else "Итоговый счёт"
    end_label = "Отчёт сформирован" if is_live else "Конец слежения"
    reason_label = "Статус" if is_live else "Причина завершения"
    info_rows = [
        [lbl("Начало матча"), val(match["kickoff"]), lbl(score_label), val(match.get("score", ""))],
        [lbl(end_label), val(match.get("trackingEnd", "")), lbl("Интервал опроса"), val(match.get("interval", ""))],
        [lbl(reason_label), val(match.get("endReason", "")), lbl("Конторы"), val(", ".join(bookmakers))],
    ]
    if match.get("infoRows"):
        info_rows = [[lbl(r[0]), val(r[1]), lbl(r[2]), val(r[3])] for r in match["infoRows"]]
    info_tbl = Table(info_rows, colWidths=[usable * 0.19, usable * 0.24, usable * 0.145, usable * 0.425])
    info_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f7f8fa")),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(info_tbl)

    if match.get("aiSummary"):
        story.append(Spacer(1, 2 * mm))
        summary_style = ParagraphStyle(
            "ai_summary", fontName="DejaVu", fontSize=9, textColor=colors.HexColor("#2b2b2b"), leading=13,
        )
        summary_title_style = ParagraphStyle(
            "ai_summary_title", fontName="DejaVu-Bold", fontSize=8, textColor=colors.HexColor("#555555"), leading=11,
        )
        summary_tbl = Table(
            [[Paragraph(match.get("summaryTitle") or "РЕЗЮМЕ МАТЧА", summary_title_style)], [Paragraph(match["aiSummary"], summary_style)]],
            colWidths=[usable],
        )
        summary_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f2f2f2")),
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#cfcfcf")),
            ("TOPPADDING", (0, 0), (-1, 0), 5),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
            ("TOPPADDING", (0, 1), (-1, 1), 1),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(summary_tbl)

    if match.get("startedLate") and match.get("startedLateNote"):
        story.append(Spacer(1, 2 * mm))
        note_style = ParagraphStyle(
            "late_note", fontName="DejaVu-Bold", fontSize=8, textColor=colors.HexColor("#8a5a00"), leading=11,
        )
        note_tbl = Table(
            [[Paragraph("⚠ " + match["startedLateNote"], note_style)]],
            colWidths=[usable],
        )
        note_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fff6e0")),
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#f0c05a")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(note_tbl)

    if match.get("rawVariantNote"):
        story.append(Spacer(1, 2 * mm))
        raw_note_style = ParagraphStyle(
            "raw_variant_note", fontName="DejaVu-Bold", fontSize=8, textColor=GRAY, leading=11,
        )
        raw_note_tbl = Table(
            [[Paragraph("ⓘ " + match["rawVariantNote"], raw_note_style)]],
            colWidths=[usable],
        )
        raw_note_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), DIVIDER_BG),
            ("BOX", (0, 0), (-1, -1), 0.6, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(raw_note_tbl)

    def minute_label(m):
        # "на какой минуте матча забит гол" - из Book A liveEventInfos.timerSeconds (см. live-tracker-poll.ts)
        mm = m.get("matchMinute")
        return f"{mm} минута" if mm is not None else None

    goal_moments = [m for m in moments if m["isGoal"]]
    if goal_moments:
        goal_lines = "  •  ".join(
            f"<b>{m['time']}</b>"
            + (f" ({minute_label(m)})" if minute_label(m) else "")
            + (f" — счёт по сетам стал {m['scoreHome']}:{m['scoreAway']}" if tennis else f" — счёт стал {m['scoreHome']}:{m['scoreAway']}")
            + (f" ({m['scoreDetail'].split(' · ')[0]})" if tennis and m.get("scoreDetail") else "")
            + ((f" (сет выиграл {m['goalTeam']})" if tennis else f" (гол {m['goalTeam']})") if m.get("goalTeam") else "")
            for m in goal_moments
        )
    else:
        goal_lines = "Сеты не завершались." if tennis else "Голов не было."

    if prematch:
        # прематч: вместо блока «Голы» - таблица открытия линии
        story.append(Spacer(1, 2 * mm))
        story.append(KeepTogether([
            snapshot_table(
                moments[0]["prices"], moments[0]["time"], show_header=True,
                unavailable_now=set(moments[0].get("unavailableNow", [])),
            ),
        ]))
        if match.get("dashNote"):
            story.append(Spacer(1, 1 * mm))
            story.append(Paragraph(match["dashNote"], styles["small"]))
    else:
      story.append(KeepTogether([
        Paragraph("Сеты" if tennis else "Голы", styles["h2"]),
        Paragraph(goal_lines, styles["body"]),
        Paragraph(
            ("Источник: live-счёт Book A (customFactors / liveEventInfos) - тот же фид, что и коэффициенты."
             if "Book A" in bookmakers else
             "Источник: live-лента Alpha (счёт, минута и коэффициенты берутся из одного фида)."),
            styles["small"],
        ),
        Spacer(1, 1.5 * mm),
        snapshot_table(
            moments[0]["prices"], "Коэффициенты перед матчем (старт)", show_header=True,
            unavailable_now=set(moments[0].get("unavailableNow", [])),
        ),
    ]))

    any_unavailable_shown = any(m.get("unavailableNow") for m in moments)
    if any_unavailable_shown and prematch:
        story.append(Spacer(1, 1 * mm))
        story.append(Paragraph(match.get("starNote") or "<b>—*</b> — линии у конторы сейчас нет.", styles["small"]))
    elif any_unavailable_shown:
        story.append(Spacer(1, 1 * mm))
        story.append(Paragraph(
            '<font color="#b8860b"><b>—*</b></font> — контора была в эфире с настоящей ценой, но именно на этот момент цена пропала '
            "(зафиксировано ботом как «пропала», не как «ещё не появилась») - ограничение источника на тот момент, не сбой сбора данных.",
            styles["small"],
        ))

    prev = moments[0]["prices"]
    if prematch and len(moments) > 1:
        last_m = moments[-1]
        story.append(Spacer(1, 1.5 * mm))
        story.append(KeepTogether([
            snapshot_table(last_m["prices"], last_m["time"], prev_prices=prev, unavailable_now=set(last_m.get("unavailableNow", []))),
        ]))
    for m in ([] if prematch else goal_moments):
        time_part = f'{minute_label(m)}, {m["time"]}' if minute_label(m) else m["time"]
        caption = (
            (f'<font color="#ffb020">СЕТ</font> — счёт по сетам {m["scoreHome"]}:{m["scoreAway"]}' if tennis else f'<font color="#ffb020">ГОЛ</font> — счёт стал {m["scoreHome"]}:{m["scoreAway"]}')
            + (f' ({m["scoreDetail"].split(" · ")[0]})' if tennis and m.get("scoreDetail") else "")
            + (f' ({m["goalTeam"]})' if m.get("goalTeam") else "")
            + f'  ({time_part})'
        )
        story.append(Spacer(1, 1.5 * mm))
        story.append(KeepTogether([
            snapshot_table(m["prices"], caption, prev_prices=prev, unavailable_now=set(m.get("unavailableNow", []))),
        ]))
        prev = m["prices"]

    story.append(KeepTogether([
        Paragraph("Журнал изменений коэффициентов", styles["h2"]),
        Paragraph(
            (f"Новая таблица появляется, когда кэф хотя бы одной конторы сдвинулся на {match.get('thresholdPct', 1)}% и больше от последнего показанного значения. "
             "Голубым и жирным - лучший коэффициент по исходу среди контор; зелёным/красным - кэф вырос или упал относительно предыдущей таблицы. "
             "Заголовок с названиями контор повторяется в начале каждой страницы.") if prematch else
            "Блок появляется, только когда коэффициент реально изменился хотя бы у одной конторы (не на "
            "каждый опрос подряд). Голубым и жирным - лучший коэффициент по исходу среди контор; "
            "зелёным/красным - сам кэф вырос или упал относительно предыдущего показанного момента. Момент "
            "гола помечен так же, как обычный промежуток - только команда в скобках в конце времени. "
            "Заголовок с названиями контор повторяется в начале каждой страницы.",
            styles["small"],
        ),
    ]))
    story.append(PageBreak())

    n_cols = 1 + len(bookmakers)
    journal_rows = [[""] + [hdr(b) for b in bookmakers]]
    journal_cmds = [
        ("FONTNAME", (0, 0), (-1, 0), "DejaVu-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ALIGN", (1, 0), (-1, 0), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, 0), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2.5),
        ("LEFTPADDING", (0, 0), (0, 0), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
    ]

    prev = None
    for i, m in enumerate(moments):
        is_start = i == 0
        label = m["time"]
        ml = minute_label(m)
        if ml and not is_start:
            label += f", {ml}"
        if m["isGoal"] and m.get("goalTeam"):
            label += f" (сет выиграл {m['goalTeam']})" if tennis else f" (гол {m['goalTeam']})"
        if tennis and m.get("scoreDetail"):
            label += f" · {m['scoreDetail']}"  # геймы по сетам и очки текущего гейма, например "6:4 3:3 · 15:30"

        divider = not is_start
        cap_style = DIVIDER_CELL if divider else CAPTION_CELL
        cap_bg = DIVIDER_BG if divider else NAVY
        cap_line = LINE if divider else colors.white

        cap_row = len(journal_rows)
        journal_rows.append([Paragraph(label, cap_style)] + [""] * (n_cols - 1))
        journal_cmds += [
            ("SPAN", (0, cap_row), (-1, cap_row)),
            ("BACKGROUND", (0, cap_row), (-1, cap_row), cap_bg),
            ("LINEBELOW", (0, cap_row), (-1, cap_row), 0.6, cap_line),
            ("TOPPADDING", (0, cap_row), (-1, cap_row), 3),
            ("BOTTOMPADDING", (0, cap_row), (-1, cap_row), 3),
            ("LEFTPADDING", (0, cap_row), (-1, cap_row), 8),
        ]

        best = best_prices(m["prices"])
        directions = {}
        if prev is not None:
            for bk in bookmakers:
                bk_prices = m["prices"].get(bk)
                prev_bk = prev.get(bk)
                for outcome, _lab in OUTCOMES:
                    price = bk_prices.get(outcome) if bk_prices else None
                    prev_price = prev_bk.get(outcome) if prev_bk else None
                    if price is not None and prev_price is not None:
                        d = round(price - prev_price, 2)
                        if abs(d) > 0.001:
                            directions[(outcome, bk)] = "up" if d > 0 else "down"

        moment_unavailable = set(m.get("unavailableNow", []))
        for outcome, olabel in OUTCOMES:
            row_idx = len(journal_rows)
            row = [olabel]
            for c, bk in enumerate(bookmakers, start=1):
                bk_prices = m["prices"].get(bk)
                price = bk_prices.get(outcome) if bk_prices else None
                if price is None:
                    # тот же фикс, что в snapshot_table выше - "-*" отличает
                    if bk in moment_unavailable:
                        row.append("—*")
                        journal_cmds.append(("TEXTCOLOR", (c, row_idx), (c, row_idx), UNAVAILABLE_TEXT))
                        journal_cmds.append(("FONTNAME", (c, row_idx), (c, row_idx), "DejaVu-Bold"))
                    else:
                        row.append("—")
                    continue
                row.append(f"{price:.2f}")
                is_best = best[outcome] is not None and abs(price - best[outcome]) < 0.001
                direction = directions.get((outcome, bk))
                if is_best:
                    journal_cmds.append(("BACKGROUND", (c, row_idx), (c, row_idx), BEST_BG))
                    journal_cmds.append(("BOX", (c, row_idx), (c, row_idx), 0.7, BEST_BORDER))
                    journal_cmds.append(("FONTNAME", (c, row_idx), (c, row_idx), "DejaVu-Bold"))
                if direction == "up":
                    journal_cmds.append(("TEXTCOLOR", (c, row_idx), (c, row_idx), UP_TEXT))
                    journal_cmds.append(("FONTNAME", (c, row_idx), (c, row_idx), "DejaVu-Bold"))
                elif direction == "down":
                    journal_cmds.append(("TEXTCOLOR", (c, row_idx), (c, row_idx), DOWN_TEXT))
                    journal_cmds.append(("FONTNAME", (c, row_idx), (c, row_idx), "DejaVu-Bold"))
            journal_rows.append(row)
            journal_cmds += [
                ("FONTNAME", (0, row_idx), (0, row_idx), "DejaVu-Bold"),
                ("FONTSIZE", (0, row_idx), (-1, row_idx), num_font),
                ("TEXTCOLOR", (0, row_idx), (0, row_idx), NAVY),
                ("ALIGN", (1, row_idx), (-1, row_idx), "CENTER"),
                ("TOPPADDING", (0, row_idx), (-1, row_idx), row_pad),
                ("BOTTOMPADDING", (0, row_idx), (-1, row_idx), row_pad),
                ("INNERGRID", (0, row_idx), (-1, row_idx), 0.4, LINE),
            ]

        prev = m["prices"]

    journal_table = Table(journal_rows, colWidths=col_w, repeatRows=1)
    journal_cmds += [("LEFTPADDING", (1, 0), (-1, -1), 1), ("RIGHTPADDING", (1, 0), (-1, -1), 1)]
    journal_table.setStyle(TableStyle(journal_cmds))
    story.append(journal_table)

    doc.build(story, onFirstPage=header_bar, onLaterPages=header_bar)
    print(f"OK {out_path}")

if __name__ == "__main__":
    main()
