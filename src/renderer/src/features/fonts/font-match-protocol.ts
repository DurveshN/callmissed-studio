/** Line height of text layers created from detected text (the matcher positions ink for it). */
export const TEXT_LINE_HEIGHT = 1.2

export interface FontMatchRequest {
  text: string
  /** Upright crop of the line: 255 = ink. */
  mask: Uint8Array
  width: number
  height: number
}

export interface FontMatchResult {
  family: string
  weight: number
  /** Font size in crop pixels. */
  fontSize: number
  /** Overlap score in [-0.6, 1]; higher is better. */
  score: number
  /**
   * Where the text box's top-left must sit, relative to the crop's top-left, so the rendered ink
   * lands on the original ink (crop pixels).
   */
  inkLeft: number
  inkTop: number
}

export type FontWorkerMessage =
  { type: 'init'; baseUrl: string } | { type: 'match'; id: number; request: FontMatchRequest }

export type FontWorkerReply = { id: number; result: FontMatchResult | null } | { id: number; error: string }
