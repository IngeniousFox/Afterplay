import { app } from 'electron';
import { configureBeforeReady } from './bootstrap/preReady';
import { mark } from './bootstrap/startupClock';
import { runStartup } from './bootstrap/startup';
import { registerStartupContentIpc } from './ipc/mainProcess';
import { registerQuitLifecycle } from './lifecycle/quit';
import { acquireSingleInstance } from './lifecycle/singleInstance';

// El proceso principal solo compone módulos (AFTERPLAY-2.0.md §15.1):
//   bootstrap/  las fases del arranque, en orden
//   windows/    ventana principal, Big Picture, overlay, avisos
//   lifecycle/  instancia única, cierre ordenado, energía
//   ipc/        los handlers

// La primera sentencia del cuerpo del módulo corre cuando TODOS los imports
// (los de arriba y su árbol entero) ya están evaluados: esta marca separa el
// arranque de Electron/Chromium del coste de cargar nuestro propio código.
mark('imports del main evaluados');

// Nombre de la app, perfil de desarrollo, carpeta de datos de los E2E, política
// de audio y esquema de imágenes: todo antes de whenReady() y de cualquier
// app.getPath('userData').
configureBeforeReady();

// El aviso de "contenido pintable" del renderer (el tercer reloj de la
// ventana). Antes del candado de instancia única.
registerStartupContentIpc();

// BIG-PICTURE.md §1 — instancia única, ANTES de tocar nada más.
const isPrimaryInstance = acquireSingleInstance();

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => runStartup(isPrimaryInstance));

// Salir al cerrar todas las ventanas, el before-quit ordenado y el cierre de
// la base (will-quit).
registerQuitLifecycle();
