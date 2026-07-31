// El SONIDO del modo TV (BIG-PICTURE.md): todo sintetizado con WebAudio en
// el momento — cero assets, cero peso en el bundle, y el mismo carácter
// cálido de la casa. Dos mundos con volúmenes independientes:
//
//   · SFX — los gestos de la interfaz: tick de foco, confirmar, atrás,
//     paneles que abren/cierran, el swish de pasar página del Journey y el
//     clac de las teclas del OSK. Cortos (30-280ms), suaves y graves-medios:
//     una sala de estar, no una máquina recreativa.
//   · AMBIENTE — el hilo de fondo relajante (la referencia: Steam Big
//     Picture): NOTAS, no drone — una caja de música generativa que pasea
//     despacio por la pentatónica de La, con un eco amortiguado de sala y
//     silencios de verdad entre frase y frase. La primera versión era un
//     pad continuo con ruido de "aire" y se percibía como un zumbido
//     monótono raro; las notas sueltas sí se leen como música suave.
//
// El AudioContext se crea perezoso en el primer uso (Electron permite audio
// sin gesto de usuario, así que el ambiente puede arrancar al entrar al
// modo). Nada de esto corre en render: solo manejadores de eventos y
// efectos, así que el compilador de React ni se entera.

// POR QUÉ LOS SFX NECESITAN MÁS QUE LA MÚSICA. En cascos se oía todo bien y
// en altavoces los gestos casi desaparecían mientras la música seguía
// perfecta — y no es cosa del volumen general, es física:
//
//   · El oído integra sonoridad en ~100-200ms: un blip de 30-55ms se PERCIBE
//     mucho más flojo que una nota sostenida del mismo pico. La música son
//     notas de 2.8s con eco encima; los SFX eran chispas de 30ms.
//   · Los senos puros concentran toda su energía en UNA banda estrecha y sin
//     transitorio. Un altavoz pequeño, a tres metros y con ruido de sala, se
//     los come; unos cascos sellados y pegados a la oreja, no.
//
// Así que: más nivel de bus, ondas CON ARMÓNICOS (triangle) y envolventes un
// pelo más largas en los sonidos cortísimos — más un realce de presencia en
// el bus (ver ensure), que es la banda donde el oído y los altavoces
// pequeños rinden mejor. La música se queda como está: ya se oía bien.
const SFX_LEVEL = 0.82;
// Notas sueltas, no un drone continuo: necesitan un punto más de presencia
// para leerse — sigue siendo música de fondo, muy por debajo de los SFX.
const AMBIENCE_LEVEL = 0.06;

let context: AudioContext | null = null;
let sfxBus: GainNode | null = null;

