/**
 * SonoraMix — lightweight i18n.
 *
 * Flat-key dictionary (EN/ES) with `{name}` interpolation and a tiny external
 * store so `useT()` re-renders whenever the language changes.
 */

import { useSyncExternalStore } from "react";

export type Lang = "en" | "es";

const en: Record<string, string> = {
  // Header
  "header.tagline": "Audio Session Console",
  "header.output": "Output",
  "header.mic": "Mic",
  "header.settings": "Settings",
  "header.updates": "Updates",
  "header.update": "Update",
  "header.updating": "Updating…",
  "header.checking": "Checking…",
  "header.tray": "Tray",
  "header.wasapiLive": "WASAPI LIVE",
  "header.wasapiStandby": "WASAPI STANDBY",

  // Console bar
  "console.title": "STUDIO MIXING CONSOLE",
  "console.subtitle": "Dual-Deck WASAPI Session Routing",
  "console.search": "Search channels… (Ctrl+F)",
  "console.dual": "DUAL CONSOLE",
  "console.outputs": "OUTPUTS",
  "console.inputs": "INPUTS",

  // Sections
  "meters.title": "DEVICE BUS METERS",
  "meters.subtitle": "actual hardware level — post device volume",
  "meters.output": "Output Device",
  "meters.input": "Input Device",
  "inputConsole.title": "INPUT CONSOLE — MICROPHONES & RECORDING",
  "inputConsole.channels": "ACTIVE CAPTURE CHANNELS",
  "inputConsole.channel": "ACTIVE CAPTURE CHANNEL",
  "inputConsole.empty": "No microphone channels detected",
  "inputConsole.emptyHint":
    "Windows only creates mic channels while an app is actually using the microphone — in a Discord call, OBS recording or voice chat. Start using your mic and the channel appears here automatically.",
  "outputConsole.title": "OUTPUT CONSOLE — APPLICATION PLAYBACK & GAMES",
  "outputConsole.channels": "ACTIVE PLAYBACK CHANNELS",
  "outputConsole.channel": "ACTIVE PLAYBACK CHANNEL",
  "outputConsole.empty": "No active playback audio sessions detected",
  "outputConsole.emptyHint": "Play some audio in any app and its channel appears here.",
  "search.noMatch": "No channels match “{query}”",
  "search.hint": "Try a different search term or clear the filter.",
  "search.clear": "Clear Search",
  "search.rescan": "Rescan Sessions",
  "search.rescanOutput": "Rescan Audio Sessions",

  // Channel strip
  "channel.renameHint": "{exe} — double-click to rename",
  "channel.pin": "Pin {name} to the top",
  "channel.unpin": "Unpin {name}",
  "channel.live": "LIVE",
  "channel.standby": "STANDBY",
  "channel.activeCapture": "Actively capturing audio",
  "channel.heldCapture":
    "Held by the app but silent — start talking or recording to see it go LIVE",
  "channel.route": "Route {name} to…",
  "channel.routeReset": "Reset to system default",
  "channel.routeNoDevices": "No output devices found",
  "channel.routeNow": "Now",
  "channel.routeDisabled": "{name} (disabled — enable it first)",
  "channel.routeTitle": "Output: {device} — click to change",
  "channel.routeDefaultTitle": "Output: system default — click to route {name}",
  "channel.routeResetTitle": "Reset {name} to the system default device",
  "channel.systemDefault": "System default",
  "channel.customDevice": "Custom device",
  "channel.openWindows": "Open Windows per-app settings…",
  "channel.mute": "MUTE",
  "channel.muted": "MUTED",
  "channel.muteTitle": "Mute {name}",
  "channel.unmuteTitle": "Unmute {name}",
  "master.out": "MASTER OUT",
  "master.bus": "BUS",
  "master.muteTitle": "Mute master output",
  "master.unmuteTitle": "Unmute master output",
  "master.awaiting": "awaiting endpoint…",
  "channel.solo": "SOLO",
  "channel.soloed": "SOLOED",
  "channel.soloTitle": "Solo {name} — mute all other channels",
  "channel.unsoloTitle": "Unsolo {name}",
  "channel.pk": "PK",
  "channel.dbfs": "dBFS",

  // Scenes
  "scenes.title": "SCENES",
  "scenes.empty": "No scenes saved yet",
  "scenes.save": "Save current as…",
  "scenes.saveBtn": "Save",
  "scenes.apply": "Apply scene",
  "scenes.delete": "Delete scene",
  "scenes.rename": "Rename scene",
  "scenes.namePlaceholder": "Scene name",
  "scenes.saved": "Scene saved",
  "scenes.applied": "Scene applied",
  "scenes.deleted": "Scene deleted",

  // Ducking
  "ducking.section": "Auto-Duck",
  "ducking.title": "Automatically lower apps when you speak",
  "ducking.desc": "Ducks the volume of playback channels while the microphone level is above the threshold.",
  "ducking.threshold": "Mic threshold",
  "ducking.amount": "Duck amount",
  "ducking.amountDb": "{db} dB",

  // Multi-select
  "select.multiHint": "Ctrl+click to select multiple channels",
  "select.selected": "{n} channels selected",
  "select.clear": "Clear selection",
  "channel.drag": "Drag to reorder this channel",
  "channel.dragHint": "Drag the grip to reorder channels — the order is saved.",

  // Settings drawer
  "settings.title": "SETTINGS",
  "settings.subtitle": "SonoraMix preferences",
  "settings.appearance": "Appearance",
  "settings.accentDesc": "Accent color for the whole console (outputs, master, buttons).",
  "settings.meters": "VU Meters",
  "settings.metersPreset": "Color preset",
  "settings.metersCustom": "Custom colors",
  "settings.metersGreen": "Green zone",
  "settings.metersAmber": "Amber zone",
  "settings.metersRed": "Red zone",
  "settings.metersBrightness": "Brightness",
  "settings.metersLedSize": "LED segment size",
  "settings.metersPeakHold": "Show peak-hold line",
  "settings.metersPeakHoldDesc": "Keep a bright line at the loudest level reached.",
  "settings.behavior": "Behavior",
  "settings.closeToTray": "Minimize to tray on close",
  "settings.closeToTrayDesc": "Keep running in the background when you close the window.",
  "settings.launchMinimized": "Start minimized to tray",
  "settings.launchMinimizedDesc": "Launch SonoraMix quietly in the background.",
  "settings.autostart": "Launch at Windows startup",
  "settings.autostartDesc": "Start SonoraMix automatically when you log in.",
  "settings.autostartDesktop": "Only available in the desktop app.",
  "settings.language": "Language / Idioma",
  "settings.shortcuts": "Global Shortcuts",
  "settings.shortcutMic": "Toggle microphone mute",
  "settings.shortcutMicDesc": "Mute/unmute the system mic from anywhere.",
  "settings.shortcutWindow": "Show / hide window",
  "settings.shortcutWindowDesc": "Summon or hide SonoraMix from anywhere.",
  "settings.shortcutRecording": "Press your combination… (Esc to cancel)",
  "settings.shortcutHint":
    "Click a shortcut to record a new combination (needs a modifier key). If it's already used by another app, it won't be assigned.",
  "settings.data": "Backup",
  "settings.export": "Export configuration",
  "settings.exportDesc": "Save settings, scenes and channel order to a JSON file.",
  "settings.import": "Import configuration",
  "settings.importDesc": "Restore settings from a previously exported JSON file.",
  "settings.about": "About",
  "settings.aboutDesc":
    "Native WASAPI audio session console · Rust + React (Tauri 2). Per-app volume, mute, 60 Hz metering & endpoint routing.",

  // Toasts
  "toast.wasapiOnline": "WASAPI Engine Online",
  "toast.wasapiOnlineBody": "{n} active audio session{s} detected.",
  "toast.updateAvailable": "Update Available",
  "toast.updateAvailableBody": "SonoraMix {version} is ready to download.",
  "toast.upToDate": "Up to Date",
  "toast.upToDateBody": "You are running the latest version ({version}).",
  "toast.updateCheckFailed": "Update Check Failed",
  "toast.updateFailed": "Update Failed",
  "toast.micMute": "Global Mic Mute",
  "toast.micMuted": "Microphone muted",
  "toast.micUnmuted": "Microphone unmuted",
  "toast.micMuteFailed": "Mic Mute Failed",
  "toast.shortcutUnavailable": "Shortcut Unavailable",
  "toast.shortcutInUse": "{combo} is already in use or invalid.",
  "toast.defaultOutput": "Default Output Set",
  "toast.defaultInput": "Default Mic Input Set",
  "toast.routingError": "Routing Error",
  "toast.appRouted": "App Routed",
  "toast.appRoutedBody": "{app} → {device}",
  "toast.routingFailed": "Routing Failed",
  "toast.routeReset": "Route Reset",
  "toast.routeResetBody": "{app} now uses the system default device.",
  "toast.resetFailed": "Reset Failed",
  "toast.deviceEnabled": "Device Enabled",
  "toast.deviceDisabled": "Device Disabled",
  "toast.deviceToggleFailed": "Device Toggle Failed",
  "toast.rescanComplete": "Rescan Complete",
  "toast.rescanCompleteBody": "{sessions} active session{s}, {devices} audio endpoint{s2}.",
  "toast.rescanFailed": "Rescan Failed",
  "toast.initError": "Initialization Error",
  "toast.volumeError": "Volume Error",
  "toast.muteError": "Mute Error",
  "toast.masterVolumeError": "Master Volume Error",
  "toast.masterMuteError": "Master Mute Error",
  "toast.openFailed": "Open Failed",
  "toast.windowsAppVolume": "Windows App Volume",
  "toast.windowsAppVolumeBody": "Pick the output device for this app in the Windows page.",
  "toast.exported": "Configuration exported",
  "toast.exportFailed": "Export failed",
  "toast.imported": "Configuration imported",
  "toast.importFailed": "Import failed",
  "toast.importInvalid": "Not a valid SonoraMix backup file",
  "toast.duckActive": "Auto-Duck Active",
  "toast.duckActiveBody": "Lowering playback volume while you speak.",
  "toast.duckOff": "Auto-Duck released",

  // Status bar
  "status.stream": "Stream {hz} Hz",
  "status.sessions": "{n} active session{s}",
  "status.frames": "{n} frames",
  "status.master": "Master",
  "status.uptime": "UP {time}",
  "status.engine": "WASAPI · COM-MTA",

  // Footer
  "footer.engine": "Native WASAPI Session API · IPolicyConfig Endpoint Routing · 60 Hz Phase-Locked Stream",
  "footer.rescan": "RESCAN",

  // Update banner
  "update.available": "SonoraMix v{version} available",
  "update.ready": "A new version of SonoraMix is ready to install.",
  "update.downloading": "Downloading update…",
  "update.install": "Download & Install",
  "update.later": "Later",

  // Boot
  "boot.skip": "Click or press Esc to skip",
  "boot.step1": "Initializing COM apartment (MTA)",
  "boot.step2": "Scanning audio endpoints",
  "boot.step3": "Enumerating active WASAPI sessions",
  "boot.step4": "Meter stream · 60 Hz phase-locked",

  // Error boundary
  "error.title": "Something went wrong",
  "error.recover": "Recover",
};

