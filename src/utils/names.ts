/** Human-readable display names for well-known executables. */
export const DISPLAY_NAMES: Record<string, string> = {
  "spotify.exe": "Spotify",
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "firefox.exe": "Firefox",
  "discord.exe": "Discord",
  "cs2.exe": "Counter-Strike 2",
  "obs64.exe": "OBS Studio",
  "vlc.exe": "VLC",
  "steam.exe": "Steam",
  "teams.exe": "Teams",
  "slack.exe": "Slack",
  "zoom.exe": "Zoom",
  "windowsterminal.exe": "Terminal",
  "code.exe": "VS Code",
  "devenv.exe": "Visual Studio",
  "ms-teams.exe": "Teams",
  "thunderbird.exe": "Thunderbird",
  "notion-app.exe": "Notion",
};

/** Resolve a friendly display name from an executable filename. */
export function getDisplayName(exe: string): string {
  const n = exe.toLowerCase();
  if (DISPLAY_NAMES[n]) return DISPLAY_NAMES[n];
  const base = exe.replace(/\.exe$/i, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}
