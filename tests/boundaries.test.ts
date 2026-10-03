import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? typescriptFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('domain, ports, and services obey inward dependencies and cannot import Pi or infrastructure', () => {
  const allowed: Record<string, readonly string[]> = {
    domain: ['domain'],
    ports: ['domain', 'ports'],
    services: ['domain', 'ports', 'services'],
  };
  for (const [layer, targets] of Object.entries(allowed)) {
    for (const path of typescriptFiles(join(sourceRoot, layer))) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const inspect = (node: ts.Node): void => {
        let specifier: ts.Node | undefined;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
        if (ts.isCallExpression(node)
          && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          specifier = node.arguments[0];
          assert.ok(specifier && ts.isStringLiteral(specifier), `${path}: nonliteral import is forbidden`);
        }
        if (specifier) {
          assert.ok(ts.isStringLiteral(specifier), `${path}: expected literal module path`);
          const modulePath = specifier.text;
          assert.ok(modulePath.startsWith('.'), `${path}: external import ${modulePath} violates ${layer} boundary`);
          const targetLayer = relative(sourceRoot, resolve(dirname(path), modulePath)).split(/[\\/]/)[0];
          assert.ok(targetLayer && targets.includes(targetLayer), `${path}: import ${modulePath} violates ${layer} boundary`);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }
  }
});
