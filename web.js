// Sirve la pantalla de Windows como video MJPEG para abrirlo en el navegador de la tele.
// Uso: node web.js [--monitor 0] [--fps 15] [--w 1280] [--h 720] [--q 5] [--port 8080]
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);
const monitor = args.monitor || 0;
const fps = args.fps || 12;
const W = args.w || 960;
const H = args.h || 540;
const Q = args.q || 9; // calidad JPEG: 2 (mejor) .. 31 (peor). Menos datos = menos retraso por Wi-Fi
const PORT = Number(args.port || 8080);

function localIp() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list) if (n.family === 'IPv4' && !n.internal && n.address.startsWith('192.168.')) return n.address;
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list) if (n.family === 'IPv4' && !n.internal) return n.address;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Pantalla</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
img{position:fixed;inset:0;width:100%;height:100%;object-fit:contain}</style></head>
<body><img id="v" src="/stream.mjpg">
<script>
var v=document.getElementById('v');
// si se corta el flujo, reconectar
v.onerror=function(){setTimeout(function(){v.src='/stream.mjpg?'+Date.now()},1000)};
</script></body></html>`;

const clients = new Set();

function handler(req, res) {
    const p = req.url.split('?')[0];
    console.log(new Date().toLocaleTimeString(), req.socket.remoteAddress, req.method, req.url, '|', (req.headers['user-agent'] || '').slice(0, 90));
    if (p === '/stream.mjpg') {
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store',
        Connection: 'close',
        Pragma: 'no-cache',
      });
      req.socket.setNoDelay(true); // enviar de inmediato, sin juntar paquetes (menos retraso)
      clients.add(res);
      console.log(new Date().toLocaleTimeString(), 'espectador conectado:', req.socket.remoteAddress, `(${clients.size})`);
      req.on('close', () => { clients.delete(res); console.log('espectador desconectado', `(${clients.size})`); });
    } else if (p === '/live.ts') {
      tsStream(req, res);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    }
}

// H.264 en MPEG-TS por HTTP: menos retraso y mas fluido que MJPEG en VLC. Un ffmpeg por espectador.
function tsStream(req, res) {
  const ext = findExtendedScreen();
  const tsFps = String(args.tsfps || 30);
  const TW = args.tw || 1280, TH = args.th || 720, BR = args.br || '4M';
  let input, pre = '';
  if (ext) {
    input = ['-f', 'gdigrab', '-framerate', tsFps, '-draw_mouse', '1',
      '-offset_x', String(ext.x), '-offset_y', String(ext.y), '-video_size', `${ext.w}x${ext.h}`, '-i', 'desktop'];
  } else {
    input = ['-f', 'lavfi', '-i', `ddagrab=output_idx=${monitor}:framerate=${tsFps}:draw_mouse=1`];
    pre = 'hwdownload,format=bgra,';
  }
  const f = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', ...input,
    '-vf', `${pre}scale=${TW}:${TH}:force_original_aspect_ratio=decrease,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'main',
    '-b:v', BR, '-maxrate', BR, '-bufsize', '1M', '-g', tsFps, '-bf', '0',
    '-f', 'mpegts', '-muxdelay', '0', '-muxpreload', '0', '-flush_packets', '1', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store', Connection: 'close' });
  req.socket.setNoDelay(true);
  console.log(new Date().toLocaleTimeString(), 'espectador H.264 conectado:', req.socket.remoteAddress);
  f.stdout.pipe(res);
  const end = () => { f.kill(); console.log('espectador H.264 desconectado'); };
  res.on('close', end);
  f.on('exit', () => res.end());
}

const httpServer = http.createServer(handler);
httpServer.on('connection', s => console.log(new Date().toLocaleTimeString(), 'conexion TCP a 8080 desde', s.remoteAddress));
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\nAbre en el navegador de la tele:  http://${localIp()}:${PORT}`);
});

