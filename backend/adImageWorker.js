const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CACHE_DIR = path.join(__dirname, '../cache/ads');
const PORT = 9333;
const CONCURRENCY = 3;
const PREVIEW_API_VERSION = 'v21.0';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => {
      const send = (method, params = {}, timeoutMs = 20000) => new Promise((res, rej) => {
        const mid = ++id;
        const timer = setTimeout(() => {
          pending.delete(mid);
          rej(new Error('CDP timeout: ' + method));
        }, timeoutMs);
        pending.set(mid, { res: (m) => { clearTimeout(timer); res(m); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        try { ws.send(JSON.stringify({ id: mid, method, params })); } catch (e) { clearTimeout(timer); rej(e); }
      });
      resolve({ ws, send, close: () => { try { ws.close(); } catch (e) {} } });
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg);
      }
    };
    ws.onerror = () => reject(new Error('CDP websocket error'));
  });
}

class AdImageWorker {
  constructor() {
    this.chrome = null;
    this.pages = [];
    this.queue = [];
    this.processing = new Set();
    this.browserReady = false;
    this.browserFailed = false;
    this.draining = false;
    this.profileDir = null;
    this.onBatchComplete = null;
    this.failed = new Set();
  }

  async ensureBrowser() {
    if (this.browserReady) return true;
    if (this.browserFailed) return false;
    if (!fs.existsSync(CHROME_PATH)) {
      console.log('[adImageWorker] Chrome not found at', CHROME_PATH, '- hi-res image worker disabled');
      this.browserFailed = true;
      return false;
    }
    console.log('[adImageWorker] ensureBrowser: spawning chrome...');
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adimg-cdp-'));    this.chrome = spawn(CHROME_PATH, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + this.profileDir,
      'about:blank'
    ], { stdio: 'ignore' });
    this.chrome.on('exit', () => { this.browserReady = false; });

    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (r.ok) { up = true; break; }
      } catch (e) {}
    }
    if (!up) {
      console.log('[adImageWorker] Chrome CDP did not come up');
      this.browserFailed = true;
      this.killChrome();
      return false;
    }

    try {
      for (let i = 0; i < CONCURRENCY; i++) {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
        const target = await res.json();
        if (target.webSocketDebuggerUrl) {
          const client = await createCdpClient(target.webSocketDebuggerUrl);
          this.pages.push(client);
        }
      }
    } catch (e) {
      console.log('[adImageWorker] page creation failed:', e.message);
      this.browserFailed = true;
      this.killChrome();
      return false;
    }

    if (!this.pages.length) {
      this.browserFailed = true;
      this.killChrome();
      return false;
    }
    this.browserReady = true;
    console.log('[adImageWorker] ready with', this.pages.length, 'pages');
    return true;
  }

  killChrome() {
    for (const p of this.pages) { try { p.close(); } catch (e) {} }
    this.pages = [];
    if (this.chrome) { try { this.chrome.kill(); } catch (e) {} this.chrome = null; }
    if (this.profileDir && fs.existsSync(this.profileDir)) {
      try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch (e) {}
      this.profileDir = null;
    }
  }

  enqueue(adId, candidateUrl = null) {
    if (this.processing.has(adId) || this.queue.includes(adId) || this.failed.has(adId)) {
      return;
    }
    this.queue.push({ adId, candidateUrl });
    this.drain();
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    this.lastProgress = Date.now();
    while (this.queue.length) {
      if (!(await this.ensureBrowser())) break;
      const batch = [];
      while (batch.length < this.pages.length && this.queue.length) {
        batch.push(this.queue.shift());
      }
      const batchDone = Promise.all(batch.map(async (item, i) => {
        const { adId, candidateUrl } = item;
        this.processing.add(adId);
        const client = this.pages[i % this.pages.length];
        try {
          const out = await Promise.race([
            this.processOne(client, adId, candidateUrl),
            new Promise(res => setTimeout(() => res('__TIMEOUT__'), 90000))
          ]);
          if (out === '__TIMEOUT__') {
            console.log('[adImageWorker]', adId, '-> timed out after 90s');
            this.failed.add(adId);
          } else if (out) {
            console.log('[adImageWorker]', adId, '->', path.basename(out));
          } else {
            console.log('[adImageWorker]', adId, '-> no hi-res image');
            this.failed.add(adId);
          }
        } catch (e) {
          console.log('[adImageWorker]', adId, 'error:', e.message.slice(0, 100));
        } finally {
          this.processing.delete(adId);
        }
      }));
      const guard = new Promise(res => setTimeout(() => {
        for (const { adId } of batch) this.processing.delete(adId);
        res('__GUARD__');
      }, 130000));
      const result = await Promise.race([batchDone, guard]);
      if (result === '__GUARD__') {
        console.log('[adImageWorker] batch guard fired after 130s, resetting browser; requeueing', batch.length);
        this.killChrome();
        this.browserReady = false;
        this.queue.unshift(...batch);
        continue;
      }
      this.lastProgress = Date.now();
      if (batch.length && this.onBatchComplete) {
        try { this.onBatchComplete(); } catch (e) {}
      }
    }
    this.draining = false;
  }

  async downloadToDisk(url, out) {
    try {
      const img = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
      });
      if (!img.ok) return false;
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length < 20000) return false;
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(out, buf);
      return true;
    } catch (e) {
      return false;
    }
  }

  async processOne(client, adId, candidateUrl = null) {
    const out = path.join(CACHE_DIR, adId + '.jpg');
    const txtOut = path.join(CACHE_DIR, adId + '.txt');
    const needImage = !fs.existsSync(out);
    const needText = !fs.existsSync(txtOut);
    if (!needImage && !needText) return out;

    if (needImage && candidateUrl) {
      const direct = await this.downloadToDisk(candidateUrl, out);
      if (direct && !needText) return out;
    }

    const formats = needImage
      ? ['DESKTOP_FEED_STANDARD', 'FACEBOOK_REELS_MOBILE', 'INSTAGRAM_STORY', 'INSTAGRAM_REELS']
      : ['DESKTOP_FEED_STANDARD', 'FACEBOOK_REELS_MOBILE'];

    for (const fmt of formats) {
      const previewUrl = `https://graph.facebook.com/${PREVIEW_API_VERSION}/${adId}/previews?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}&ad_format=${fmt}`;
      let body = null;
      try {
        const p = await (await fetch(previewUrl)).json();
        body = p.data && p.data[0] && p.data[0].body;
      } catch (e) {}
      const m = body && body.match(/src="([^"]+)"/);
      if (!body || !m) continue;
      const iframeUrl = m[1].replace(/&amp;/g, '&');

      try { await client.send('Page.navigate', { url: iframeUrl }); } catch (e) { continue; }

      const src = await this.findImageSrc(client, fmt);
      if (needImage && src) {
        const ok = await this.downloadToDisk(src, out);
        if (ok && !needText) return out;
      }

      if (needText) {
        const txt = await this.findText(client);
        if (txt) {
          if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
          fs.writeFileSync(txtOut, txt);
          if (!needImage || fs.existsSync(out)) return out;
        }
      }

      if (!needText && !fs.existsSync(out)) {
        const frame = await this.captureVideoFrame(client);
        if (frame) {
          if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
          fs.writeFileSync(out, frame);
          return out;
        }
      }
      if (fs.existsSync(out) && !needText) return out;
    }
    return fs.existsSync(out) || fs.existsSync(txtOut) ? out : null;
  }

  async findImageSrc(client, fmt) {
    const feedSelector = `(()=>{const el=document.querySelector('img[data-imgperflogname="feedImage"]');return el?el.src:null;})()`;
    const reelSelector = `(()=>{const imgs=Array.from(document.querySelectorAll('img')).map(i=>i.src).filter(s=>s&&s.includes('fbcdn.net')&&/t45\\.|p640|p720|p1080/.test(s));if(imgs.length)return imgs.sort((a,b)=>b.length-a.length)[0];const v=document.querySelector('video');return v?(v.poster||v.currentSrc||v.src):null;})()`;
    const expr = fmt === 'DESKTOP_FEED_STANDARD' ? feedSelector : reelSelector;
    try {
      for (let i = 0; i < 40; i++) {
        await sleep(300);
        const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true });
        const val = r.result && r.result.result && r.result.result.value;
        if (val && val.startsWith('http')) return val;
      }
    } catch (e) {}
    return null;
  }

  async findText(client) {
    try {
      const r = await client.send('Runtime.evaluate', {
        expression: `(()=>{
          const cls='x1l90r2v x1iorvi4 x1g0dm76 xpdmqnj';
          for(const e of document.querySelectorAll('div')){
            if((e.className||'').toString()===cls){
              let t=(e.textContent||'').replace(/\\s+/g,' ').trim();
              if(t.length>10&&!/cookies|Meta Products/i.test(t)){
                t=t.replace(/\\s*…\\s*See more$/,'').replace(/\\s*See more$/,'');
                return t;
              }
            }
          }
          let best=null;
          const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT);
          let n;
          while(n=walker.nextNode()){
            if(n.tagName==='SCRIPT'||n.tagName==='STYLE') continue;
            if(n.querySelector('div,section,p')) continue;
            const t=(n.textContent||'').replace(/\\s+/g,' ').trim();
            if(t.length<60) continue;
            if(/cookies|Meta Products|Learn more|Follow|Sponsored|Reels|advertis|cookie|Account Centre|control your information|requireLazy/i.test(t)) continue;
            if(!best||t.length>best.length) best=t;
          }
          if(best) best=best.replace(/\\s*…\\s*more$/,'').replace(/\\s*See more$/,'');
          return best;
        })()`,
        returnByValue: true
      });
      const val = r.result && r.result.result && r.result.result.value;
      return val || null;
    } catch (e) {
      return null;
    }
  }

  async captureVideoFrame(client) {
    try {
      const r = await client.send('Runtime.evaluate', {
        expression: `(()=>{const v=document.querySelector('video');if(!v)return null;try{v.muted=true;}catch(e){}try{v.play().catch(()=>{});v.currentTime=0.5;}catch(e){}const b=v.getBoundingClientRect();if(!b.width||!b.height)return null;return {x:b.x,y:b.y,w:b.width,h:b.height};})()`,
        returnByValue: true
      });
      const rect = r.result && r.result.result && r.result.result.value;
      if (!rect || !rect.w || !rect.h) return null;
      await sleep(2500);
      const shot = await client.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 80,
        clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 }
      });
      const data = shot.result && shot.result.data;
      if (!data) return null;
      const buf = Buffer.from(data, 'base64');
      return buf.length >= 20000 ? buf : null;
    } catch (e) {
      return null;
    }
  }
}

const worker = new AdImageWorker();
process.on('exit', () => worker.killChrome());
process.on('SIGTERM', () => { worker.killChrome(); process.exit(0); });
process.on('SIGINT', () => { worker.killChrome(); process.exit(0); });
process.on('SIGQUIT', () => {
  console.log('[adImageWorker] SIGQUIT state dump: queue=' + worker.queue.length,
    'processing=' + Array.from(worker.processing).join(','),
    'draining=' + worker.draining,
    'browserReady=' + worker.browserReady,
    'browserFailed=' + worker.browserFailed,
    'pages=' + worker.pages.length);
});

let watchdogStarted = false;
function startWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(() => {
    if (!worker.draining) return;
    const idle = Date.now() - (worker.lastProgress || 0);
    console.log('[adImageWorker] heartbeat queue=' + worker.queue.length,
      'processing=' + Array.from(worker.processing).join(','),
      'idleMs=' + idle);
    if (worker.queue.length && idle > 200000) {
      console.log('[adImageWorker] watchdog: no progress in 200s, resetting browser');
      worker.killChrome();
      worker.browserReady = false;
    }
  }, 30000);
}
startWatchdog();

module.exports = { worker, CACHE_DIR };