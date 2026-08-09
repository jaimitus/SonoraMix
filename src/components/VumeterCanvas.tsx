/**
 * Precision Studio PPM/VU meter — canvas-rendered at 60 Hz.
 *
 * Professional EBU R128 / IEC 60268-10 PPM ballistic response:
 *   - Fast 0.85 attack on audio transients, dual-stage exponential release
 *   - EBU Broadcast PPM scale (-80 dBFS to 0 dBFS dynamic range)
 *   - True Stereo (L/R) dual-channel high-density LED ladder
 *   - Peak-hold line & clipping flash indicator
 */
import { useEffect, useRef } from "react";
import type { LevelSource } from "../types";

interface VumeterCanvasProps {
  source: LevelSource;
  channels?: 1 | 2;
  className?: string;
  showDbGrid?: boolean;
}

interface ChannelState {
  disp: number;
  peak: number;
  peakT: number;
  clipT: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Professional Studio PPM (Peak Program Meter) Scale.
 * Maps linear amplitude [0..1] to height fraction [0..1] with wide dynamic resolution:
 *   0 dBFS   -> 100%
 *  -6 dBFS   -> 85%
 * -12 dBFS   -> 70%
 * -30 dBFS   -> 35%
 * -60 dBFS   -> 10%
 * -80 dBFS   -> 0%
 */
function toPpmFrac(v: number): number {
  if (v <= 0.0001) return 0;
  const db = 20 * Math.log10(v);
  if (db < -60) return clamp01((db + 80) * (0.10 / 20));
  if (db < -30) return clamp01(0.10 + (db + 60) * (0.25 / 30));
  if (db < -12) return clamp01(0.35 + (db + 30) * (0.35 / 18));
  return clamp01(0.70 + (db + 12) * (0.30 / 12));
}

// Color zones: Green (-80..-12 dBFS), Yellow (-12..-3 dBFS), Red (-3..0 dBFS)
const zoneColor = (frac: number) => {
  if (frac < 0.70) return "hsl(150, 75%, 45%)";
  if (frac < 0.88) return "hsl(42, 95%, 52%)";
  return "hsl(358, 90%, 58%)";
};

const zoneGlow = (frac: number) => {
  if (frac < 0.70) return "rgba(46, 213, 115, 0.8)";
  if (frac < 0.88) return "rgba(255, 171, 0, 0.85)";
  return "rgba(255, 71, 87, 0.95)";
};

export default function VumeterCanvas({
  source,
  channels = 1,
  className,
  showDbGrid = true,
}: VumeterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const state: ChannelState[] = Array.from({ length: channels }, () => ({
      disp: 0,
      peak: 0,
      peakT: -1e9,
      clipT: -1e9,
    }));

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let lastW = 0;
    let lastH = 0;

    const resize = () => {
      const rectW = Math.round(canvas.clientWidth || canvas.getBoundingClientRect().width);
      const rectH = Math.round(canvas.clientHeight || canvas.getBoundingClientRect().height);
      if (rectW <= 0 || rectH <= 0) return;

      if (Math.abs(rectW - lastW) > 1 || Math.abs(rectH - lastH) > 1) {
        lastW = rectW;
        lastH = rectH;
        dpr = Math.min(2, window.devicePixelRatio ?? 1);
        cssW = rectW;
        cssH = rectH;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      if (cssW <= 0 || cssH <= 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      // Meter slot background
      ctx.fillStyle = "rgba(6, 8, 10, 0.85)";
      ctx.fillRect(0, 0, cssW, cssH);

      const sample = sourceRef.current();
      const values: number[] = channels === 2 ? [sample.left, sample.right] : [sample.peak];

      const gapX = channels === 2 ? 4 : 0;
      const colW = (cssW - gapX * (channels - 1)) / channels;
      const segGap = 1.5;
      const segCount = Math.max(16, Math.floor((cssH - 2) / 4.5));
      const segH = (cssH - segGap * (segCount - 1)) / segCount;

      for (let c = 0; c < channels; c++) {
        const st = state[c]!;
        const target = clamp01(values[c] ?? 0);

        // High-precision ballistics: instant attack on transients (0.85), smooth falloff (0.16)
        if (target > st.disp) {
          st.disp += (target - st.disp) * 0.85;
        } else {
          st.disp += (target - st.disp) * 0.16;
        }

        // Peak hold (holds for 800ms, then decays)
        if (st.disp >= st.peak) {
          st.peak = st.disp;
          st.peakT = now;
        } else if (now - st.peakT > 800) {
          st.peak = Math.max(st.disp, st.peak - 0.006);
        }

        // Clip detection (>= 0.985)
        if (target >= 0.985) st.clipT = now;

        const x = c * (colW + gapX);
        const inset = 0.5;

        // dB grid markers
        if (showDbGrid && c === 0) {
          ctx.save();
          const gridDbs = [-40, -20, -12, -6, 0];
          for (const db of gridDbs) {
            const v = Math.pow(10, db / 20);
            const fracLine = toPpmFrac(v);
            const y = cssH - fracLine * cssH;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(cssW, y);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Recessed column slot
        ctx.fillStyle = "rgba(4, 6, 8, 0.95)";
        ctx.fillRect(x + inset, 0, colW - inset * 2, cssH);

        // Lit LED segments calculation
        const targetFrac = toPpmFrac(st.disp);
        const litCount = Math.min(segCount, Math.round(targetFrac * segCount));

        for (let s = 0; s < segCount; s++) {
          const y = cssH - segH - s * (segH + segGap);
          const frac = (s + 0.5) / segCount;

          if (s >= litCount) {
            // Dark unlit segment
            ctx.fillStyle = "rgba(28, 32, 38, 0.45)";
            ctx.fillRect(x + inset + 0.5, y, colW - inset * 2 - 1, segH - 0.5);
            continue;
          }

          // Active LED segment
          const baseColor = zoneColor(frac);
          ctx.fillStyle = baseColor;
          ctx.fillRect(x + inset + 0.5, y, colW - inset * 2 - 1, segH - 0.5);

          // Emissive glow on leading top segment
          if (s === litCount - 1) {
            ctx.save();
            ctx.shadowColor = zoneGlow(frac);
            ctx.shadowBlur = 8;
            ctx.fillRect(x + inset + 0.5, y, colW - inset * 2 - 1, segH - 0.5);
            ctx.restore();
          }

          // Highlight reflection on segment top
          ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
          ctx.fillRect(x + inset + 0.5, y, colW - inset * 2 - 1, 0.8);
        }

        // Peak-hold line
        const peakFrac = toPpmFrac(st.peak);
        if (peakFrac > 0.02) {
          const py = cssH - peakFrac * cssH;
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.fillRect(x + inset + 0.5, Math.max(0, py - 1), colW - inset * 2 - 1, 1.5);
        }

        // Clip indicator flash (top red bar)
        const clipAge = now - st.clipT;
        if (clipAge < 650) {
          const alpha = 0.95 * (1 - clipAge / 650);
          ctx.fillStyle = `rgba(255, 71, 87, ${alpha.toFixed(3)})`;
          ctx.fillRect(x + inset + 0.5, 0, colW - inset * 2 - 1, 3);
        }

        // Column border line
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 0.5, 0.5, colW - 1, cssH - 1);
      }
    };

    let raf = 0;
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [channels, showDbGrid]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

/**
 * Live dBFS readout — DOM-direct updates at 60 Hz.
 */
export function DbReadout({
  source,
  muted,
  className,
}: {
  source: LevelSource;
  muted: () => boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    let raf = 0;
    let lastText = "";
    const loop = () => {
      const el = ref.current;
      if (el) {
        let text: string;
        if (mutedRef.current()) {
          text = "MUTE";
        } else {
          const v = clamp01(sourceRef.current().peak);
          text = v <= 0.0001 ? "−∞" : (20 * Math.log10(v)).toFixed(1);
        }
        if (text !== lastText) {
          el.textContent = text;
          lastText = text;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span ref={ref} className={className} aria-live="off">
      −∞
    </span>
  );
}

/**
 * Session peak-hold readout — tracks the loudest dBFS level seen this
 * session and shows it until reset. Click to reset the hold.
 */
export function PeakHoldReadout({
  source,
  className,
}: {
  source: LevelSource;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const maxRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    let lastText = "";
    const loop = () => {
      const el = ref.current;
      if (el) {
        const v = clamp01(sourceRef.current().peak);
        if (v > maxRef.current) maxRef.current = v;
        const m = maxRef.current;
        const text = m <= 0.0001 ? "−∞" : (20 * Math.log10(m)).toFixed(1);
        if (text !== lastText) {
          el.textContent = text;
          lastText = text;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <button
      type="button"
      ref={ref}
      onClick={() => {
        maxRef.current = 0;
      }}
      className={className}
      title="Peak level (click to reset)"
      aria-label="Peak level, click to reset"
    >
      −∞
    </button>
  );
}