// Algunas teles fuerzan HTTPS: se ofrece tambien con un certificado propio (cert.pem/key.pem, solo red local).
// La tele mostrara "la conexion no es privada": Detalles > Continuar.
const HTTPS_PORT = Number(args.sport || 8443);
try {
  const fs = require('fs');
  const opts = { cert: fs.readFileSync(__dirname + '/cert.pem'), key: fs.readFileSync(__dirname + '/key.pem') };
  const httpsServer = require('https').createServer(opts, handler);
  httpsServer.on('tlsClientError', (e, s) => console.log(new Date().toLocaleTimeString(), 'fallo TLS desde', s.remoteAddress, '-', e.message));
  httpsServer.on('connection', s => console.log(new Date().toLocaleTimeString(), 'conexion TCP a 8443 desde', s.remoteAddress));
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Si la tele fuerza https:        https://${localIp()}:${HTTPS_PORT}\n`);
  });
} catch (e) {
  console.log('HTTPS desactivado:', e.message);
}

// --- FFmpeg: captura (GPU) -> JPEG sueltos por stdout ---
let ff;
let stopping = false;
// Si Windows cambia la configuracion de pantallas (monitor nuevo, resolucion, bloqueo) la captura se corta: se reinicia sola.
// Pantalla extendida (la que no es principal, p. ej. el monitor virtual): devuelve {x,y,w,h} o null.
// --screen primary fuerza duplicar la pantalla principal.
function findExtendedScreen() {
  if (args.screen === 'primary') return null;
  try {
    const out = require('child_process').execFileSync('powershell', ['-NoProfile', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; $s=[System.Windows.Forms.Screen]::AllScreens|Where-Object{-not $_.Primary}|Select-Object -First 1; if($s){'{0},{1},{2},{3}' -f $s.Bounds.X,$s.Bounds.Y,$s.Bounds.Width,$s.Bounds.Height}"
    ], { encoding: 'utf8', timeout: 15000 }).trim();
    if (!out) return null;
    const [x, y, w, h] = out.split(',').map(Number);
    return { x, y, w, h };
  } catch { return null; }
}

function startCapture() {
  const ext = findExtendedScreen();
  let input, vf;
  if (ext) {
    console.log(`Capturando pantalla extendida: ${ext.w}x${ext.h} en (${ext.x},${ext.y})`);
    input = ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1',
      '-offset_x', String(ext.x), '-offset_y', String(ext.y), '-video_size', `${ext.w}x${ext.h}`, '-i', 'desktop'];
    vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,format=yuvj420p`;
  } else {
    console.log('Sin pantalla extendida: se duplica la pantalla principal');
    input = ['-f', 'lavfi', '-i', `ddagrab=output_idx=${monitor}:framerate=${fps}:draw_mouse=1`];
    vf = `hwdownload,format=bgra,scale=${W}:${H}:force_original_aspect_ratio=decrease,format=yuvj420p`;
  }
  ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', ...input,
    '-vf', vf,
    '-c:v', 'mjpeg', '-q:v', String(Q),
    '-f', 'image2pipe', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  buf = Buffer.alloc(0);
  ff.stdout.on('data', onData);
  ff.on('exit', c => {
    if (stopping) return;
    console.log('captura se corto (codigo', c + '), reiniciando en 1.5 s...');
    setTimeout(startCapture, 1500);
  });
}

// Separar imagenes JPEG (empiezan con FFD8, terminan con FFD9)
let buf = Buffer.alloc(0);
let frames = 0;
let dropped = 0;
function onData(chunk) {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const s = buf.indexOf(Buffer.from([0xff, 0xd8]));
    if (s < 0) { buf = Buffer.alloc(0); return; }
    const e = buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
    if (e < 0) { if (s > 0) buf = buf.subarray(s); return; }
    const jpg = buf.subarray(s, e + 2);
    buf = buf.subarray(e + 2);
    frames++;
    const head = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
    for (const res of clients) {
      if (res.writableNeedDrain) {
        // cliente lento: se salta el cuadro completo (no se corrompe el flujo)
        dropped++;
        res._stuck = res._stuck || Date.now();
        if (Date.now() - res._stuck > 3000) { console.log('cerrando conexion atascada'); res.destroy(); clients.delete(res); }
        continue;
      }
      res._stuck = 0;
      res.write(head); res.write(jpg); res.write('\r\n');
    }
  }
}

startCapture();
setInterval(() => { if (clients.size) console.log('cuadros:', frames, '| descartados por Wi-Fi lento:', dropped); }, 10000).unref();
const stop = () => { stopping = true; ff.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('uncaughtException', e => console.log('Aviso (ignorado):', e.message));
