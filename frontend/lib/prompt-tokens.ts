import { MODEL } from "@/lib/contract";

/**
 * Estimate how many CLIP tokens a prompt uses, without shipping the 1.6 MB
 * CLIP vocabulary to the browser.
 *
 * It mirrors CLIP's pre-tokenizer (lowercased words, single digits, and runs of
 * punctuation) and approximates byte-pair encoding by length: short words are
 * almost always one token, longer or rarer words split into several. It is
 * deliberately a little pessimistic, so the UI warns before the model truncates
 * rather than after. The backend reports the exact answer in
 * `params.prompt_truncated`.
 */
const PIECES = /'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu;

export function estimatePromptTokens(text: string): number {
  let tokens = 0;
  for (const [piece] of text.toLowerCase().matchAll(PIECES)) {
    if (/^\p{L}/u.test(piece)) tokens += piece.length <= 7 ? 1 : Math.ceil(piece.length / 5);
    else if (/^\p{N}$/u.test(piece)) tokens += 1;
    else tokens += piece.startsWith("'") ? 1 : piece.length;
  }
  return tokens;
}

/** True when the prompt likely runs past what the text encoders read. */
export function exceedsPromptTokens(text: string): boolean {
  return estimatePromptTokens(text) > MODEL.maxPromptTokens;
}
