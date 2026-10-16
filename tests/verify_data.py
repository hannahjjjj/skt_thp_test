"""Validate every imported row and independent workbook totals; emit browser expectations."""
import collections
import datetime
import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
source = list(openpyxl.load_workbook(ROOT / 'data/sales-source.xlsx', data_only=True).active.values)
assert source[0] == ('판매일', '지역', '매장명', '상품군', '요금제', '수량', '매출액(원)', '담당자')
raw = (ROOT / 'data/sales.js').read_text(encoding='utf-8')
actual = json.loads(raw.split('window.SALES_DATA = ', 1)[1].rstrip(';\n'))['rows']
assert len(source) - 1 == len(actual) == 1017
regions = ['서울', '경기', '부산', '대구', '인천', '대전', '광주']
expected = []
seen = set()
for row_id, cells in enumerate(source[1:], 2):
    date, region, store, product, plan, quantity, revenue, staff = cells
    if isinstance(date, datetime.datetime):
        day = date.date().isoformat()
    else:
        text = str(int(date)) if isinstance(date, (int, float)) else date
        if '.' in text:
            year, month, day_number = map(int, text.split('.'))
        else:
            year, month, day_number = int(text[:4]), int(text[4:6]), int(text[6:8])
        day = datetime.date(year, month, day_number).isoformat()
    region = next(r for r in regions if region.startswith(r))
    amount = int(str(revenue).replace('원', '').replace(',', '').split('.')[0])
    record = dict(id=row_id, date=day, region=region, store=store, product=product,
                  plan=plan, quantity=int(quantity) if quantity is not None else None,
                  revenue=amount, staff=staff)
    signature = tuple(record[k] for k in record if k != 'id')
    record['duplicate'] = signature in seen
    seen.add(signature)
    expected.append(record)
assert actual == expected, 'Imported rows differ from workbook'
assert sum(r['revenue'] for r in expected) == 515999400
assert sum(r['quantity'] or 0 for r in expected) == 1722
assert sum(r['quantity'] is None for r in expected) == 5
assert sum(r['duplicate'] for r in expected) == 18
assert min(r['date'] for r in expected) == '2026-07-01'
assert max(r['date'] for r in expected) == '2026-09-30'
assert len({r['store'] for r in expected}) == 13
print(json.dumps({'rows': expected}, ensure_ascii=False))
