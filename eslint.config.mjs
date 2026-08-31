import { defineConfig } from 'eslint/config';
import tseslint from '@electron-toolkit/eslint-config-ts';
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier';
import eslintPluginReact from 'eslint-plugin-react';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh';

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh,
    },
    rules: {
      ...eslintPluginReactHooks.configs['recommended-latest'].rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
    },
  },
  {
    // shadcn/ui generates these files; they're vendored, not hand-written.
    files: ['src/renderer/src/components/ui/**/*.{ts,tsx}', 'src/renderer/src/lib/utils.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    // Tests E2E (Playwright). Aqui no hay React ni una sola linea de JSX: el
    // `use` que estas reglas confunden con un hook es el callback con el que
    // Playwright entrega una fixture al test, y su firma —incluido el
    // destructuring vacio de las dependencias— la fija su propia API, no
    // nosotros. Apagarlas SOLO en esta carpeta es lo honesto; desactivarlas en
    // todo el repo por culpa de un falso positivo seria pagar con el renderer,
    // que es donde esas reglas de verdad protegen algo.
    files: ['e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
    },
  },
  eslintConfigPrettier,
);
