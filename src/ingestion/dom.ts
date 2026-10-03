import { parseDocument, DomUtils } from 'htmlparser2';
export type DomNode = ReturnType<typeof parseDocument>['children'][number];
export function children(node: DomNode): DomNode[] { return 'children' in node ? node.children : []; }
export function name(node: DomNode): string { return 'name' in node ? node.name : ''; }
export function attr(node: DomNode, key: string): string | undefined { return 'attribs' in node ? node.attribs[key] : undefined; }
export function text(node: DomNode): string { return DomUtils.textContent(node); }
export function all(node: DomNode, tag: string): DomNode[] {
  return [...(name(node) === tag ? [node] : []), ...children(node).flatMap((child) => all(child, tag))];
}
export function xml(value: string) { return parseDocument(value, { xmlMode: true, decodeEntities: true }); }
