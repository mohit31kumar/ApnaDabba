const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4004;
const ROLE = process.env.ROLE || 'mimo';

const OPENCODE_PORTS = [4000, 4001, 4002, 4003];

const INBOX_DIR = path.join(__dirname, 'inboxes');
if (!fs.existsSync(INBOX_DIR)) fs.mkdirSync(INBOX_DIR, { recursive: true });

const SESSION_ID = `mimo-${ROLE}-session`;
const MIMO_TITLE = `mimo-${ROLE}`;

const HEALTH_RESPONSE = JSON.stringify({ healthy: true, version: `mimo-bridge-1.0-${ROLE}` });

const MIMO_SESSION = {
  id: SESSION_ID,
  title: MIMO_TITLE,
  projectID: '009a22adc4064e1f99080bbee4cca6219ad43fdc',
  directory: '/home/mohit/Desktop/ApnaDabba',
  agent: 'build',
  model: { id: 'mimo-auto', providerID: 'mimocode' },
  parentID: null,
  time: { created: Date.now(), updated: Date.now() }
};

function fetchJSON(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function getMergedSessions() {
  const otherSessions = [];
  for (const port of OPENCODE_PORTS) {
    const sessions = await fetchJSON(`http://127.0.0.1:${port}/session?limit=10`);
    if (Array.isArray(sessions)) {
      otherSessions.push(...sessions.filter(s => !s.parentID));
      break;
    }
  }
  const mimoSessions = otherSessions.filter(s => s.title?.toLowerCase() !== ROLE.toLowerCase());
  return [MIMO_SESSION, ...mimoSessions];
}

function writeInbox(text) {
  const inboxFile = path.join(INBOX_DIR, `mimo-${ROLE}.inbox.jsonl`);
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), text }) + '\n';
  fs.appendFileSync(inboxFile, entry);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/global/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(HEALTH_RESPONSE);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/session') {
    const sessions = await getMergedSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/session/') && url.pathname.endsWith('/prompt_async')) {
    const sessionPart = url.pathname.split('/')[2];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const text = data.parts?.[0]?.text || '';

        if (sessionPart === SESSION_ID) {
          writeInbox(text);
          console.log(`[${ROLE}] Received: ${text.substring(0, 100)}...`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          let forwarded = false;
          for (const port of OPENCODE_PORTS) {
            const health = await fetchJSON(`http://127.0.0.1:${port}/global/health`);
            if (health?.healthy) {
              const fwdReq = http.request({
                hostname: '127.0.0.1',
                port,
                path: `/session/${sessionPart}/prompt_async`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              }, (fwdRes) => {
                res.writeHead(fwdRes.statusCode, { 'Content-Type': 'application/json' });
                fwdRes.pipe(res);
              });
              fwdReq.on('error', () => {
                res.writeHead(502);
                res.end(JSON.stringify({ error: 'forward failed' }));
              });
              fwdReq.write(body);
              fwdReq.end();
              forwarded = true;
              break;
            }
          }
          if (!forwarded) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: 'no opencode instance available' }));
          }
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[${ROLE}] MiMo bridge server running on port ${PORT}`);
});
