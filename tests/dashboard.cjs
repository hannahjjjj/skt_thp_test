const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const expected = JSON.parse(execFileSync('python3', ['tests/verify_data.py'], {cwd: root, encoding: 'utf8'})).rows;
execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_ANON_KEY:'',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:''}});
const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], {cwd: path.join(root,'dist'), stdio: 'ignore'});
let browser;
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
(async () => {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:8765')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const page = await browser.newPage({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765');
  await page.waitForSelector('#sales-body tr');
  async function metricsMatch(rows) {
    const metric = async id => Number((await page.locator(id).innerText()).replace(/[^0-9]/g, ''));
    check(await metric('#total-revenue') === rows.reduce((n,r) => n+r.revenue,0), 'Revenue matches workbook');
    check(await metric('#total-quantity') === rows.reduce((n,r) => n+(r.quantity||0),0), 'Quantity matches workbook');
    check(await metric('#total-count') === rows.length, 'Record count matches workbook');
    check(await metric('#average-revenue') === (rows.length ? Math.round(rows.reduce((n,r)=>n+r.revenue,0)/rows.length) : 0), 'Average matches workbook');
  }
  await metricsMatch(expected);
  check(await page.locator('.ranking-name').first().innerText() === Object.entries(expected.reduce((a,r)=>(a[r.store]=(a[r.store]||0)+r.revenue,a),{})).sort((a,b)=>b[1]-a[1])[0][0], 'Store ranking correct');
  check(await page.locator('#region-body tr').count() === 7, 'All seven regions shown');
  check(await page.locator('.product-legend-row').count() === 5, 'All five products shown');
  await page.screenshot({path:'/tmp/salescope-desktop.png', fullPage:true});
  await page.selectOption('#month', '2026-08');
  await metricsMatch(expected.filter(r=>r.date.startsWith('2026-08')));
  await page.selectOption('#region', '서울');
  check(await page.locator('#store option').count() === 5, 'Region narrows stores');
  await page.selectOption('#store', '강남점');
  await page.selectOption('#product', '기기');
  const selected = expected.filter(r=>r.date.startsWith('2026-08') && r.region==='서울' && r.store==='강남점' && r.product==='기기');
  await metricsMatch(selected);
  await page.selectOption('#region', '부산');
  check(await page.locator('#store').inputValue() === '', 'Incompatible store cleared');
  await metricsMatch(expected.filter(r=>r.date.startsWith('2026-08') && r.region==='부산' && r.product==='기기'));
  await page.getByRole('button', {name:'모든 필터 초기화'}).click();
  await page.locator('#exclude-duplicates').check();
  await metricsMatch(expected.filter(r=>!r.duplicate));
  await page.getByRole('button', {name:'모든 필터 초기화'}).click();
  await metricsMatch(expected);
  await page.locator('[data-granularity="day"]').click();
  check(await page.locator('#trend-chart circle').count() === 92, 'Daily chart contains 92 days');
  await page.locator('[data-granularity="month"]').click();
  check(await page.locator('#trend-chart circle').count() === 3, 'Monthly chart contains three months');
  await page.locator('#next-page').click();
  check(await page.locator('#page-info').innerText() === '전체 1,017건 중 11–20건 표시', 'Pagination advances');
  await page.locator('#prev-page').click();
  check(await page.locator('#prev-page').isDisabled(), 'First page previous disabled');
  await page.locator('[data-sort="revenue"]').click();
  check(Number((await page.locator('#sales-body tr').first().locator('td').nth(5).innerText()).replace(/[^0-9]/g,'')) === Math.max(...expected.map(r=>r.revenue)), 'Revenue sort descending');
  await page.locator('[data-sort="revenue"]').click();
  check(Number((await page.locator('#sales-body tr').first().locator('td').nth(5).innerText()).replace(/[^0-9]/g,'')) === Math.min(...expected.map(r=>r.revenue)), 'Revenue sort ascending');
  await page.locator('#search').fill('오지민');
  const staff = expected.filter(r=>r.staff==='오지민');
  check((await page.locator('#table-count').innerText()) === `${staff.length}건`, 'Search finds staff');
  await metricsMatch(expected); // Table search does not change summary metrics.
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  const csv = await fs.readFile(await download.path(), 'utf8');
  check(csv.startsWith('\uFEFF'), 'CSV has Excel-compatible UTF-8 BOM');
  check(csv.split('\r\n').length === staff.length+1, 'CSV exports all matching pages');
  check(csv.split('\r\n').slice(1).every(r=>r.includes('오지민')), 'CSV respects search');
  await page.locator('#search').fill('검색결과가없는문자열');
  check((await page.locator('#sales-body').innerText()).includes('검색 결과가 없습니다'), 'Empty search state');
  check(await page.locator('#next-page').isDisabled(), 'Empty search pagination disabled');
  await page.locator('#export').click();
  check((await page.locator('#toast').innerText()).includes('다운로드할 판매 내역이 없습니다'), 'Empty export explained');
  await page.getByRole('button', {name:'모든 필터 초기화'}).click();
  // Verify zero-data charts without mutating the source dataset.
  await page.locator('#month').evaluate(el=>el.add(new Option('데이터 없는 기간','2026-10')));
  await page.selectOption('#month','2026-10');
  await metricsMatch([]);
  check((await page.locator('#trend-chart').innerText()).includes('조건에 맞는 데이터가 없습니다'), 'Empty chart handled');
  await page.getByRole('button', {name:'모든 필터 초기화'}).click();
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({width,height:1000});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), `No page overflow at ${width}px`);
    check(await page.locator('#total-revenue').isVisible(), `Metrics visible at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#toast').evaluate(el => el.hidden = true);
  await page.screenshot({path:'/tmp/salescope-mobile.png',fullPage:true});
  await page.selectOption('#month','2026-09');
  await metricsMatch(expected.filter(r=>r.date.startsWith('2026-09')));
  check(errors.length===0, 'No JavaScript runtime errors: '+errors.join(', '));
  console.log(`PASS: workbook row-by-row validation and ${checks} browser checks. Screenshots: /tmp/salescope-desktop.png, /tmp/salescope-mobile.png`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser) await browser.close();server.kill();});
