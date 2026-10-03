/** Double-quoted tokens use JSON escapes; paths with spaces must be quoted. */
export function parseArguments(args: string): string[] {
  const tokens: string[] = [];
  let rest = args.trim();
  while (rest) {
    const match = /^("(?:[^"\\]|\\.)*"|[^\s"]+)(?=\s|$)/.exec(rest);
    if (!match?.[1]) throw new Error('Invalid command arguments.');
    const token = match[1];
    tokens.push(token.startsWith('"') ? String(JSON.parse(token)) : token);
    rest = rest.slice(token.length).trimStart();
  }
  return tokens;
}
