import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TvDirection } from './gamepad';
import type { FocusEntry, TvFocusApi, TvFocusContextValue } from './focusContext';
import { TvFocusContext, TvLayerContext, useTvFocusContext } from './focusContext';
import { tvSound } from './sound';

// El motor de foco del modo TV (BIG-PICTURE.md §7.2). En una tele no hay
// cursor: el foco ES el puntero, y perderlo rompe el modo entero. Por eso no
// se usa el focus nativo del DOM (se esfuma con cualquier click fantasma y
// no sabe de geometría) sino un registro propio:
//
//   · Cada elemento navegable se registra con useTvFocusable (focusContext)
//     y su nodo.
//   · Al pulsar una dirección se decide el destino por GEOMETRÍA: se miden
//     los rects de los candidatos y gana el más cercano en esa dirección
//     (proyección sobre el eje + penalización del desvío perpendicular — el
//     algoritmo clásico de las TVs). Sin grafos de vecinos a mano: las
//     pantallas cambian y los grafos a mano se pudren.
//   · Los paneles (menú Start, selector de estado, OSK) abren una CAPA con
//     <TvFocusLayer>: mientras existe, solo sus elementos son navegables, y
//     al cerrarse el foco vuelve a donde estaba. Modales de verdad sin
//     tocar el resto de la pantalla.
//
// Nota de implementación: focusedId y la pila de capas viven POR DUPLICADO
// en estado (para pintar) y en refs (para leer dentro de move/select). Los
// updaters de React tienen que ser puros — llamar onSelect o hacer scroll
// dentro de un setState se ejecutaría dos veces en StrictMode — así que
// todas las acciones leen refs, deciden fuera, y luego asientan el estado.

// Un rect solo cuenta si el elemento sigue en el DOM y ocupa sitio (un panel
// recién desmontado o un item display:none no son destinos válidos).
const visibleRect = (element: HTMLElement): DOMRect | null => {
  if (!element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
};

// El corazón: puntuar candidatos en una dirección. Distancia en el eje
// primario + 2.5x el desvío perpendicular — el multiplicador es lo que hace
// que "derecha" prefiera la carátula de al lado antes que una más cercana
// pero dos filas arriba.
const pickInDirection = (
  from: DOMRect,
  candidates: { id: string; rect: DOMRect }[],
  dir: TvDirection,
): string | null => {
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  let best: string | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const x = candidate.rect.left + candidate.rect.width / 2;
    const y = candidate.rect.top + candidate.rect.height / 2;
    const dx = x - fromX;
    const dy = y - fromY;

    // El eje primario se mide de BORDE a BORDE, no de centro a centro: dos
    // botones de la misma fila con un píxel de desnivel contaban como
    // "abajo" por centros, y bajar desde el hero saltaba de Play a Details
    // en vez de a las estanterías. Un candidato solo está "abajo" si
    // EMPIEZA más allá del borde inferior del actual (con una tolerancia
    // mínima de solape); el desvío perpendicular sigue midiéndose entre
    // centros.
    let primary: number;
    let orthogonal: number;
    if (dir === 'left') [primary, orthogonal] = [from.left - candidate.rect.right, Math.abs(dy)];
    else if (dir === 'right')
      [primary, orthogonal] = [candidate.rect.left - from.right, Math.abs(dy)];
    else if (dir === 'up') [primary, orthogonal] = [from.top - candidate.rect.bottom, Math.abs(dx)];
    else [primary, orthogonal] = [candidate.rect.top - from.bottom, Math.abs(dx)];

    if (primary <= -8) continue;
    const score = Math.max(primary, 0) + orthogonal * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = candidate.id;
    }
  }
  return best;
};

// ── El CONDUCTOR de scroll (estilo Steam Big Picture) ──────────────────────
// Nada de scrollIntoView: un muelle crítico por contenedor que PERSIGUE el
// objetivo a ritmo de rAF. Con una pulsación suelta es un deslizamiento
// corto que se asienta; manteniendo pulsado, cada eco actualiza el objetivo
// y la vista FLUYE de forma continua detrás del foco — sin los tirones del
// smooth nativo relanzado (que nunca alcanzaba y descargaba el acumulado de
// golpe al soltar). El acercamiento exponencial no oscila jamás y absorbe
// cambios de objetivo en pleno vuelo sin costura.
type Glide = { targetTop: number; targetLeft: number; stiffness: number; last: number };
const glides = new Map<HTMLElement, Glide>();

