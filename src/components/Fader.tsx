/**
 * Professional vertical fader — pointer drag, scroll-wheel, keyboard, double-click.
 * 0.5% quantization. Volume readout above fader.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface FaderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  showValue?: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const quantize = (v: number) => Math.round(v * 200) / 200;

export default function Fader({ value, onChange, disabled, showValue = true }: FaderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const setFromClientY = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const r = track.getBoundingClientRect();
    // ratio = 1 at top (clientY = r.top), 0 at bottom (clientY = r.bottom)
    const ratio = 1 - (clientY - r.top) / r.height;
    onChangeRef.current(quantize(clamp01(ratio)));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.005 : 0.025);
      onChangeRef.current(quantize(clamp01(valueRef.current + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") e.preventDefault();
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") e.preventDefault();
    if (e.key === "PageUp") e.preventDefault();
    if (e.key === "PageDown") e.preventDefault();
    if (e.key === "Home") e.preventDefault();
    if (e.key === "End") e.preventDefault();

    let next: number | null = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = valueRef.current + 0.03;
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = valueRef.current - 0.03;
    if (e.key === "PageUp") next = valueRef.current + 0.1;
    if (e.key === "PageDown") next = valueRef.current - 0.1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = 1;
    if (next !== null) onChangeRef.current(quantize(clamp01(next)));
  }, []);

  const pct = Math.round(value * 100);

  // Height of track container = 160px (h-40). Height of thumb cap = 28px (h-7).
  // Available travel = 160 - 28 = 132px.
  // When value = 1 (100% / max), top = 0px. When value = 0 (0% / mute), top = 132px.
  const topPx = (1 - value) * 132;

  return (
    <div className="flex select-none flex-col items-center relative">
      {/* Percentage readout above fader */}
      {showValue && (
        <span
          className={`absolute -top-7 left-1/2 -translate-x-1/2 typmo-number text-[11px] ${
            disabled ? "text-ink-500" : "text-ink-300"
          }`}
          style={{ pointerEvents: "none" }}
        >
          {pct}%
        </span>
      )}

      <div
        ref={trackRef}
        className={`relative h-40 w-11 touch-none ${disabled ? "opacity-40" : "cursor-pointer"}`}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDragging(true);
          setFromClientY(e.clientY);
        }}
        onPointerMove={(e) => { if (dragging) setFromClientY(e.clientY); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => !disabled && onChangeRef.current(1)}
        title="Drag to adjust. Scroll wheel or Shift+wheel for fine control. Double-click = 100%."
      >
        {/* Fader slot */}
        <div className="absolute bottom-0 left-1/2 top-0 flex h-full w-8 -translate-x-1/2 items-center">
          <div className="relative flex-1 h-full">
            {/* Slot track background */}
            <div className="absolute top-1 bottom-1 left-3 right-1.5 h-full rounded-sm bg-[#050708] border border-[rgba(255,255,255,0.08)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)]" />
            {/* Post-fader level fill */}
            <div
              className="absolute bottom-1 left-3 w-full bg-gradient-to-t from-[#33d1b8]/25 via-[#33d1b8]/8 to-transparent rounded-sm transition-none"
              style={{ height: `${value * 100}%` }}
            />
            {/* Tick marks */}
            {[0, 25, 50, 75, 100].map((t) => (
              <div
                key={t}
                className="absolute left-0 z-0 h-px w-full"
                style={{ bottom: `${t}%`, opacity: t === 100 ? 0.6 : 0.25 }}
              >
                <span
                  className="absolute left-1.5 right-1.5 block h-px"
                  style={{ background: t === 100 ? "#eef0f3" : "#666d78" }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Thumb cap */}
        <div
          role="slider"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Volume fader"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          onKeyDown={onKeyDown}
          className={`absolute left-1/2 w-8 h-7 -translate-x-1/2 border-0 rounded-sm bg-gradient-to-b from-[#23262c] to-[#0c0e11] shadow-[0_4px_8px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.1)] transition-none ${
            dragging ? "cursor-grabbing" : ""
          }`}
          style={{
            top: `${topPx}px`,
          }}
        >
          {/* Track cap detail */}
          <div className="absolute inset-1 mx-auto h-5 w-4 rounded-sm bg-gradient-to-b from-[#2a2f36] to-[#0c0e11] border border-[rgba(255,255,255,0.1)]" />
          {/* Accent line on top of cap */}
          <div
            className="absolute left-0 right-0 top-0 h-0.5 rounded-sm bg-gradient-to-r from-transparent via-signal to-transparent"
            style={{ opacity: value > 0 ? "1" : "0.25" }}
          />
        </div>
      </div>
    </div>
  );
}