const es: Record<string, string> = {
  // Header
  "header.tagline": "Consola de sesiones de audio",
  "header.output": "Salida",
  "header.mic": "Mic",
  "header.settings": "Ajustes",
  "header.updates": "Actualizaciones",
  "header.update": "Actualizar",
  "header.updating": "Actualizando…",
  "header.checking": "Comprobando…",
  "header.tray": "Bandeja",
  "header.wasapiLive": "WASAPI EN VIVO",
  "header.wasapiStandby": "WASAPI EN ESPERA",

  // Console bar
  "console.title": "CONSOLA DE MEZCLAS",
  "console.subtitle": "Ruteo de sesiones WASAPI de doble cubierta",
  "console.search": "Buscar canales… (Ctrl+F)",
  "console.dual": "CONSOLA DOBLE",
  "console.outputs": "SALIDAS",
  "console.inputs": "ENTRADAS",

  // Sections
  "meters.title": "MEDIDORES DEL BUS DE DISPOSITIVO",
  "meters.subtitle": "nivel real del hardware — tras el volumen del dispositivo",
  "meters.output": "Dispositivo de salida",
  "meters.input": "Dispositivo de entrada",
  "inputConsole.title": "CONSOLA DE ENTRADA — MICRÓFONOS Y GRABACIÓN",
  "inputConsole.channels": "CANALES DE CAPTURA ACTIVOS",
  "inputConsole.channel": "CANAL DE CAPTURA ACTIVO",
  "inputConsole.empty": "No se detectaron canales de micrófono",
  "inputConsole.emptyHint":
    "Windows solo crea canales de micrófono cuando una app lo está usando de verdad — en una llamada de Discord, grabando con OBS o en un chat de voz. Empieza a usar el micro y el canal aparecerá aquí automáticamente.",
  "outputConsole.title": "CONSOLA DE SALIDA — REPRODUCCIÓN DE APPS Y JUEGOS",
  "outputConsole.channels": "CANALES DE REPRODUCCIÓN ACTIVOS",
  "outputConsole.channel": "CANAL DE REPRODUCCIÓN ACTIVO",
  "outputConsole.empty": "No se detectaron sesiones de audio activas",
  "outputConsole.emptyHint": "Reproduce audio en cualquier app y su canal aparecerá aquí.",
  "search.noMatch": "Ningún canal coincide con “{query}”",
  "search.hint": "Prueba otro término de búsqueda o borra el filtro.",
  "search.clear": "Borrar búsqueda",
  "search.rescan": "Volver a escanear",
  "search.rescanOutput": "Escanear sesiones de audio",

  // Channel strip
  "channel.renameHint": "{exe} — doble clic para renombrar",
  "channel.pin": "Fijar {name} arriba",
  "channel.unpin": "Desfijar {name}",
  "channel.live": "EN VIVO",
  "channel.standby": "EN ESPERA",
  "channel.activeCapture": "Capturando audio activamente",
  "channel.heldCapture":
    "La app lo mantiene pero está en silencio — empieza a hablar o grabar para verlo EN VIVO",
  "channel.route": "Rutear {name} a…",
  "channel.routeReset": "Restablecer al predeterminado",
  "channel.routeNoDevices": "No se encontraron dispositivos de salida",
  "channel.routeNow": "Ahora",
  "channel.routeDisabled": "{name} (deshabilitado — actívalo primero)",
  "channel.routeTitle": "Salida: {device} — clic para cambiar",
  "channel.routeDefaultTitle": "Salida: predeterminado del sistema — clic para rutear {name}",
  "channel.routeResetTitle": "Restablecer {name} al dispositivo predeterminado",
  "channel.systemDefault": "Predeterminado del sistema",
  "channel.customDevice": "Dispositivo personalizado",
  "channel.openWindows": "Abrir ajustes de Windows por app…",
  "channel.mute": "MUTE",
  "channel.muted": "MUTEADO",
  "channel.muteTitle": "Silenciar {name}",
  "channel.unmuteTitle": "Quitar silencio a {name}",
  "master.out": "MASTER OUT",
  "master.bus": "BUS",
  "master.muteTitle": "Silenciar el master",
  "master.unmuteTitle": "Quitar silencio al master",
  "master.awaiting": "esperando endpoint…",
  "channel.solo": "SOLO",
  "channel.soloed": "EN SOLO",
  "channel.soloTitle": "Solo de {name} — silencia el resto de canales",
  "channel.unsoloTitle": "Quitar solo a {name}",
  "channel.pk": "PK",
  "channel.dbfs": "dBFS",

  // Scenes
  "scenes.title": "ESCENAS",
  "scenes.empty": "Aún no hay escenas guardadas",
  "scenes.save": "Guardar actual como…",
  "scenes.saveBtn": "Guardar",
  "scenes.apply": "Aplicar escena",
  "scenes.delete": "Eliminar escena",
  "scenes.rename": "Renombrar escena",
  "scenes.namePlaceholder": "Nombre de la escena",
  "scenes.saved": "Escena guardada",
  "scenes.applied": "Escena aplicada",
  "scenes.deleted": "Escena eliminada",

  // Ducking
  "ducking.section": "Auto-Duck",
  "ducking.title": "Bajar las apps automáticamente al hablar",
  "ducking.desc": "Reduce el volumen de los canales de reproducción mientras el nivel del micro supera el umbral.",
  "ducking.threshold": "Umbral del micro",
  "ducking.amount": "Cantidad de atenuación",
  "ducking.amountDb": "{db} dB",

  // Multi-select
  "select.multiHint": "Ctrl+clic para seleccionar varios canales",
  "select.selected": "{n} canales seleccionados",
  "select.clear": "Borrar selección",
  "channel.drag": "Arrastra para reordenar este canal",
  "channel.dragHint": "Arrastra el asa para reordenar los canales — el orden se guarda.",

  // Settings drawer
  "settings.title": "AJUSTES",
  "settings.subtitle": "Preferencias de SonoraMix",
  "settings.appearance": "Apariencia",
  "settings.accentDesc": "Color de acento para toda la consola (salidas, master, botones).",
  "settings.meters": "Medidores VU",
  "settings.metersPreset": "Preset de color",
  "settings.metersCustom": "Colores personalizados",
  "settings.metersGreen": "Zona verde",
  "settings.metersAmber": "Zona ámbar",
  "settings.metersRed": "Zona roja",
  "settings.metersBrightness": "Brillo",
  "settings.metersLedSize": "Tamaño de segmento LED",
  "settings.metersPeakHold": "Mostrar línea de pico",
  "settings.metersPeakHoldDesc": "Mantén una línea brillante en el nivel más alto alcanzado.",
  "settings.behavior": "Comportamiento",
  "settings.closeToTray": "Minimizar a la bandeja al cerrar",
  "settings.closeToTrayDesc": "Sigue ejecutándose en segundo plano al cerrar la ventana.",
  "settings.launchMinimized": "Iniciar minimizado en la bandeja",
  "settings.launchMinimizedDesc": "Lanza SonoraMix en silencio en segundo plano.",
  "settings.autostart": "Iniciar con Windows",
  "settings.autostartDesc": "Inicia SonoraMix automáticamente al iniciar sesión.",
  "settings.autostartDesktop": "Solo disponible en la app de escritorio.",
  "settings.language": "Idioma / Language",
  "settings.shortcuts": "Atajos globales",
  "settings.shortcutMic": "Alternar silencio del micro",
  "settings.shortcutMicDesc": "Silencia/activa el micro del sistema desde cualquier sitio.",
  "settings.shortcutWindow": "Mostrar / ocultar ventana",
  "settings.shortcutWindowDesc": "Abre u oculta SonoraMix desde cualquier sitio.",
  "settings.shortcutRecording": "Pulsa tu combinación… (Esc para cancelar)",
  "settings.shortcutHint":
    "Haz clic en un atajo para grabar una combinación nueva (necesita una tecla modificadora). Si otra app ya la usa, no se asignará.",
  "settings.data": "Copia de seguridad",
  "settings.export": "Exportar configuración",
  "settings.exportDesc": "Guarda ajustes, escenas y orden de canales en un archivo JSON.",
  "settings.import": "Importar configuración",
  "settings.importDesc": "Restaura ajustes desde un archivo JSON exportado antes.",
  "settings.about": "Acerca de",
  "settings.aboutDesc":
    "Consola de sesiones de audio WASAPI nativa · Rust + React (Tauri 2). Volumen por app, mute, medidores a 60 Hz y ruteo de dispositivos.",

  // Toasts
  "toast.wasapiOnline": "Motor WASAPI en línea",
  "toast.wasapiOnlineBody": "{n} sesión{s2} de audio activa{s} detectada{s}.",
  "toast.updateAvailable": "Actualización disponible",
  "toast.updateAvailableBody": "SonoraMix {version} está listo para descargar.",
  "toast.upToDate": "Estás al día",
  "toast.upToDateBody": "Tienes la última versión ({version}).",
  "toast.updateCheckFailed": "Fallo al comprobar actualización",
  "toast.updateFailed": "Fallo en la actualización",
  "toast.micMute": "Silencio global del micro",
  "toast.micMuted": "Microfono silenciado",
  "toast.micUnmuted": "Microfono activado",
  "toast.micMuteFailed": "Fallo al silenciar el micro",
  "toast.shortcutUnavailable": "Atajo no disponible",
  "toast.shortcutInUse": "{combo} ya está en uso o no es válido.",
  "toast.defaultOutput": "Salida predeterminada configurada",
  "toast.defaultInput": "Entrada de micro predeterminada configurada",
  "toast.routingError": "Error de ruteo",
  "toast.appRouted": "App ruteada",
  "toast.appRoutedBody": "{app} → {device}",
  "toast.routingFailed": "Fallo al rutear",
  "toast.routeReset": "Ruteo restablecido",
  "toast.routeResetBody": "{app} ahora usa el dispositivo predeterminado del sistema.",
  "toast.resetFailed": "Fallo al restablecer",
  "toast.deviceEnabled": "Dispositivo activado",
  "toast.deviceDisabled": "Dispositivo desactivado",
  "toast.deviceToggleFailed": "Fallo al alternar el dispositivo",
  "toast.rescanComplete": "Escaneo completado",
  "toast.rescanCompleteBody": "{sessions} sesión{s} activa{s}, {devices} dispositivo{s2} de audio.",
  "toast.rescanFailed": "Fallo al escanear",
  "toast.initError": "Error de inicialización",
  "toast.volumeError": "Error de volumen",
  "toast.muteError": "Error de silencio",
  "toast.masterVolumeError": "Error de volumen del master",
  "toast.masterMuteError": "Error de silencio del master",
  "toast.openFailed": "No se pudo abrir",
  "toast.windowsAppVolume": "Volumen de apps de Windows",
  "toast.windowsAppVolumeBody": "Elige el dispositivo de salida de esta app en la página de Windows.",
  "toast.exported": "Configuración exportada",
  "toast.exportFailed": "Fallo al exportar",
  "toast.imported": "Configuración importada",
  "toast.importFailed": "Fallo al importar",
  "toast.importInvalid": "No es un archivo de respaldo válido de SonoraMix",
  "toast.duckActive": "Auto-Duck activo",
  "toast.duckActiveBody": "Reduciendo el volumen de reproducción mientras hablas.",
  "toast.duckOff": "Auto-Duck liberado",

  // Status bar
  "status.stream": "Flujo {hz} Hz",
  "status.sessions": "{n} sesión{s} activa{s}",
  "status.frames": "{n} fotogramas",
  "status.master": "Master",
  "status.uptime": "UP {time}",
  "status.engine": "WASAPI · COM-MTA",

  // Footer
  "footer.engine": "API de sesiones WASAPI nativa · Ruteo de endpoints IPolicyConfig · Flujo a 60 Hz",
  "footer.rescan": "REESCANEAR",

  // Update banner
  "update.available": "SonoraMix v{version} disponible",
  "update.ready": "Hay una versión nueva de SonoraMix lista para instalar.",
  "update.downloading": "Descargando actualización…",
  "update.install": "Descargar e instalar",
  "update.later": "Después",

  // Boot
  "boot.skip": "Haz clic o pulsa Esc para saltar",
  "boot.step1": "Inicializando apartamento COM (MTA)",
  "boot.step2": "Escaneando dispositivos de audio",
  "boot.step3": "Enumerando sesiones WASAPI activas",
  "boot.step4": "Flujo de medidores · 60 Hz",

  // Error boundary
  "error.title": "Algo salió mal",
  "error.recover": "Recuperar",
};

const dicts: Record<Lang, Record<string, string>> = { en, es };

let lang: Lang = "en";
const listeners = new Set<() => void>();

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  listeners.forEach((fn) => fn());
}

export function getLang(): Lang {
  return lang;
}

/** Translate a key, interpolating `{name}` placeholders from `params`. */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

/**
 * React hook — returns the `t` function and re-renders the component when the
 * language changes (via useSyncExternalStore).
 */
export function useT(): typeof t {
  useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => lang,
  );
  return t;
}

/** Subscribe to language changes (for non-React callers). */
export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Detect the preferred language from the browser/OS locale.
 */
export function detectLang(): Lang {
  try {
    const nav = navigator.language ?? "en";
    return nav.toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}