const ensure = (): AudioContext => {
  if (!context) {
    context = new AudioContext();
    sfxBus = context.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    // El realce de PRESENCIA de los gestos (solo el bus de SFX, la música no
    // pasa por aquí): +6dB por encima de 2.2kHz. Ahí es donde el oído es más
    // sensible y donde un altavoz pequeño rinde de verdad — es lo que hace
    // que un tick se OIGA al otro lado del salón sin tener que subirlo hasta
    // molestar en cascos. Sobre los armónicos de las ondas triangle de abajo
    // tiene material que realzar; sobre un seno puro no habría nada.
    const presence = context.createBiquadFilter();
    presence.type = 'highshelf';
    presence.frequency.value = 2200;
    presence.gain.value = 6;
    sfxBus.connect(presence).connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  return context;
};

const bus = (): GainNode => {
  ensure();
  return sfxBus as GainNode;
};

// Un tono con envolvente: ataque de 8ms (sin click de borde) y caída
// exponencial. `glideTo` desliza la frecuencia durante toda la vida — el
// "gesto" del sonido (subir = abrir, bajar = volver).
const tone = (
  freq: number,
  {
    type = 'sine' as OscillatorType,
    duration = 0.08,
    gain = 0.05,
    glideTo,
    delay = 0,
  }: {
    type?: OscillatorType;
    duration?: number;
    gain?: number;
    glideTo?: number;
    delay?: number;
  } = {},
): void => {
  const audio = ensure();
  const at = audio.currentTime + delay;
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + duration);
  const envelope = audio.createGain();
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(gain, at + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(envelope).connect(bus());
  osc.start(at);
  osc.stop(at + duration + 0.05);
};

// Ruido blanco reutilizable (2s en bucle) para swishes y para el aire del
// ambiente. Math.random aquí es legal: esto jamás corre en render.
let noiseBuffer: AudioBuffer | null = null;
const noise = (audio: AudioContext): AudioBuffer => {
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
};

// ——— El ambiente ———

let stopAmbienceFn: (() => void) | null = null;
let ambienceMaster: GainNode | null = null;
// Atenuado mientras hay un JUEGO corriendo: el pad no puede sonar debajo del
// audio del juego que acabas de lanzar. Se recuerda entre start/stop para
// que re-entrar al modo con la partida viva ya nazca atenuado.
let ambienceDucked = false;

const ambienceTarget = (): number => (ambienceDucked ? 0 : AMBIENCE_LEVEL);

// La pentatónica mayor de La en dos octavas: la escala donde CUALQUIER par
// de notas suena bien — sin semitonos que rechinen, sin tensión que
// resolver. El paseo melódico puede vagar a ciegas y siempre cae de pie.
// Registro Mi4→Si5: el rango dulce de una caja de música de verdad — la
// octava grave de antes sonaba a zumbido, no a campanita.
const AMBIENCE_SCALE = [329.63, 369.99, 440, 493.88, 554.37, 659.25, 739.99, 880, 987.77];

const startAmbience = (): void => {
  if (stopAmbienceFn) return;
  const audio = ensure();
  const now = audio.currentTime;

  const master = audio.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(ambienceTarget(), now + 2.5);
  master.connect(audio.destination);
  ambienceMaster = master;

  // El eco de la sala: delay con feedback amortiguado (lowpass en el bucle).
  // Cada nota se repite alejándose y más opaca — la "habitación" del sonido,
  // sin convolución ni assets.
  const noteBus = audio.createGain();
  const delay = audio.createDelay(1.5);
  delay.delayTime.value = 0.46;
  const damp = audio.createBiquadFilter();
  damp.type = 'lowpass';
  // Eco más oscuro y algo más presente que la nota que lo causa merece:
  // cada repetición pierde brillo — lo que hace que el conjunto se sienta
  // soñado en vez de electrónico.
  damp.frequency.value = 1100;
  const feedback = audio.createGain();
  feedback.gain.value = 0.45;
  const wet = audio.createGain();
  wet.gain.value = 0.6;
  noteBus.connect(master);
  noteBus.connect(delay);
  delay.connect(damp).connect(feedback).connect(delay);
  delay.connect(wet).connect(master);

  // Una nota DULCE de caja de música: fundamental + un unísono desafinado
  // apenas (el "coro" que redondea y calienta) + un segundo armónico tenue.
  // Ataque de 25ms — caricia, no púa — y cola larga exponencial. Los
  // osciladores nacen y mueren solos: nada queda sonando entre nota y nota.
  const pluck = (freq: number, velocity: number): void => {
    const at = audio.currentTime;
    const partials: [number, number, number][] = [
      [freq, velocity, 2.8],
      [freq * 1.004, velocity * 0.32, 2.4],
      [freq * 2.001, velocity * 0.14, 1.3],
    ];
    for (const [partialFreq, partialGain, tail] of partials) {
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = partialFreq;
      const envelope = audio.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(partialGain, at + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + tail);
      osc.connect(envelope).connect(noteBus);
      osc.start(at);
      osc.stop(at + tail + 0.1);
    }
  };

  // FRASES, no paseo aleatorio: la versión anterior vagaba por la escala
  // sin rumbo y sonaba a misterio — una melodía sin gravedad es una
  // pregunta sin respuesta. Estas son frases de NANA (índices sobre la
  // escala): contornos que suben poquito y CAEN a casa, terminando siempre
  // en nota estable — La o Do# — con la tercera pentatónica debajo como
  // acorde de "ya llegamos". El azar solo elige qué frase, su pulso y su
  // respiración: cada tarde canta distinto, pero siempre canta dulce.
  const MOTIFS: number[][] = [
    [5, 4, 2], // Mi–Do#–La: la caída dulce por excelencia
    [2, 4, 5, 4], // arco pequeño que vuelve a mirar casa
    [4, 5, 7, 5, 4], // pregunta que sube y baja sola
    [7, 5, 4, 2], // descenso largo hasta el ancla
    [3, 2, 0, 2], // el arrullo grave: Si–La–Mi–La
    [2, 3, 4], // tres pasos subiendo a la tercera, sin más
    [5, 7, 5, 4], // asomarse arriba y volver
  ];
  let stopped = false;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, ms);
    timers.add(id);
  };

  let lastMotif = -1;
  const playPhrase = (): void => {
    // Nunca la misma frase dos veces seguidas: repetirse es de reloj, no de
    // quien tararea.
    let pick = Math.floor(Math.random() * MOTIFS.length);
    if (pick === lastMotif) pick = (pick + 1) % MOTIFS.length;
    lastMotif = pick;
    const motif = MOTIFS[pick];
    // El pulso de ESTA frase, con un vaivén larga-corta (el mecer de una
    // nana, no un metrónomo).
    const beat = 460 + Math.random() * 140;
    let at = 0;
    motif.forEach((step, index) => {
      const isLast = index === motif.length - 1;
      // Dinámica en arco: entra suave, respira en medio, se apaga al final.
      const velocity = (0.4 + Math.random() * 0.08) * (isLast ? 0.8 : 1);
      later(() => {
        pluck(AMBIENCE_SCALE[step], velocity);
        // La nota final llega acompañada de su tercera por debajo: el
        // acorde que dice "en casa".
        if (isLast && step >= 2) pluck(AMBIENCE_SCALE[step - 2], velocity * 0.5);
      }, at);
      at += beat * (index % 2 === 0 ? 1 : 1.4);
    });
    // La respiración entre frases: silencio de verdad, variable.
    later(playPhrase, at + 3400 + Math.random() * 3200);
  };
  // La primera frase espera a que la cortina de entrada termine de abrir.
  later(playPhrase, 1600);

  stopAmbienceFn = () => {
    stopped = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    const end = audio.currentTime;
    // cancelAndHoldAtTime, no cancelScheduledValues: cancelar un ramp EN
    // VUELO (salir del modo durante el fade-in, o con un duck a medias)
    // revierte el gain al evento anterior — salto audible; hold congela el
    // valor que está sonando y el fundido parte de ahí.
    master.gain.cancelAndHoldAtTime(end);
    master.gain.linearRampToValueAtTime(0, end + 1.2);
    // El grafo muere cuando el fundido ya terminó (los osciladores de nota
    // se paran solos; esto suelta el eco y el master).
    setTimeout(() => {
      noteBus.disconnect();
      delay.disconnect();
      damp.disconnect();
      feedback.disconnect();
      wet.disconnect();
      master.disconnect();
    }, 1500);
    ambienceMaster = null;
  };
};

