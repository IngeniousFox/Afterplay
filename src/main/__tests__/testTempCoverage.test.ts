import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import { isTestTempDirectoryName } from '../../../scripts/lib/testTempDirectories';

const sourceFiles = function* (root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) yield path;
  }
};

const isTempFactory = (name: string): boolean =>
  /^(?:mkdtemp|mkdtempSync|mkdtempDisposable|mkdtempDisposableSync)$/.test(name);

it('every source mkdtemp family is covered by pretest cleanup or has an explicit self-cleaning exception', () => {
  // Derive coverage from actual factory calls, not another copy of the
  // cleaner allowlist. Adding a family makes this test fail until its
  // disposal policy is reviewed. Parse only files mentioning mkdtemp;
  // comments, fixture strings and formatting changes cannot create matches.
  let checked = 0;
  for (const root of ['src', 'worker/src', 'web/src', 'e2e', 'scripts']) {
    for (const path of sourceFiles(root)) {
      const text = readFileSync(path, 'utf8');
      if (!text.includes('mkdtemp')) continue;
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const importedFactories = new Set<string>();
      const fsNamespaces = new Set<string>();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
          continue;
        if (!/^(?:node:)?fs(?:\/promises)?$/.test(statement.moduleSpecifier.text)) continue;
        const imports = statement.importClause;
        if (imports?.name) fsNamespaces.add(imports.name.text);
        const bindings = imports?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) fsNamespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            if (isTempFactory((binding.propertyName ?? binding.name).text))
              importedFactories.add(binding.name.text);
          }
        }
      }

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          const isFactoryCall =
            (ts.isIdentifier(expression) && importedFactories.has(expression.text)) ||
            (ts.isPropertyAccessExpression(expression) &&
              ts.isIdentifier(expression.expression) &&
              fsNamespaces.has(expression.expression.text) &&
              isTempFactory(expression.name.text));
          if (isFactoryCall) {
            const location = `${relative(process.cwd(), path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
            const argument = node.arguments[0];
            // Current factories use join(tmpdir(), 'prefix-'). Direct string
            // prefixes work too; a future computed prefix needs explicit
            // review instead of silently bypassing coverage.
            const prefixNode =
              argument && ts.isCallExpression(argument) ? argument.arguments.at(-1) : argument;
            assert.ok(
              prefixNode &&
                (ts.isStringLiteral(prefixNode) || ts.isNoSubstitutionTemplateLiteral(prefixNode)),
              `${location}: expose a static mkdtemp prefix so its cleanup policy can be checked`,
            );
            const prefix = prefixNode.text;
            const ownClassifierFixture =
              path
                .replaceAll('\\', '/')
                .endsWith('src/main/__tests__/testTempDirectories.test.ts') &&
              prefix === 'codex-temp-classifier-';
            // The selector tests deliberately use an unrelated parent and
            // remove exactly that parent in after(); never put it in pretest.
            if (!ownClassifierFixture) {
              assert.ok(
                isTestTempDirectoryName(`${prefix}aB19zX`),
                `${location}: mkdtemp prefix ${JSON.stringify(prefix)} is missing from the cleanup allowlist`,
              );
              checked++;
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  assert.ok(checked > 0, 'the coverage gate must find actual temporary-directory factories');
});
