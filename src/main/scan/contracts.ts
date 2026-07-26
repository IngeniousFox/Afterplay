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
  // TODOS los candidatos plausibles, en orden (el primero es executablePath).
  // Se mandan enteros para que la UI deje CORREGIR la apuesta: decir "best
  // guess of 2" sin enseñar cuál es el otro no ayuda a nadie.
  executableCandidates: string[];
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

// Lo que ve la pantalla de escaneo. Ya no es solo la lista: como el
// resultado se guarda entre cierres y se refresca solo en segundo plano,
// hace falta decir DE CUÁNDO es lo que se está enseñando.
export type ScanReport = {
  candidates: ScanCandidate[];
  // ISO del escaneo más reciente de estas carpetas, o null si no hay nada
  // guardado todavía (primer arranque, o no se ha señalado ninguna carpeta).
  scannedAt: string | null;
};
