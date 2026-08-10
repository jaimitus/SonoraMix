/**
 * Floating "update available" banner.
 *
 * Slides in below the header when a new SonoraMix release is found, shows the
 * incoming version plus release notes, and runs the download/install flow with
 * a live progress bar. Dismissible without losing the header update indicator.
 */
import type { Update } from "@tauri-apps/plugin-updater";
import { useT } from "../i18n";

interface UpdateBannerProps {
  update: Update;
  /** True while the update is being downloaded/installed */
  installing: boolean;
  /** 0..1 download completion ratio */
  progress: number;
  /** Bytes downloaded so far (0 when unknown) */
  downloaded: number;
  /** Total bytes to download (0 when unknown) */
  total: number;
  onInstall: () => void;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export default function UpdateBanner({
  update,
  installing,
  progress,
  downloaded,
  total,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  const t = useT();
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div className="fixed left-1/2 top-[74px] z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 animate-[fade-in_0.28s_ease_both]">
      <div className="glass-panel rounded-xl border border-signal/30 px-4 py-3.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-signal/25 bg-signal/10 shadow-[0_0_14px_rgba(255,121,64,0.22)]">
            <svg
              viewBox="0 0 16 16"
              className="h-4 w-4 text-signal"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <path
                d="M4.5 6.5A3.5 3.5 0 1 1 8 3a3.5 3.5 0 0 1 4 2.5A2.5 2.5 0 0 1 12 10.5H10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M8 8v4M6.2 10.2 8 12l1.8-1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-display text-[13px] font-bold tracking-tight text-ink-100">
                {t("update.available", { version: update.version })}
              </p>
              <span className="led led-green led-pulse" aria-hidden="true" />
            </div>
            {update.body ? (
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-300">{update.body}</p>
            ) : (
              <p className="mt-1 text-[11px] leading-snug text-ink-300">
                {t("update.ready")}
              </p>
            )}
          </div>
        </div>

        {installing ? (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full border border-rule/50 bg-ink-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-signal to-route transition-[width] duration-150 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="typo-monoline text-[10px]">{t("update.downloading")}</span>
              <span className="typo-number text-[10px] text-ink-300">
                {total > 0 ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : pct > 0 ? `${pct}%` : "starting"}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onInstall}
              className="btn btn-primary flex-1 justify-center text-[12px] font-bold"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M8 2.5v7M5.4 7 8 9.6 10.6 7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 11.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" />
              </svg>
              {t("update.install")}
            </button>
            <button type="button" onClick={onDismiss} className="btn btn-ghost">
              {t("update.later")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
