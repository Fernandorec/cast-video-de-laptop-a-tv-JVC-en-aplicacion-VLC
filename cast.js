// Transmite una region del escritorio de Windows a un Chromecast/Android TV.
// Uso: node cast.js [--device Valencia] [--monitor 0] [--fps 30]
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ChromecastAPI = require('chromecast-api');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);
const deviceName = args.device || 'Valencia';
const fps = args.fps || '30';
const PORT = 8000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-'));

function localIp() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list) if (n.family === 'IPv4' && !n.internal && n.address.startsWith('192.168.')) return n.address;
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list) if (n.family === 'IPv4' && !n.internal) return n.address;
}

// --- Servidor HTTP para los segmentos HLS ---
http
  .createServer((req, res) => {
    console.log(new Date().toLocaleTimeString(), req.socket.remoteAddress, req.url);
    const file = path.join(dir, path.basename(req.url.split('?')[0]));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      const type = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/mp2t';
      res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, '0.0.0.0');

// --- FFmpeg: captura de escritorio -> HLS ---
// ddagrab = Desktop Duplication (GPU), mas estable que gdigrab. --monitor N elige la pantalla.
const src = `ddagrab=output_idx=${args.monitor || 0}:framerate=${fps}:draw_mouse=1`;

const ff = spawn('ffmpeg', [
  '-hide_banner', '-loglevel', 'warning', '-f', 'lavfi', '-i', src,
  // --audio "nombre dshow" para sonido real; si no, audio silencioso (Cast se atasca con HLS sin audio)
  ...(args.audio ? ['-f', 'dshow', '-i', `audio=${args.audio}`] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
  '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
  '-profile:v', 'high', '-level', '4.1',
  '-vf', 'hwdownload,format=bgra,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', '6M', '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
  '-f', 'hls', '-hls_time', '2', '-hls_list_size', '10',
  '-hls_flags', 'delete_segments+independent_segments',
  path.join(dir, 'live.m3u8'),
], { stdio: 'inherit' });

// la libreria Cast lanza TypeError con respuestas inesperadas de la tele; no debe tumbar la transmision
process.on('uncaughtException', e => console.log('Aviso (ignorado):', e.message));
let tv;
function stop() {
  ff.kill();
  try { tv ? tv.stop(() => process.exit(0)) : process.exit(0); } catch { process.exit(0); }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', stop);
ff.on('exit', c => { console.log('ffmpeg termino', c); process.exit(c || 0); });

// --- Cast ---
const url = `http://${localIp()}:${PORT}/live.m3u8`;
console.log('Stream:', url);
const client = new ChromecastAPI();
client.on('device', d => {
  if (!d.friendlyName.toLowerCase().includes(deviceName.toLowerCase())) return;
  console.log('Conectando a', d.friendlyName);
  tv = d;
  // esperar a tener 4 segmentos listos: da margen al reproductor de la tele para no quedarse sin imagen
  const wait = setInterval(() => {
    const pl = path.join(dir, 'live.m3u8');
    if (!fs.existsSync(pl) || (fs.readFileSync(pl, 'utf8').match(/\.ts/g) || []).length < 4) return;
    clearInterval(wait);
    // La tele arranca en la posicion 0, que ya no existe en la lista deslizante (se borran los segmentos viejos),
    // y queda en pausa. Se le pide empezar 3 segmentos antes del borde en vivo.
    const txt = fs.readFileSync(pl, 'utf8');
    const seq = Number((txt.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1] || 0);
    const n = (txt.match(/\.ts/g) || []).length;
    const startAt = Math.max(0, (seq + n - 3) * 2);
    console.log('Inicio en', startAt, 's (secuencia', seq, ',', n, 'segmentos)');
    d.on('status', s => {
      console.log('Estado tele:', s.playerState, s.currentTime !== undefined ? s.currentTime.toFixed(1) + 's' : '');
      if (s.playerState === 'PAUSED' && d.player && d.player.media && s.mediaSessionId !== undefined) {
        // respaldo: pedir reproducir (la libreria falla si la tele responde error, por eso va cruda)
        d.player.media.request({ type: 'PLAY', mediaSessionId: s.mediaSessionId }, (err, resp) =>
          console.log('Respuesta a PLAY:', err ? String(err) : JSON.stringify(resp)));
      }
    });
    d.play({ url, contentType: 'application/x-mpegURL', streamType: 'LIVE' }, { autoplay: true, currentTime: startAt }, err => {
      console.log(err ? 'Error al reproducir: ' + err : 'Transmitiendo. Ctrl+C para detener.');
    });
  }, 500);
});
