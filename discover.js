const ChromecastAPI = require('chromecast-api');
const client = new ChromecastAPI();
client.on('device', d => console.log('ENCONTRADO:', d.friendlyName, d.host));
setTimeout(() => { console.log('fin busqueda'); process.exit(0); }, 12000);
