import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const output = path.join(root, 'dist');

export async function buildDashboard() {
  let local = {};
  try { local = parseEnv(await readFile(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = { ...local, ...process.env };
  const url = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim() || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';
  if (Boolean(url) !== Boolean(publicKey)) throw new Error('SUPABASE_URL과 브라우저용 SUPABASE_PUBLISHABLE_KEY를 함께 설정하세요.');
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('Supabase URL은 HTTPS여야 합니다.');
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Supabase 프로젝트 기본 URL을 사용하세요.');
    let isAnon = false;
    try { isAnon = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
    if (!publicKey.startsWith('sb_publishable_') && !isAnon) throw new Error('브라우저에는 publishable 또는 anon 키만 사용할 수 있습니다. service_role / secret 키는 사용할 수 없습니다.');
  }
  const columns = { id:'id', date:'sale_date', region:'region', store:'store', product:'product', plan:'plan', quantity:'quantity', revenue:'revenue', staff:'staff', ...JSON.parse(env.SUPABASE_COLUMNS || '{}') };
  for (const value of [env.SUPABASE_SCHEMA || 'public', env.SUPABASE_TABLE || 'sales']) {
    if (typeof value !== 'string' || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(value)) throw new Error('스키마·테이블명 설정을 확인하세요.');
  }
  for (const value of Object.values(columns)) {
    if (typeof value !== 'string' || !/^[\p{L}_][\p{L}\p{N}_ ()·-]*$/u.test(value)) throw new Error('컬럼명 설정을 확인하세요.');
  }
  const config = { mode: url ? 'supabase' : 'demo', url, publicKey, schema:env.SUPABASE_SCHEMA || 'public', table:env.SUPABASE_TABLE || 'sales', columns };
  await rm(output, {recursive:true, force:true});
  await mkdir(path.join(output, 'vendor'), {recursive:true});
  for (const file of ['index.html','styles.css','app.js','sales-client.js']) await copyFile(path.join(root,file),path.join(output,file));
  if (!url) {
    await mkdir(path.join(output,'data'));
    await copyFile(path.join(root,'data/sales.js'),path.join(output,'data/sales.js'));
  } else {
    const html = (await readFile(path.join(output,'index.html'),'utf8')).replace('  <script src="data/sales.js" defer></script>\n','');
    await writeFile(path.join(output,'index.html'),html);
  }
  await writeFile(path.join(output,'runtime-config.js'), 'window.SALES_CONFIG = '+JSON.stringify(config)+';\n');
  await build({stdin:{contents:'export { createClient } from "@supabase/supabase-js";',resolveDir:root}, bundle:true, minify:true, format:'iife',globalName:'SalesSupabase',outfile:path.join(output,'vendor/supabase.js'),platform:'browser',target:['es2022'],legalComments:'eof'});
  console.log(`Dashboard built (${config.mode === 'demo' ? 'Excel demo' : 'Supabase'} mode).`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildDashboard();