const driveGlide = (container: HTMLElement): void => {
  const tick = (): void => {
    const glide = glides.get(container);
    if (!glide) return;
    if (!container.isConnected) {
      glides.delete(container);
      return;
    }
    const now = performance.now();
    // dt acotado: una pestaña congelada no debe convertirse en un teletransporte.
    const dt = Math.min(64, now - glide.last) / 1000;
    glide.last = now;
    const rate = 1 - Math.exp(-glide.stiffness * dt);
    const deltaTop = glide.targetTop - container.scrollTop;
    const deltaLeft = glide.targetLeft - container.scrollLeft;
    if (Math.abs(deltaTop) < 0.5 && Math.abs(deltaLeft) < 0.5) {
      container.scrollTop = glide.targetTop;
      container.scrollLeft = glide.targetLeft;
      glides.delete(container);
      return;
    }
    container.scrollTop += deltaTop * rate;
    container.scrollLeft += deltaLeft * rate;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const clampScroll = (value: number, max: number): number => Math.max(0, Math.min(max, value));

// Alineación 'nearest' calculada a mano sobre CADA ancestro desplazable,
// respetando las DOS reglas nativas de holgura: el scroll-margin del
// elemento (el truco del hero de Home depende de él) y el scroll-padding del
// contenedor — el colchón que impide que lo enfocado aterrice pegado al
// borde donde recorta. Sin lo segundo, una parrilla alineaba su fila a ras
// del clip y el levantamiento del foco (translate) asomaba por fuera: la
// carátula se veía cortada por arriba.

const glideIntoView = (element: HTMLElement, snappy: boolean): void => {
  const style = getComputedStyle(element);
  const marginTop = parseFloat(style.scrollMarginTop) || 0;
  const marginBottom = parseFloat(style.scrollMarginBottom) || 0;
  const marginLeft = parseFloat(style.scrollMarginLeft) || 0;
  const marginRight = parseFloat(style.scrollMarginRight) || 0;

  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node);
    const canY = node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(overflow.overflowY);
    const canX = node.scrollWidth > node.clientWidth && /(auto|scroll)/.test(overflow.overflowX);
    if (!canY && !canX) continue;

    // Los rects reflejan el scroll ACTUAL (aunque haya un glide en vuelo),
    // así que el objetivo sale de sumar el delta pendiente al scroll de hoy.
    const containerRect = node.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    let targetTop = glides.get(node)?.targetTop ?? node.scrollTop;
    let targetLeft = glides.get(node)?.targetLeft ?? node.scrollLeft;

    // El colchón del contenedor. 'auto' (el valor inicial) no parsea a
    // número y cae a 0, que es justo lo que significa: sin colchón.
    const padTop = parseFloat(overflow.scrollPaddingTop) || 0;
    const padBottom = parseFloat(overflow.scrollPaddingBottom) || 0;
    const padLeft = parseFloat(overflow.scrollPaddingLeft) || 0;
    const padRight = parseFloat(overflow.scrollPaddingRight) || 0;

    if (canY) {
      const top = elementRect.top - containerRect.top - marginTop - padTop;
      const bottom = elementRect.bottom - containerRect.top + marginBottom + padBottom;
      if (top < 0) targetTop = node.scrollTop + top;
      else if (bottom > node.clientHeight) targetTop = node.scrollTop + bottom - node.clientHeight;
      targetTop = clampScroll(targetTop, node.scrollHeight - node.clientHeight);
    }
    if (canX) {
      const left = elementRect.left - containerRect.left - marginLeft - padLeft;
      const right = elementRect.right - containerRect.left + marginRight + padRight;
      if (left < 0) targetLeft = node.scrollLeft + left;
      else if (right > node.clientWidth) targetLeft = node.scrollLeft + right - node.clientWidth;
      targetLeft = clampScroll(targetLeft, node.scrollWidth - node.clientWidth);
    }

    // Manteniendo pulsado el muelle es más rígido: la vista pega el paso al
    // ritmo de los ecos (130ms) sin quedarse nunca atrás.
    const stiffness = snappy ? 18 : 12;
    const existing = glides.get(node);
    if (existing) {
      existing.targetTop = targetTop;
      existing.targetLeft = targetLeft;
      existing.stiffness = stiffness;
    } else if (targetTop !== node.scrollTop || targetLeft !== node.scrollLeft) {
      glides.set(node, { targetTop, targetLeft, stiffness, last: performance.now() });
      driveGlide(node);
    }
  }
};

