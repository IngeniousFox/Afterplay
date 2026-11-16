import { app } from 'electron';
import { enterBigPicture } from '../windows/bigPicture';
import { parkSecondInstanceRequest, showMainWindow } from '../windows/mainWindow';

// BIG-PICTURE.md §1 — instancia única, ANTES de tocar nada más. Sin esto,
// un doble clic con la app viva en la bandeja arrancaba una segunda app
// entera que moría contra el fichero de la DB con un error que culpaba a la
// base de datos de lo que solo era "ya estabas abierta". La segunda
// instancia ahora es un mensajero: entrega sus argv a la primera por
// 'second-instance' y se va en milisegundos, sin ventana ni DB.
//
// El candado se toma a nivel de módulo, así que el mensaje puede llegar
// mientras el arranque todavía está abriendo la base (la primera vez, con la
// importación de la 1.x, es justo la espera larga y visible por la que existe
// el splash — y por tanto justo el hueco en el que a uno le da por hacer doble
// clic otra vez). Durante ese hueco la petición se APARCA en vez de atenderse, y la
// recoge revealWhenReady al enseñar la ventana.
//
// Aparcar sigue siendo obligatorio aunque la ventana ya exista desde antes de
// migrar (ver el bloque "LA VENTANA, ANTES DE MIGRAR"): atender ahí una
// petición significa ENSEÑAR la ventana, y enseñarla a medio cargar es
// exactamente lo que el splash evita. Y antes de que la ventana se creara
// pronto era aún peor: atenderla fabricaba una ventana principal que cargaba
// la SPA antes de registerIpcHandlers() —todos sus invoke rechazando con "No
// handler registered for 'games:getAll'"— y que se quedaba huérfana pero
// visible en cuanto el final del arranque creaba la de verdad: imposible de
// cerrar (su 'close' solo la esconde a la bandeja), con dos trackWindowState
// peleándose por guardar los bounds, y si la cerrabas su 'closed' ponía
// mainWindow a null aunque la buena siguiera viva. Ese segundo desastre ya no
// puede pasar (createWindow se defiende solo, y los handlers se registran
// antes), pero el primero sí.
//
// Y LA PUERTA ES "¿SE HA ENSEÑADO YA LA VENTANA?", no "¿está abierta la
// base?". Aquí había un `startupFinished` marcado al terminar las
// migraciones, y esa definición se quedó vieja el día que nació el TERCER
// RELOJ (startupContentPainted, en windows/mainWindow.ts): desde entonces la
// ventana NO se enseña al acabar de migrar, sino cuando además llega
// 'window:startup-content-ready' (o vencen los CONTENT_GATE_MAX_MS). En ese
// hueco —1-2 s en producción resolviendo games:getAll y decodificando
// carátulas, hasta 12 s en desarrollo— un doble clic en el .exe se atendía en
// el acto: showMainWindow() enseñaba la ventana SIN DATOS, con el splash
// todavía vivo al lado, que es justo lo que el párrafo de arriba promete
// evitar. La bandera es ahora la del reveal, la única que significa "ya hay
// algo que enseñar"; y como el reveal tiene su propia red de seguridad (12 s
// como mucho), una petición aparcada nunca se queda esperando para siempre.
//
// El "Open" del tray se queda FUERA de esta puerta a propósito, aunque el
// icono nazca dentro de ese mismo hueco: es la única vía de escape a mano si
// el reveal llegara a atascarse, y quien lo pulsa está mirando la app y sabe
// que acaba de arrancar. El doble clic en el .exe es lo contrario — alguien
// que cree que no está abierta— y por eso es el que se aparca.
//
// Devuelve si esta es la instancia primaria.
export const acquireSingleInstance = (): boolean => {
  const isPrimaryInstance = app.requestSingleInstanceLock();
  if (!isPrimaryInstance) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      // El caso Moonlight (BIG-PICTURE.md §2): `Afterplay.exe --bigpicture`
      // con la app ya corriendo = la primera instancia se pone en modo TV.
      // Sin el argumento, el clásico "doble clic": traerla delante y ya.
      const wantsBigPicture = argv.includes('--bigpicture');
      if (parkSecondInstanceRequest(wantsBigPicture)) return;
      if (wantsBigPicture) {
        enterBigPicture();
      } else {
        showMainWindow();
      }
    });
  }
  return isPrimaryInstance;
};
