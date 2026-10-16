# SALESCOPE · 매장 판매 대시보드

Supabase DB의 판매 실적을 조회하고 변경을 자동 반영하는 한국어 대시보드입니다. 기간·지역·매장·상품군 필터, 매출·수량·건수·건당 평균, 월별·일별 추이, 상품군 비중, 매장 순위, 지역 실적, 검색·정렬·페이지 이동·CSV 다운로드를 제공합니다.

## 실행

Node.js 22 이상을 사용합니다.

```sh
npm ci
cp .env.example .env
# .env에 프로젝트 URL과 브라우저용 publishable 또는 anon 키 입력
npm start
```

서버 기본 포트는 8000입니다. `HOST`와 `PORT`로 변경할 수 있습니다. `npm start`는 실행할 때마다 빌드하며 `.env`와 소스 파일을 웹에 노출하지 않고 `dist/`만 제공합니다.

Supabase 설정이 모두 없으면 **엑셀 샘플 모드**로 실행합니다. DB 설정 후 조회가 실패하면 오류와 마지막 동기화 상태를 표시하며, 샘플 데이터로 대체하지 않습니다. URL이나 키 하나만 설정되면 빌드를 중단합니다.

## Supabase 프로젝트 설정

요청된 프로젝트 URL은 `.env.example`에 기록되어 있습니다. 공개용 키는 Supabase Project Settings의 API 항목에서 확인해 `.env` 또는 배포 환경 변수에 설정합니다. 비밀 키, DB 비밀번호, `service_role`, `sb_secret_...` 키를 브라우저에 넣지 마세요. 빌드는 publishable 또는 `role=anon` 키만 허용합니다.

지원하는 설정:

- `NEXT_PUBLIC_SUPABASE_URL` 또는 `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` 중 하나
- `SUPABASE_SCHEMA` (기본 `public`), `SUPABASE_TABLE` (기본 `sales`)
- 기존 컬럼명이 다르면 `SUPABASE_COLUMNS` JSON으로 매핑 (`.env.example` 참조)

키는 브라우저에 공개되는 용도입니다. 접근 제어는 DB의 RLS 및 로그인 계정 권한으로 적용합니다. 환경 파일·토큰·생성된 `dist/`는 Git에서 제외합니다.

### 새 테이블 생성과 초기 데이터

**아래 SQL 파일은 원격 프로젝트에 자동 적용되지 않습니다.** 프로젝트 관리 접근이 있는 계정으로 Supabase SQL Editor에서 순서대로 실행합니다.

1. [001_create_sales.sql](supabase/001_create_sales.sql): `public.sales`, 조회 계정 목록 `public.dashboard_readers`, RLS와 읽기 정책, 인덱스, Supabase Realtime publication을 생성합니다. 기존 동명 테이블이 있으면 덮어쓰지 않고 트랜잭션이 실패합니다.
2. [002_seed_sales.sql](supabase/002_seed_sales.sql): 엑셀의 1,017건을 초기 입력합니다. 기존 데이터가 있으면 중단하여 중복 입력을 막습니다. 실제 중복 의심 행은 원본대로 유지합니다.
3. Supabase Authentication에서 대시보드를 사용할 계정을 생성한 다음, 해당 User UID를 사용해 SQL Editor에서 조회 권한을 부여합니다.

```sql
-- <USER_UUID>를 Authentication에서 확인한 실제 UID로 바꿉니다.
insert into public.dashboard_readers (user_id)
values ('<USER_UUID>')
on conflict do nothing;
```

익명 사용자는 판매 데이터를 읽을 수 없습니다. 로그인만으로도 권한을 얻지 않으며 `dashboard_readers`에 등록된 계정만 조회할 수 있습니다. 클라이언트에는 쓰기 권한을 부여하지 않습니다. Supabase Table Editor나 승인된 서버에서 판매 데이터를 입력·수정·삭제하면 대시보드에 반영됩니다. 읽기 계정을 제거하면 다음 동기화부터 데이터가 보이지 않습니다. 기존 프로젝트 정책이 있다면 필요에 맞게 별도 검토해야 합니다.

## 실시간 동작

