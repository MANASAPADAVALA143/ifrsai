/** Extract and repair JSON from Claude / LLM text responses. */

export function stripMarkdownFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return s.trim();
}

export function extractJsonObject(text: string): string {
  const s = stripMarkdownFences(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return s;
}

/** Best-effort repair for truncated JSON (max_tokens cut-off). */
export function repairTruncatedJson(s: string): string {
  let t = s.trim();
  // Drop trailing incomplete key/string value
  t = t.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*$/s, '');
  t = t.replace(/,\s*"[^"]*$/s, '');
  t = t.replace(/:\s*"[^"\\]*(?:\\.[^"\\]*)*$/s, ': ""');
  t = t.replace(/,\s*$/s, '');

  const openBrace = (t.match(/{/g) || []).length;
  const closeBrace = (t.match(/}/g) || []).length;
  const openBracket = (t.match(/\[/g) || []).length;
  const closeBracket = (t.match(/]/g) || []).length;

  t += ']'.repeat(Math.max(0, openBracket - closeBracket));
  t += '}'.repeat(Math.max(0, openBrace - closeBrace));
  return t;
}

export function parseAiJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string
): T {
  const candidates = [
    stripMarkdownFences(text),
    extractJsonObject(text),
    repairTruncatedJson(extractJsonObject(text)),
  ];

  let lastErr: Error | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastErr ?? new Error('Could not parse AI JSON response');
}
