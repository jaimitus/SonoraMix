/**
 * Meter settings context — lets any VumeterCanvas read the current meter
 * appearance (colors, brightness, LED size, peak-hold) without prop drilling
 * through SessionCard / DeviceMeters / MasterStrip.
 */
import { createContext, useContext } from "react";
import { DEFAULT_METER_SETTINGS, type MeterSettings } from "./settings";

export const MeterSettingsContext = createContext<MeterSettings>(DEFAULT_METER_SETTINGS);

/** Read the current meter appearance settings. */
export function useMeterSettings(): MeterSettings {
  return useContext(MeterSettingsContext);
}