- Supabase 공식 JS SDK를 로컬 번들로 제공하며 외부 CDN에 의존하지 않습니다.
- DB를 고유 ID 순서로 페이지 조회하여 기본 1,000행 제한에 의한 합계 누락을 방지합니다. 10만행 수준의 대규모 데이터는 서버 집계로 전환해야 하며, 조회가 불완전하면 부분 합계를 표시하지 않습니다.
- `INSERT`·`UPDATE`·`DELETE` 이벤트를 받으면 전체 조회 후 지표와 차트를 함께 갱신합니다. 짧은 시간의 이벤트는 묶어서 처리합니다.
- 실시간 재연결, 온라인 복귀, 탭 복귀 시 재조회합니다. 이벤트 누락에 대비해 보이는 탭에서 30초마다 동기화합니다.
- 기간·지역·매장·상품 필터를 실제 데이터에서 생성합니다. 유효한 필터·검색·정렬·페이지는 유지하고, 사라진 선택지만 초기화합니다.
- 조회 실패 시 마지막 성공 데이터를 유지하고 동기화 시각을 한국시간으로 표시합니다. 초기 연결 실패는 숫자를 표시하지 않습니다. 빈 DB는 0건으로 표시하고 데이터와 읽기 권한 확인을 안내합니다.
- 페이지 조회는 단일 DB 트랜잭션 스냅샷이 아닙니다. 조회 중 건수 변경은 재시도하고, 같은 건수의 동시 변경은 후속 이벤트 또는 주기 조회에서 반영됩니다.
- 로그인·로그아웃 시 이전 계정의 데이터를 지우고 새 권한으로 조회합니다. 비밀번호는 저장하지 않으며, 로그인 세션은 Supabase SDK가 관리합니다.

## 집계 기준

- 판매 건수는 판매 **행 수**이며 고객 수·영수증 수가 아닙니다. 건당 평균은 총매출 ÷ 판매 행 수입니다.
- 수량 미입력은 수량 합계에서만 제외하고 매출과 건수에는 포함합니다. 수량을 추정하지 않습니다.
- 날짜·지역명·문자열 금액을 통일하며 유효하지 않은 필수 값은 전체 동기화를 실패시켜 잘못된 합계로 바뀌는 것을 막습니다. 현재 데이터 모델은 0 이상의 정수 수량·원화 매출을 지원합니다.
- 날짜·지역·매장·상품·요금제·수량·매출·담당자가 동일하면 고유 ID 순서에서 첫 행 이후를 ‘중복 의심’으로 표시합니다. 기본 합계에 포함하며 사용자가 제외할 수 있습니다.
- 상단 필터와 중복 제외는 모든 지표에, 검색은 상세 내역과 CSV에 적용합니다. 만원 단위 차트는 반올림하고 상세 내역·CSV는 원 단위를 유지합니다.

## 빌드와 배포

```sh
npm run build
```

동일한 환경 변수를 배포 빌드에 넣고 **`dist/`만** 정적 호스팅에 배포합니다. DB 설정을 바꾸면 다시 빌드·배포해야 합니다. Supabase 모드의 `dist/`에는 엑셀 샘플과 원본 파일이 포함되지 않습니다. Supabase 프로젝트에 대한 HTTPS·WebSocket 접근이 허용되어야 합니다. GitHub에 소스를 푸시하는 작업은 사이트 배포나 DB SQL 적용을 수행하지 않습니다.

## 엑셀 데이터

원본은 `data/sales-source.xlsx`, 샘플 데이터는 `data/sales.js`입니다. 원본 1,017행 / 13개 매장 / 7개 지역 / 5개 상품군의 총매출은 **515,999,400원**, 알려진 수량은 **1,722개**입니다. 수량 누락은 5건, 정규화 후 중복 의심은 18행입니다.

Python 3와 `openpyxl==3.1.5`로 샘플 데이터를 재생성합니다.

```sh
python3 -m pip install openpyxl==3.1.5
python3 scripts/import_sales.py
```

## 검증

Chromium이 `/usr/bin/chromium`에 설치되어 있어야 하며, 다른 위치면 `CHROMIUM_PATH`로 지정합니다. Python 검증에는 `openpyxl`이 필요합니다. 테스트 HTTP 서버는 자동 시작·종료됩니다.

```sh
npm test
```

- `tests/dashboard.cjs`: 원본 엑셀과 행별 대조 및 기존 대시보드 기능·모바일 검증
- `tests/realtime.cjs`: 공식 Supabase SDK를 사용하되 REST·Auth·WebSocket을 모의 응답으로 연결하여 페이지 조회, 추가·수정·삭제, 재연결, 주기 동기화, 실패 복구, 로그인·로그아웃 검증
- `tests/database.cjs`: 로컬 PostgreSQL(PGlite)에서 SQL·1,017행·합계·RLS 읽기 권한·쓰기 차단·초기 입력 재실행 방지 검증
- `tests/config.cjs`: 비밀 키 차단·부분 설정 실패·배포 파일 범위 검증

로컬·모의 테스트 결과는 실제 Supabase 프로젝트에서 SQL이 적용되거나 원격 연결이 검증되었다는 의미가 아닙니다.
