/** Discord message content limit */
export const DISCORD_CONTENT_LIMIT = 2000;

/**
 * Split text into chunks ≤ maxLen, preferring paragraph → line → word boundaries.
 * Reserve `reservePerChunk` chars on each chunk for optional prefixes like "(2/5)\n".
 */
export function chunkForDiscord(
  text: string,
  maxLen: number = DISCORD_CONTENT_LIMIT,
  reservePerChunk = 0,
): string[] {
  const effective = Math.max(100, maxLen - reservePerChunk);
  if (text.length <= effective) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > 0) {
    if (rest.length <= effective) {
      chunks.push(rest);
      break;
    }
    let slice = rest.slice(0, effective);
    let cut = slice.length;

    const para = slice.lastIndexOf("\n\n");
    if (para > effective * 0.3) cut = para + 2;
    else {
      const nl = slice.lastIndexOf("\n");
      if (nl > effective * 0.3) cut = nl + 1;
      else {
        const sp = slice.lastIndexOf(" ");
        if (sp > effective * 0.5) cut = sp + 1;
      }
    }

    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }

  return chunks;
}

/** Send chunks in order as plain text messages */
export async function sendChunked(
  send: (content: string) => Promise<unknown>,
  text: string,
  reservePerChunk = 12,
): Promise<void> {
  const rawChunks = chunkForDiscord(text, DISCORD_CONTENT_LIMIT, reservePerChunk);
  const n = rawChunks.length;
  for (let i = 0; i < n; i++) {
    const prefix = n > 1 ? `(${i + 1}/${n})\n` : "";
    const room = DISCORD_CONTENT_LIMIT - prefix.length;
    let body = rawChunks[i]!;
    if (body.length > room) body = body.slice(0, room);
    await send(prefix + body);
  }
}
