// Quita cualquier etiqueta de una curiosidad, dejando el texto de dentro
// intacto.
//
// Existe porque el modelo arrastra la costumbre de citar sus fuentes con
// marcado tipo <cite index="21-1">...</cite> aunque nunca se le pidió —
// comprobado en curiosidades reales ya generadas. El prompt se lo prohíbe
// explícitamente, pero esto es la red de seguridad: más vale no fiarlo todo a
// que obedezca.
//
// Lo usan los dos lados del problema: el generador, al recibir la respuesta,
// y la limpieza de las curiosidades que ya se guardaron con etiquetas antes
// de que el prompt lo prohibiera. Tienen que quitar exactamente lo mismo, así
// que la expresión vive en un solo sitio.
export const stripTags = (text: string): string => text.replace(/<\/?[a-z][^>]*>/gi, '').trim();
