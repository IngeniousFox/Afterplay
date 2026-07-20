import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder, Selection } from '@tiptap/extensions';
import type { MarkdownStorage } from 'tiptap-markdown';
import { Markdown } from 'tiptap-markdown';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { notesProseClass } from '../../../lib/styles';

// tiptap-markdown registra su storage en tiempo de ejecución pero no amplía
// los tipos de @tiptap/core, así que `editor.storage.markdown` no existe para
// TypeScript. Se declara aquí en vez de castear en el punto de uso: el cast
// se olvidaría de avisar si la librería cambiara la forma de su storage.
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

const GREEN = '#2fdc7e';

type NotesEditorProps = {
  // Markdown. Solo se lee al MONTAR (ver `content` abajo) — el editor es la
  // fuente de verdad mientras está vivo; quien lo usa lo remonta (key) si
  // necesita recargarlo desde fuera.
  value: string;
  onChange: (markdown: string) => void;
  // Alto mínimo del área de escritura. El modal dedicado quiere sitio de
  // sobra; embebido en un formulario (Add/Edit Game) va más compacto.
  minHeightClass?: string;
};

const ToolbarButton = ({
  Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element => (
  <button
    type="button"
    // onMouseDown + preventDefault: un click normal roba el foco al editor
    // ANTES de ejecutar el comando, y entonces la selección se pierde y
    // "poner en negrita lo seleccionado" no aplica a nada.
    onMouseDown={(event) => {
      event.preventDefault();
      if (!disabled) onClick();
    }}
    disabled={disabled}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className="group/tb flex h-8 w-8 flex-none items-center justify-center rounded-[8px] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
    style={
      active
        ? { color: GREEN, background: `${GREEN}1f`, boxShadow: `inset 0 0 0 1px ${GREEN}4d` }
        : { color: 'var(--muted-foreground)', background: 'transparent' }
    }
  >
    <Icon
      size={15}
      className={active ? '' : 'transition-colors group-hover/tb:text-foreground'}
      strokeWidth={active ? 2.4 : 2}
    />
  </button>
);

// Grupo de botones afines sobre un mismo lecho tenue — reemplaza a las barras
// verticales sueltas: en vez de separar con líneas, se agrupa por color de
// fondo, que es más limpio y más "app moderna".
const Group = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="flex items-center gap-0.5 rounded-[10px] bg-white/[0.02] p-0.5">{children}</div>
);

const Toolbar = ({ editor }: { editor: Editor }): React.JSX.Element => {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  // useEditorState y no leer editor.isActive() en el render: en TipTap v3 el
  // hook useEditor ya NO re-renderiza en cada transacción (cambio de
  // rendimiento de la v3), así que sin esta suscripción los botones no se
  // encenderían al mover el cursor.
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      strike: instance.isActive('strike'),
      code: instance.isActive('code'),
      h1: instance.isActive('heading', { level: 1 }),
      h2: instance.isActive('heading', { level: 2 }),
      h3: instance.isActive('heading', { level: 3 }),
      bulletList: instance.isActive('bulletList'),
      orderedList: instance.isActive('orderedList'),
      blockquote: instance.isActive('blockquote'),
      codeBlock: instance.isActive('codeBlock'),
      link: instance.isActive('link'),
      hasSelection: !instance.state.selection.empty,
      canUndo: instance.can().undo(),
      canRedo: instance.can().redo(),
    }),
  });

  const applyLink = (): void => {
    const url = linkUrl.trim();
    if (url) {
      // href tal cual salvo que no traiga esquema — sin esto, "afterplay.app"
      // se resolvería como ruta relativa de la propia app.
      const href = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
      const { empty, to } = editor.state.selection;

      if (empty) {
        // Sin selección, el enlace se inserta como texto acotado (la propia
        // URL) — y NO como marca almacenada, que es justo el bug: setLink con
        // el cursor pegado deja el mark "pendiente" y todo lo que escribas
        // después nace enlazado. Aquí se pinta el href sobre el rango exacto
        // recién insertado y se recoloca el cursor detrás, ya sin marca.
        editor
          .chain()
          .focus()
          .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href } }] })
          .run();
      } else {
        // Con selección: el enlace cubre SOLO lo seleccionado. extendMarkRange
        // solo entra en juego si ya estabas dentro de un enlace (para editar
        // su href sin tener que reseleccionar). Luego el cursor salta al final
        // y se limpia el mark almacenado para no arrastrarlo al seguir
        // escribiendo.
        editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href })
          .setTextSelection(to)
          .unsetMark('link')
          .run();
      }
    }
    setLinkUrl('');
    setLinkOpen(false);
  };

  return (
    <div className="border-b border-input bg-white/[0.015]">
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
        <Group>
          <ToolbarButton
            Icon={Bold}
            label="Bold (Ctrl+B)"
            active={state.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            Icon={Italic}
            label="Italic (Ctrl+I)"
            active={state.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            Icon={Strikethrough}
            label="Strikethrough"
            active={state.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <ToolbarButton
            Icon={Code}
            label="Inline code"
            active={state.code}
            onClick={() => editor.chain().focus().toggleCode().run()}
          />
        </Group>

        <Group>
          <ToolbarButton
            Icon={Heading1}
            label="Heading 1"
            active={state.h1}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <ToolbarButton
            Icon={Heading2}
            label="Heading 2"
            active={state.h2}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            Icon={Heading3}
            label="Heading 3"
            active={state.h3}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          />
        </Group>

        <Group>
          <ToolbarButton
            Icon={List}
            label="Bullet list"
            active={state.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            Icon={ListOrdered}
            label="Numbered list"
            active={state.orderedList}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            Icon={Quote}
            label="Quote"
            active={state.blockquote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
          <ToolbarButton
            Icon={SquareCode}
            label="Code block"
            active={state.codeBlock}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
        </Group>

        <Group>
          <ToolbarButton
            Icon={Link2}
            label={state.link ? 'Edit link' : 'Add link'}
            active={state.link || linkOpen}
            onClick={() => {
              if (state.link) {
                setLinkUrl(String(editor.getAttributes('link').href ?? ''));
              }
              setLinkOpen((open) => !open);
            }}
          />
          {state.link && (
            <ToolbarButton
              Icon={Link2Off}
              label="Remove link"
              onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
            />
          )}
          <ToolbarButton
            Icon={Minus}
            label="Divider"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          />
        </Group>

        <Group>
          <ToolbarButton
            Icon={Undo2}
            label="Undo (Ctrl+Z)"
            disabled={!state.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          />
          <ToolbarButton
            Icon={Redo2}
            label="Redo (Ctrl+Y)"
            disabled={!state.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          />
        </Group>
      </div>

      {linkOpen && (
        <div className="flex items-center gap-2 border-t border-input bg-white/[0.02] px-2.5 py-2">
          <Link2 size={14} className="flex-none text-muted-foreground" />
          <input
            autoFocus
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                setLinkUrl('');
                setLinkOpen(false);
              }
            }}
            placeholder={state.hasSelection ? 'Link the selection to…' : 'Paste a URL…'}
            className="min-w-0 flex-1 rounded-md border border-input bg-white/[0.03] px-2.5 py-1.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              applyLink();
            }}
            className="flex-none rounded-md px-3 py-1.5 text-[12px] font-bold"
            style={{ color: GREEN, background: `${GREEN}1f` }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
};

// Editor de notas WYSIWYG que guarda Markdown. Lo que se ve mientras escribes
// son las mismas clases `prose` con las que NotesSection pinta la nota
// guardada, así que editar y leer se ven igual — el Markdown queda por
// debajo, nunca a la vista.
export const NotesEditor = ({
  value,
  onChange,
  minHeightClass = 'min-h-64',
}: NotesEditorProps): React.JSX.Element => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // autolink false a propósito: convertía en enlace cualquier URL según
        // se teclea y marcaba de más. Aquí los enlaces se ponen SOLO desde el
        // botón, sobre un rango acotado (ver applyLink).
        link: { openOnClick: false, autolink: false },
      }),
      Placeholder.configure({ placeholder: 'Write your notes… markdown shortcuts work too.' }),
      // Mantiene el resaltado de lo seleccionado cuando el editor pierde el
      // foco — que es justo lo que pasa al abrir el campo de "añadir enlace":
      // sin esto la selección se vuelve invisible y no sabes qué texto vas a
      // enlazar. Con className propio para no chocar con ningún `.selection`
      // global.
      Selection.configure({ className: 'afterplay-note-selection' }),
      // html:false — las notas son markdown puro; permitir HTML crudo abriría
      // la puerta a pegar marcado que luego react-markdown no pinta igual.
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: value,
    editorProps: {
      attributes: {
        // El margen de h1/h2/h3/hr ya no se fuerza aquí — vive centralizado
        // en `.afterplay-notes` (main.css) para que editor y lectura
        // (NotesSection) se vean idénticos; ver el comentario junto a esa
        // regla.
        class: `${notesProseClass} ${minHeightClass} px-4.5 py-4 outline-none [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5`,
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.storage.markdown.getMarkdown());
    },
  });

  if (!editor) return <div className="min-h-80 rounded-[12px] border border-input" />;

  return (
    <div className="overflow-hidden rounded-[12px] border border-input bg-white/[0.02] focus-within:border-input/80">
      <Toolbar editor={editor} />
      <div className="max-h-125 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
