// Diagnostico: se une a la sesion activa de la tele, muestra su estado y prueba PLAY / SEEK.
const { Client, DefaultMediaReceiver } = require('castv2-client');
const host = process.argv[2];
if (!host) { console.log('Uso: node diag.js <IP-de-la-tele>'); process.exit(1); }
const c = new Client();
c.connect(host, () => {
  c.getSessions((err, sessions) => {
    console.log('sesiones:', err || JSON.stringify(sessions.map(s => ({ app: s.displayName, id: s.appId }))));
    const s = sessions && sessions.find(x => x.appId === 'CC1AD845');
    if (!s) { console.log('no hay sesion DefaultMediaReceiver'); return process.exit(0); }
    c.join(s, DefaultMediaReceiver, (err, p) => {
      if (err) { console.log('join error', err); return process.exit(1); }
      p.getStatus((err, st) => {
        console.log('estado:', err || JSON.stringify({ state: st && st.playerState, t: st && st.currentTime, cmds: st && st.supportedMediaCommands, live: st && st.media && st.media.streamType, dur: st && st.media && st.media.duration }));
        const id = st.mediaSessionId;
        console.log('mediaSessionId', id);
        p.on('status', x => console.log('  status:', x.playerState, x.currentTime));
        p.media.request({ type: 'PLAY', mediaSessionId: id }, (e, r) => {
          console.log('PLAY ->', e || JSON.stringify(r));
          setTimeout(() => {
            // plan B: SEEK para saltar al borde en vivo, reanudando reproduccion
            p.media.request({ type: 'SEEK', mediaSessionId: id, resumeState: 'PLAYBACK_START', currentTime: 0 }, (e2, r2) => {
              console.log('SEEK ->', e2 || JSON.stringify(r2));
              setTimeout(() => process.exit(0), 4000);
            });
          }, 3000);
        });
      });
    });
  });
});
c.on('error', e => { console.log('error', e.message); process.exit(1); });
setTimeout(() => process.exit(0), 15000);

