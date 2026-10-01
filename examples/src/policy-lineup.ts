// The playback policy line: one soldier per loop mode, side by side, so the
// three are compared at a glance rather than one after another.
//
// The panel sets the rest of the policy — the repetition count, the end mode
// and the speed — and the page writes it to the whole line, so every loop mode
// answers the same input. The writes are the page's, because they are the
// recipe; this module only says who stands in the line and what each is
// called, so policy-lineup.test.ts can play the line in Node.
import { LoopMode } from "three-vat";

/** One soldier of the line: its loop mode, the name its label gives it, and whether it reads the count. */
export interface LineupEntry {
  name: string;
  loopMode: LoopMode;
  /** Once plays the clip through one time, so the count is not its to read. */
  counted: boolean;
}

/** The line, left to right. */
export const LINEUP: readonly LineupEntry[] = [
  { name: "Repeat", loopMode: LoopMode.Repeat, counted: true },
  { name: "Once", loopMode: LoopMode.Once, counted: false },
  { name: "PingPong", loopMode: LoopMode.PingPong, counted: true },
];

/** A soldier's label: its loop mode, and the count where that mode reads one. */
export function labelOf({ name, counted }: LineupEntry, repetitions: number): string {
  return counted ? `${name} × ${repetitions}` : name;
}