// ——— La carta de sonidos ———

export const tvSound = {
  // Mover el foco: un "tuk" mínimo con un pelo de caída — presente sin
  // taladrar aunque cruces la parrilla entera con el repeat a 130ms.
  // Triangle y no seno, y 85ms en vez de 55: los armónicos le dan cuerpo
  // para el altavoz y la duración le da sonoridad percibida (ver arriba).
  // Sigue holgadamente por debajo del repeat, así que no se solapa consigo
  // mismo al cruzar la parrilla de un tirón.
  move: (): void => {
    tone(620, { type: 'triangle', duration: 0.085, gain: 0.04, glideTo: 540 });
  },
  // Confirmar: dos notas subiendo (Do5→Sol5) — la firma "adelante".
  select: (): void => {
    tone(523.25, { type: 'triangle', duration: 0.07, gain: 0.05 });
    tone(783.99, { type: 'triangle', duration: 0.12, gain: 0.045, delay: 0.055 });
  },
  // Atrás: una nota cayendo — el espejo exacto de confirmar.
  back: (): void => {
    tone(480, { type: 'triangle', duration: 0.11, gain: 0.045, glideTo: 340 });
  },
  // Un panel que se abre: barrido corto hacia arriba + una chispa arriba.
  open: (): void => {
    tone(300, { type: 'triangle', duration: 0.16, gain: 0.04, glideTo: 520 });
    tone(1046.5, { type: 'triangle', duration: 0.1, gain: 0.022, delay: 0.06 });
  },
  // Un panel que se cierra: el mismo barrido, de vuelta.
  close: (): void => {
    tone(520, { type: 'triangle', duration: 0.14, gain: 0.035, glideTo: 300 });
  },
  // Pasar página del Journey: un swish de ruido con el filtro barriendo de
  // agudo a grave — papel de verdad, no un beep.
  pageTurn: (): void => {
    const audio = ensure();
    const at = audio.currentTime;
    const source = audio.createBufferSource();
    source.buffer = noise(audio);
    const swish = audio.createBiquadFilter();
    swish.type = 'bandpass';
    swish.Q.value = 0.8;
    swish.frequency.setValueAtTime(1600, at);
    swish.frequency.exponentialRampToValueAtTime(420, at + 0.26);
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(0.09, at + 0.05);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    source.connect(swish).connect(envelope).connect(bus());
    source.start(at);
    source.stop(at + 0.35);
  },
  // Una tecla del OSK: un clac cortísimo y discreto — escribir un título
  // entero no puede sonar a metralleta.
  key: (): void => {
    tone(1180, { type: 'triangle', duration: 0.045, gain: 0.028 });
    tone(340, { type: 'triangle', duration: 0.05, gain: 0.022 });
  },
  startAmbience,
  stopAmbience: (): void => {
    stopAmbienceFn?.();
    stopAmbienceFn = null;
  },
  // Con un juego corriendo, el hilo se retira (fundido de ~2s a silencio) y
  // vuelve solo cuando la sesión termina — como baja las luces un cine.
  duckAmbience: (ducked: boolean): void => {
    if (ambienceDucked === ducked) return;
    ambienceDucked = ducked;
    if (!ambienceMaster || !context) return;
    const at = context.currentTime;
    // hold, no cancel+set: cancelar el fade-in de entrada (o el duck
    // contrario) en vuelo revertía el gain al ancla anterior — corte o pop
    // en vez de fundido. Congelar el valor sonante y fundir desde ahí.
    ambienceMaster.gain.cancelAndHoldAtTime(at);
    ambienceMaster.gain.linearRampToValueAtTime(ambienceTarget(), at + 2);
  },
};
