const express = require('express');
const app = express();
const rawJpeg = express.raw({ type: 'image/jpeg', limit: '3mb' });

let photoRequested = false;
let lastPhoto = null;
let camLastSeen = 0;
let waiters = [];
const streamClients = new Set();

// Commande a donner a l'ESP32
function currentCmd() {
  if (photoRequested) { photoRequested = false; return 'photo'; }
  return streamClients.size > 0 ? 'stream' : 'idle';
}

// L'ESP32 demande s'il y a une commande
app.get('/api/cmd', (req, res) => {
  camLastSeen = Date.now();
  res.type('text').send(currentCmd());
});

// L'ESP32 envoie UNE photo
app.post('/api/photo', rawJpeg, (req, res) => {
  camLastSeen = Date.now();
  lastPhoto = req.body;
  waiters.forEach((w) => w.done());
  waiters = [];
  res.type('text').send('ok');
});

// L'ESP32 envoie une image du streaming
app.post('/api/frame', rawJpeg, (req, res) => {
  camLastSeen = Date.now();
  const f = req.body;
  for (const c of streamClients) {
    if (c.writableLength > 500000) continue; // navigateur trop lent
    c.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`);
    c.write(f);
    c.write('\r\n');
  }
  res.type('text').send(currentCmd()); // renvoie "stream" ou "idle" ou "photo"
});

// La page demande une photo et attend qu'elle arrive
app.post('/api/take', (req, res) => {
  photoRequested = true;
  const w = {
    done: () => { clearTimeout(w.t); res.json({ ok: true }); },
  };
  w.t = setTimeout(() => {
    waiters = waiters.filter((x) => x !== w);
    if (waiters.length === 0) photoRequested = false;
    res.status(504).json({ ok: false });
  }, 20000);
  waiters.push(w);
});

app.get('/photo.jpg', (req, res) => {
  if (!lastPhoto) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  res.send(lastPhoto);
});

// Flux video pour la page
app.get('/stream.mjpg', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  streamClients.add(res);
  req.on('close', () => streamClients.delete(res));
});

app.get('/api/status', (req, res) => {
  res.json({ online: Date.now() - camLastSeen < 5000 });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Serveur sur le port ' + PORT));
