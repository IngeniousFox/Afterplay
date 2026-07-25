import type { IgdbSearchResult } from '../igdb/types';

// Contrato del escaneo de carpetas (modo "Scan your folders" de Add Game).
// Aparte de folders.ts para que shared/types.ts lo reexporte sin arrastrar
// el módulo que toca el disco.

// Una subcarpeta de primer nivel de una de las raíces elegidas: el candidato
// a juego, tal cual está en disco y ANTES de buscarlo en IGDB.
export type ScannedFolder = {
  // Nombre de la carpeta = el título con el que se busca.
  folderName: string;
  path: string;
  // Nombre de la raíz de la que salió, para agrupar cuando se escanean
  // varias ("Videojuegos", "SteamLibrary"…).
  root: string;
  sizeBytes: number;
  // El .exe más probable, buscado EN PROFUNDIDAD (executable.ts). null si no
  // hay ninguno defendible — mejor no proponer que proponer un instalador.
  executablePath: string | null;
  // Cuántos ejecutables plausibles había. >1 significa "es una apuesta",
  // y la UI lo dice en vez de fingir certeza.
  executableAlternatives: number;
};

// Una carpeta ya cruzada con IGDB, lista para que el usuario elija.
export type ScanCandidate = ScannedFolder & {
  // Los mejores resultados de IGDB para ese nombre, el primero es el
  // propuesto. Vacío = no se encontró nada (o falló la búsqueda).
  matches: IgdbSearchResult[];
  // El juego ya está en la biblioteca: se marca y no se puede volver a
  // añadir, pero se sigue enseñando para que no parezca que el escaneo se lo
  // ha dejado.
  alreadyInLibrary: boolean;
};
