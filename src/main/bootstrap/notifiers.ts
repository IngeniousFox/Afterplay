import { setCuriositiesNotifier } from '../curiosities/notify';
import { setExternalNotifier } from '../external/notify';
import { setImagesNotifier } from '../images/maintenance';
import { setMemoriesNotifier } from '../memories/notify';
import { setRadarNotifier } from '../radar/notify';
import { setSavesNotifier } from '../saves/notify';
import { setAchievementsNotifier } from '../steam/notify';
import { forwardToWindow, forwardToWindowAndOverlay } from '../windows/forward';

// Los avisos de dominio que el main reenvía a la ventana principal.
export const wireDomainNotifiers = (): void => {
  // Copias automáticas al cerrar sesión: el renderer necesita enterarse en
  // vivo, o la ficha abierta se queda con la foto de antes (§10.2).
  setSavesNotifier(forwardToWindow('saves:activity'));
  // Generación de curiosidades (backfill de Ajustes y altas nuevas): el
  // renderer necesita el progreso en vivo y el aviso de "este juego ya tiene
  // las suyas" para refrescar sin sondear nada.
  setCuriositiesNotifier(forwardToWindow('curiosities:activity'));
  // Recaps del Loop (AFTERPLAY-LOOP.md §3): mismo canal de progreso que las
  // curiosidades, y el aviso de "tu junio ya está contado" con el que el
  // renderer levanta su toast de aterrizaje.
  setMemoriesNotifier(forwardToWindow('memories:activity'));
  // Logros (LOGROS.md): mismo canal de progreso que las curiosidades y los
  // recaps — la ficha abierta y la tarjeta de Ajustes se refrescan solas.
  //
  // Y TAMBIÉN al HUD, que es justo la ventana donde más se nota: los logros
  // caen MIENTRAS juegas, y el HUD se abre encima del juego para verlos. Sin
  // esta segunda línea el catálogo del HUD se quedaba en la foto del momento
  // en que empezaste a jugar — la tarjeta cantaba el desbloqueo y el HUD
  // seguía enseñándolo bloqueado hasta reiniciar la app.
  setAchievementsNotifier(forwardToWindowAndOverlay('achievements:activity'));
  // Datos externos (PLAN-TO-PLAY.md §5): la parte de las reseñas va a ~2
  // petición por segundo, así que una pasada dura minutos — más de lo que
  // cualquiera deja Ajustes abierto. Por eso su estado es del main y viaja
  // por aquí: cerrar el modal o cambiar de pantalla no la para ni la pierde.
  setExternalNotifier(forwardToWindow('external:activity'));
  // El radar de secuelas (PLAN-TO-PLAY.md §4.4): un aviso agrupado cuando la
  // pasada semanal encuentra entregas nuevas de tus sagas.
  setRadarNotifier(forwardToWindow('radar:activity'));
  // Redescarga de la caché de imágenes (Ajustes → Images): miles de ficheros
  // en una pasada, así que el progreso va por evento como todo lo largo.
  setImagesNotifier(forwardToWindow('images:activity'));
};
