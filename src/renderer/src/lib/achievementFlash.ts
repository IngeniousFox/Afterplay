// EL ATERRIZAJE EN UN LOGRO CONCRETO (LOGROS-REDISENO §1).
//
// Los mini-trofeos de una sesión eran decorativos: veías que anoche cayeron
// tres logros y ahí se acababa el camino. Ahora cada uno navega a su logro, y
// este módulo es el mensajero — quien pulsa pide el parpadeo AQUÍ y navega;
// la sección de logros de la ficha lo lee al montar (o en caliente, si ya
// estabas en esa ficha) y hace el resto: despliega la lista si el logro cae
// más allá del corte, lo lleva a la vista y le da el parpadeo dorado.
//
// Es LITERALMENTE la gramática de requestSessionFlash (useSessionClosedToast):
// un valor fuera de React + useSyncExternalStore, por los mismos dos motivos.
// Uno: el clic puede pasar en cualquier pantalla (Sesiones, el toast de
// cierre) y el destino puede no estar montado todavía. Y dos: consumir vacía
// el valor —es un efecto secundario— así que leerlo en un inicializador de
// useState se rompía con el doble-invoke de StrictMode; useSyncExternalStore
// es la forma correcta de leer un valor externo.
let pendingAchievementId: number | null = null;

const listeners = new Set<() => void>();

const emitChange = (): void => {
  for (const listener of listeners) listener();
};

export const requestAchievementFlash = (achievementId: number): void => {
  pendingAchievementId = achievementId;
  // Avisar a quien YA esté montado: si estás viendo la ficha de ese juego
  // (historial de sesiones → su propio logro), la ruta no cambia y no hay
  // remontaje que lea el valor por su cuenta.
  emitChange();
};

// Se consume una vez usado: si no, volver a la ficha días después
// parpadearía otra vez un logro viejo sin motivo. Quien consume es la propia
// fila, en cuanto arranca su parpadeo — igual que las sesiones.
export const consumeAchievementFlash = (): void => {
  if (pendingAchievementId === null) return;
  pendingAchievementId = null;
  emitChange();
};

export const subscribeAchievementFlash = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getPendingAchievementFlash = (): number | null => pendingAchievementId;
