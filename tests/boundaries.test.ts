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
    evaluation: ['domain', 'ports', 'evaluation'],
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

test('Pi runtime contains no SQL, database-driver imports or direct repository construction', () => {
  const adapterPaths = typescriptFiles(join(sourceRoot, 'runtime', 'pi'));
  const paths = [...adapterPaths, ...typescriptFiles(fileURLToPath(new URL('../.pi/', import.meta.url)))];
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) {
        assert.doesNotMatch(node.text, /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|DELETE\s+FROM|UPDATE\s+.+\s+SET|PRAGMA)\b/i);
      }
      if (adapterPaths.includes(path) && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        assert.doesNotMatch(node.moduleSpecifier.text, /sqlite|persistence/);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
});

test('parsers and input readers cannot import Pi, services, repositories or SQLite', () => {
  for (const path of typescriptFiles(join(sourceRoot, 'ingestion'))) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        assert.doesNotMatch(node.moduleSpecifier.text, /pi-coding-agent|runtime|persistence|sqlite|repository|services/);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]));
        assert.doesNotMatch(node.arguments[0].text, /pi-coding-agent|runtime|persistence|sqlite|repository|services/);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
});

test('M5 generator and deterministic evaluator cannot import repository or mutation services', () => {
  for (const path of [join(sourceRoot, 'runtime', 'pi', 'diagnostic-generator.ts'), join(sourceRoot, 'evaluation', 'deterministic.ts')]) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        assert.doesNotMatch(node.moduleSpecifier.text, /persistence|repository|assessment-service|evaluation-service|diagnostic-service/);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  assert.doesNotMatch(readFileSync(join(sourceRoot, 'domain', 'diagnostic-policy.ts'), 'utf8'), /Date\(|Math\.random|fetch\(|process\./);
  assert.equal(typescriptFiles(join(sourceRoot, 'services')).some(path => /teaching|mastery|review-scheduler|gap-service/.test(path)), false);
});