export const TvFocusProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const entriesRef = useRef(new Map<string, FocusEntry>());
  const [focusedId, setFocusedIdState] = useState<string | null>(null);
  const [layerStack, setLayerStackState] = useState<string[]>(['root']);
  const focusedIdRef = useRef<string | null>(null);
  const layerStackRef = useRef<string[]>(['root']);
  // Dónde estaba el foco de cada capa inferior, para restaurarlo al cerrar
  // el panel que la tapó.
  const focusMemoryRef = useRef(new Map<string, string | null>());

  const api = useMemo<TvFocusApi>(() => {
    const activeLayer = (): string => layerStackRef.current[layerStackRef.current.length - 1];

    // Anti-eco de StrictMode (solo dev): el doble-invoke de efectos hace
    // push→pop→push en milisegundos y sin esto cada panel sonaba
    // open-close-open. Un pop pegado a su push (o un re-push pegado a su
    // pop) es el eco, no un gesto — se silencia. Ningún humano abre y
    // cierra un panel en <120ms.
    const pushedAt = new Map<string, number>();
    const poppedAt = new Map<string, number>();
    const isEcho = (map: Map<string, number>, key: string): boolean =>
      performance.now() - (map.get(key) ?? -Infinity) < 120;

    const setFocused = (id: string | null): void => {
      focusedIdRef.current = id;
      setFocusedIdState(id);
    };

    // Todo el scroll del modo pasa por el conductor (ver arriba): gesto
    // suelto = deslizamiento corto; mantener pulsado = flujo continuo.
    const scrollTo = (id: string, snappy = false): void => {
      const element = entriesRef.current.get(id)?.element;
      if (element) glideIntoView(element, snappy);
    };

    const entriesInLayer = (layer: string): { id: string; rect: DOMRect; autoFocus: boolean }[] => {
      const list: { id: string; rect: DOMRect; autoFocus: boolean }[] = [];
      for (const entry of entriesRef.current.values()) {
        if (entry.layer !== layer) continue;
        const rect = visibleRect(entry.element);
        if (rect) list.push({ id: entry.id, rect, autoFocus: entry.autoFocus });
      }
      return list;
    };

    // El destino por defecto de una capa: su entrada autoFocus si la hay;
    // si no, arriba-izquierda, que es por donde se empieza a leer.
    const defaultId = (layer: string): string | null => {
      const pool = entriesInLayer(layer);
      const auto = pool.find((candidate) => candidate.autoFocus);
      if (auto) return auto.id;
      let best: string | null = null;
      let bestScore = Infinity;
      for (const candidate of pool) {
        const score = candidate.rect.top * 3 + candidate.rect.left;
        if (score < bestScore) {
          bestScore = score;
          best = candidate.id;
        }
      }
      return best;
    };

    return {
      register: (entry) => {
        entriesRef.current.set(entry.id, entry);
        return () => {
          entriesRef.current.delete(entry.id);
          // Si el enfocado desaparece (filtro que vacía la parrilla, panel
          // que se cierra), el foco queda "suelto" y el siguiente move lo
          // recoloca en el destino por defecto.
          if (focusedIdRef.current === entry.id) setFocused(null);
        };
      },
      focusId: (id, options) => {
        // Solo dentro de la capa activa: el hover del ratón sobre lo que
        // queda DEBAJO de un panel abierto no puede robarle el foco al panel.
        // Devuelve si el foco CAMBIÓ de verdad — el hover lo usa para sonar
        // solo cuando mueve algo.
        const entry = entriesRef.current.get(id);
        if (!entry || entry.layer !== activeLayer()) return false;
        const changed = focusedIdRef.current !== id;
        setFocused(id);
        if (options?.scroll !== false) scrollTo(id);
        return changed;
      },
      getFocusedId: () => focusedIdRef.current,
      move: (dir, repeat = false) => {
        const layer = activeLayer();
        const current = focusedIdRef.current;
        const fromEntry = current ? entriesRef.current.get(current) : undefined;
        const fromRect =
          fromEntry && fromEntry.layer === layer ? visibleRect(fromEntry.element) : null;
        const target = fromRect
          ? (pickInDirection(
              fromRect,
              entriesInLayer(layer)
                .filter((candidate) => candidate.id !== current)
                .map(({ id, rect }) => ({ id, rect })),
              dir,
            ) ?? current)
          : defaultId(layer);
        if (target && target !== current) {
          setFocused(target);
          scrollTo(target, repeat);
          return true;
        }
        // Sin destino en esa dirección: el foco está contra el borde. El
        // layout convierte "izquierda contra el borde" en abrir el menú.
        return false;
      },
      isRootActive: () => layerStackRef.current.length === 1,
      select: () => {
        const layer = activeLayer();
        const current = focusedIdRef.current;
        const entry = current ? entriesRef.current.get(current) : undefined;
        if (entry && entry.layer === layer) {
          // Cada botón puede declarar su sonido con data-tv-sound ('none'
          // para callar: las teclas del OSK y las flechas del Journey ya
          // suenan por su propio canal). Sin declarar: el confirmar de la
          // casa — pero SOLO si hay acción de verdad (un focusable de solo
          // lectura no promete nada). El click del ratón hace este mismo
          // reparto en el layout.
          if (entry.onSelect && entry.element.dataset.tvSound !== 'none') tvSound.select();
          entry.onSelect?.();
          return;
        }
        // Sin foco todavía (o foco huérfano): A aterriza en el defecto en
        // vez de perderse — el primer botón siempre hace ALGO visible.
        const fallback = defaultId(layer);
        if (fallback) {
          setFocused(fallback);
          scrollTo(fallback);
        }
      },
      pushLayer: (key) => {
        // El nacimiento de cualquier panel suena aquí — UN punto para menú
        // Start, selector de estado, OSK y lo que venga.
        if (!isEcho(poppedAt, key)) tvSound.open();
        pushedAt.set(key, performance.now());
        focusMemoryRef.current.set(activeLayer(), focusedIdRef.current);
        layerStackRef.current = [...layerStackRef.current, key];
        setLayerStackState(layerStackRef.current);
        setFocused(null);
        // El foco inicial de la capa se decide en el siguiente tick: los
        // hijos del panel ya están registrados (los efectos de hijos corren
        // antes que los del padre), pero diferirlo evita depender de ese
        // orden para siempre.
        setTimeout(() => {
          if (activeLayer() !== key) return;
          const target = defaultId(key);
          if (target) {
            setFocused(target);
            scrollTo(target);
          }
        }, 0);
      },
      popLayer: (key) => {
        // Solo restaurar el foco si se va LA CIMA: una capa que se cierra
        // fuera de orden (el OSK desmontándose con un panel de sesión ya
        // encima) se quita de en medio sin tocarle el foco al panel activo.
        const wasTop = layerStackRef.current[layerStackRef.current.length - 1] === key;
        layerStackRef.current = layerStackRef.current.filter((layer) => layer !== key);
        setLayerStackState(layerStackRef.current);
        if (!wasTop) return;
        if (!isEcho(pushedAt, key)) tvSound.close();
        poppedAt.set(key, performance.now());
        const revealed = layerStackRef.current[layerStackRef.current.length - 1];
        const restored = focusMemoryRef.current.get(revealed) ?? null;
        // El recordado puede haberse desmontado mientras el panel estaba
        // abierto — se comprueba que siga vivo antes de devolvérselo.
        if (restored && entriesRef.current.has(restored)) {
          setFocused(restored);
          return;
        }
        // Sin foco recordado válido: en vez de dejarlo en null hasta la primera
        // pulsación de mando (una pantalla de 3 metros SIN nada resaltado — el
        // caso de navegar desde el menú Start, que cierra la capa y monta la
        // pantalla nueva en el mismo commit, así que su autoFocus se saltó al
        // ver la capa vieja todavía activa), se difiere el defecto de la capa
        // revelada al siguiente tick, igual que hace pushLayer con sus hijos.
        setFocused(null);
        setTimeout(() => {
          // Solo si esa capa sigue siendo la cima y nadie tomó el foco entre
          // medias (un autoFocus que sí llegó a dispararse, el ratón...).
          if (activeLayer() !== revealed || focusedIdRef.current !== null) return;
          const target = defaultId(revealed);
          if (target) {
            setFocused(target);
            scrollTo(target);
          }
        }, 0);
      },
    };
    // Estable para siempre: todo lo variable se lee por ref.
  }, []);

  const value = useMemo<TvFocusContextValue>(
    () => ({ ...api, focusedId, activeLayer: layerStack[layerStack.length - 1] }),
    [api, focusedId, layerStack],
  );

  return <TvFocusContext.Provider value={value}>{children}</TvFocusContext.Provider>;
};

// La capa modal: mientras este componente viva, SOLO sus descendientes son
// navegables. Al desmontarse, el foco vuelve a donde estaba debajo.
export const TvFocusLayer = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const context = useTvFocusContext();
  const key = useId();

  useEffect(() => {
    context.pushLayer(key);
    return () => context.popLayer(key);
    // push/pop una vez por vida del panel — el api es estable (ver provider).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <TvLayerContext.Provider value={key}>{children}</TvLayerContext.Provider>;
};
