import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDashboard, output } from './build.mjs';

await buildDashboard();
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server = createServer(async(req,res)=>{
  try {
    const url = new URL(req.url, 'http://localhost');
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(output, '.'+requested);
    if (!file.startsWith(output + path.sep) || !types[path.extname(file)] || !['GET','HEAD'].includes(req.method)) {res.writeHead(404);res.end();return;}
    const content = await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {res.writeHead(404);res.end();}
});
const port = Number(process.env.PORT || 8000);
server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Dashboard server listening on port ${port}.`));
