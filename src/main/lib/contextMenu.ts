import type { BrowserWindow } from 'electron';
import { Menu, MenuItem } from 'electron';

// Electron no da clic derecho gratis: por defecto revisa la ortografía (el
// subrayado rojo ya sale solo) pero no hay NINGÚN menú que lo aproveche, ni
// siquiera Cortar/Copiar/Pegar — hay que construirlo a mano por cada ventana,
// escuchando 'context-menu' en su webContents. Sin esto, cualquier campo de
// texto de la app (búsqueda, notas, título de gasto…) es sordo al clic
// derecho — no es un fallo del editor de notas en particular.
export const registerContextMenu = (window: BrowserWindow): void => {
  window.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    // Sugerencias del corrector — solo si el clic cayó sobre una palabra que
    // Electron ya marcó como mal escrita (params.misspelledWord). Sin
    // sugerencias, el propio Chromium a veces sigue mandando el evento con la
    // palabra rellena pero el array vacío.
    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions) {
          menu.append(
            new MenuItem({
              label: suggestion,
              click: () => window.webContents.replaceMisspelling(suggestion),
            }),
          );
        }
      } else {
        menu.append(new MenuItem({ label: 'No suggestions', enabled: false }));
      }
      menu.append(
        new MenuItem({
          label: 'Add to dictionary',
          click: () =>
            window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        }),
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Edición estándar — editFlags ya dice qué tiene sentido en este punto
    // exacto (p. ej. canPaste es false con el portapapeles vacío), así que
    // cada entrada se deshabilita sola en vez de decidirlo aquí a mano.
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Cut', enabled: params.editFlags.canCut, role: 'cut' }));
      menu.append(new MenuItem({ label: 'Copy', enabled: params.editFlags.canCopy, role: 'copy' }));
      menu.append(
        new MenuItem({ label: 'Paste', enabled: params.editFlags.canPaste, role: 'paste' }),
      );
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(
        new MenuItem({
          label: 'Select All',
          enabled: params.editFlags.canSelectAll,
          role: 'selectAll',
        }),
      );
    } else if (params.selectionText) {
      // Texto seleccionado pero NO editable (una nota ya guardada, un título
      // en modo lectura) — solo copiar tiene sentido, sin el resto del menú
      // de edición.
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    }

    if (menu.items.length > 0) menu.popup();
  });
};
