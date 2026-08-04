// El patrón "notificador inyectado", que estaba copiado byte a byte en cinco
// módulos (saves, curiosities, memories, steam y el cierre de sesión del
// watcher): main/index.ts —que es quien tiene la ventana— inyecta con set() la
// función que manda el evento por webContents, y los módulos de dominio llaman
// a notify() sin depender de Electron ni de quién sea la ventana en cada
// momento.
//
// El try/catch traga un aviso perdido a propósito: la ventana puede estar
// cerrándose o no existir todavía, y perder un aviso nunca rompe nada porque
// lo que anuncia YA está persistido — la próxima carga lo verá igual.
export const makeNotifier = <E>(): {
  set: (notifier: (event: E) => void) => void;
  notify: (event: E) => void;
} => {
  let send: (event: E) => void = () => {};
  return {
    set: (notifier) => {
      send = notifier;
    },
    notify: (event) => {
      try {
        send(event);
      } catch {
        // Aviso perdido (ventana cerrándose / aún inexistente): inofensivo, el
        // estado ya está en la DB.
      }
    },
  };
};
