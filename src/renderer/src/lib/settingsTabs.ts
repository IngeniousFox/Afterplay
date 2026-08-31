// El nombre de la pestaña de Ajustes donde viven las claves, en UN solo
// sitio.
//
// La cicatriz: esa pestaña se llamó "API & Sync" hasta que Ajustes se repartió
// en seis habitaciones y pasó a llamarse "Connections". El nombre viejo estaba
// escrito a mano en los cinco avisos de "esto está apagado porque te falta la
// clave X" repartidos por las secciones, y solo uno se actualizó: los otros
// cuatro seguían mandando al usuario a una pestaña que ya no existe (y el de
// Cloud saves, encima, a "más arriba" de OTRA pestaña). Importando el nombre,
// el siguiente rebautizo se hace aquí y punto.
export const KEYS_TAB = 'Connections';

// La frase compartida de "te falta una clave para esto". Cuatro tarjetas la
// dicen con la misma gramática y cambia solo QUÉ clave falta, así que el
// nombre de la pestaña no vuelve a copiarse a mano en ninguna.
export const missingKeyHint = (what: string): string =>
  `Add your ${what} in ${KEYS_TAB} to turn this on.`;
