/** Format a linear volume (0..1) as a dBFS string (e.g. "-2.1", "−∞"). */
export function volumeToDb(volume: number): string {
  if (volume <= 0.0001) return "−∞";
  return (20 * Math.log10(volume)).toFixed(1);
}
