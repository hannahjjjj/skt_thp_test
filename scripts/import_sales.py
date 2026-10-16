"""Regenerate the browser dataset: python3 scripts/import_sales.py (openpyxl required)."""
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
REGIONS = {
    "서울": "서울", "경기": "경기", "부산": "부산", "인천": "인천",
    "대구": "대구", "광주": "광주", "대전": "대전",
}


def normalize_date(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (float, int)):
        return datetime.strptime(str(int(value)), "%Y%m%d").strftime("%Y-%m-%d")
    return datetime.strptime(str(value), "%Y.%m.%d").strftime("%Y-%m-%d")


def main():
    sheet = openpyxl.load_workbook(ROOT / "data/sales-source.xlsx", data_only=True).active
    rows = []
    seen = Counter()
    for row_number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), 2):
        date, region, store, product, plan, quantity, revenue, staff = row
        if all(value is None for value in row):
            continue
        normalized_region = next((label for prefix, label in REGIONS.items() if region.startswith(prefix)), region)
        normalized_revenue = int(re.sub(r"[,원\s]", "", revenue)) if isinstance(revenue, str) else int(revenue)
        item = dict(id=row_number, date=normalize_date(date), region=normalized_region,
                    store=store, product=product, plan=plan, quantity=int(quantity) if quantity is not None else None,
                    revenue=normalized_revenue, staff=staff)
        key = tuple(item[k] for k in ("date", "region", "store", "product", "plan", "quantity", "revenue", "staff"))
        item["duplicate"] = seen[key] > 0
        seen[key] += 1
        rows.append(item)
    payload = dict(source="매장판매실적.xlsx", sheet=sheet.title, rows=rows)
    text = "// Generated from data/sales-source.xlsx by scripts/import_sales.py.\nwindow.SALES_DATA = "
    (ROOT / "data/sales.js").write_text(text + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps(dict(rows=len(rows), revenue=sum(r["revenue"] for r in rows),
                          quantity=sum(r["quantity"] or 0 for r in rows),
                          duplicates=sum(r["duplicate"] for r in rows),
                          missing_quantity=sum(r["quantity"] is None for r in rows)), ensure_ascii=False))


if __name__ == "__main__":
    main()
