# Cast de video de laptop a TV JVC, en aplicación VLC

Transmite la pantalla de una laptop con **Windows** a una tele **JVC (Android TV)** usando la aplicación
**VLC** de la tele, sin Miracast y sin pagar ninguna aplicación. Puede **duplicar** la pantalla principal o
**extender** el escritorio a la tele usando un monitor virtual.

La laptop corre un pequeño servidor web (`web.js`) que captura la pantalla con FFmpeg y la entrega por HTTP.
La tele solo tiene que abrir la dirección en VLC.

```
Windows ──captura (FFmpeg)──► servidor web.js ──HTTP por Wi-Fi──► VLC en la tele
```

## Requisitos

- Windows 10/11 (la captura usa `gdigrab` y `ddagrab` de FFmpeg).
- [Node.js](https://nodejs.org) 18 o superior.
- [FFmpeg](https://ffmpeg.org) en el `PATH`: `winget install Gyan.FFmpeg` (reabre la terminal después).
- La laptop y la tele en la **misma red Wi-Fi** (no una red de invitados).
- La app **VLC** instalada en la tele (Google Play / Android TV).

## Uso

```bash
npm install
node web.js
```

El servidor imprime algo como:

```
Capturando pantalla extendida: 1920x1080 en (3200,0)
Abre en el navegador de la tele:  http://192.168.1.XX:8080
```

En la tele, abre **VLC → Flujos** (*Stream*) y escribe una de estas direcciones, con la IP de tu laptop:

| Dirección | Formato | Cuándo usarla |
|---|---|---|
| `http://<IP-de-la-laptop>:8080/live.ts` | H.264 (MPEG-TS) | Recomendada: 30 cuadros por segundo, más fluida |
| `http://<IP-de-la-laptop>:8080/stream.mjpg` | MJPEG | Alternativa, más pesada para el Wi-Fi |

Para detener el servidor, presiona `Ctrl + C` en la terminal.

También puedes abrirlo con doble clic en `web.bat`.

### Ajustes en VLC (menos retraso)

- Velocidad de reproducción en **1x**. Acelerarla vacía la reserva de imagen y provoca cortes.
- Ajustes → Avanzado → **caché de red** en unos 300 ms. Con 0 se corta con cualquier tropiezo del Wi-Fi.

### Opciones de `web.js`

```bash
node web.js --screen primary      # duplicar la pantalla principal en vez de la extendida
node web.js --fps 12 --w 960 --h 540 --q 9   # MJPEG: cuadros por segundo, tamaño y calidad (2 mejor, 31 peor)
node web.js --tw 1280 --th 720 --br 4M --tsfps 30   # H.264: tamaño, bitrate y cuadros por segundo
node web.js --port 8080 --sport 8443          # puertos HTTP y HTTPS
```

Si no hay pantalla extendida, `web.js` duplica la pantalla principal automáticamente.

## Extender la pantalla (monitor virtual)

Windows no extiende el escritorio a una tele sin Miracast, pero sí a un **monitor virtual**. Se usa el driver de
código abierto [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver):

1. Descarga `VirtualDisplayDriver-x86.Driver.Only.zip` de su página de *Releases* y extrae el contenido.
2. Copia `vdd_settings.xml` a `C:\VirtualDisplayDriver\`.
3. Administrador de dispositivos → clic en el nombre de tu PC → **Acción → Agregar hardware heredado** →
   instalar manualmente → **Adaptadores de pantalla** → **Utilizar disco…** → elige `MttVDD.inf`.
4. Windows creará una segunda pantalla. Actívala en **Configuración de pantalla** y ponla en 1920x1080.
5. Arrastra ventanas hacia la derecha de la pantalla del laptop: aparecerán en la tele.

> Instalar un driver modifica el sistema. Descarga solo de la página oficial y verifica que los archivos tengan
> firma válida (propiedades del archivo → Firmas digitales).

## Archivos

| Archivo | Qué hace |
|---|---|
| `web.js` | Servidor principal: captura la pantalla y la sirve a VLC (`/live.ts` y `/stream.mjpg`). |
| `web.bat` | Lanza `web.js` con doble clic. |
| `cast.js`, `cast.bat` | Intento anterior con el protocolo **Chromecast** (ver abajo). |
| `discover.js` | Lista los dispositivos Chromecast que hay en la red. |
| `diag.js` | Diagnóstico: muestra el estado de la sesión de Cast de una tele (`node diag.js <IP-de-la-tele>`). |

## Por qué VLC y no Chromecast ni el navegador de la tele

En la tele JVC probada:

- **Chromecast** (`cast.js`): la tele recibía el video, pero su reproductor se quedaba en pausa o saltaba entre
  *PLAYING*, *BUFFERING* y *PAUSED*, y rechazaba la orden de reproducir (`APP_ERROR`). No sirvió para video en vivo.
- **Navegador de la tele**: fuerza HTTPS, y rechaza el certificado propio sin dejar continuar.
- **VLC**: abre direcciones `http://` sin revisar certificados. Es la opción que funciona.

## Estado y pendientes

- La pantalla extendida se ve en la tele con VLC.
- Con `/live.ts` aún puede haber retraso o trabas; falta medir si la laptop alcanza a codificar a 30 cuadros por
  segundo en tiempo real y ajustar resolución o bitrate.
- Sin audio: FFmpeg no captura lo que suena en el PC sin un componente adicional.

## Seguridad

El servidor no tiene contraseña: cualquiera en tu misma red que conozca la dirección puede ver tu pantalla
mientras está encendido. Úsalo solo en una red de confianza y ciérralo al terminar.
