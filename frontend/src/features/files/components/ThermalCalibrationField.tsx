/**
 * Inline thermal-calibration picker for the Image Data upload form.
 *
 * The parent (`UploadList`) probes dropped files via
 * `src/lib/thermalProbe.ts` and renders this component only when the
 * batch is detected as thermal — no manual "this is thermal data"
 * checkbox. That removes the silent-no-worker failure mode where a
 * user dropped Boson TIFFs but forgot to flag the batch as thermal.
 *
 * The component is "dumb": it owns the mode + user-defined scale /
 * offset state and emits a `ThermalCalibration` object back to the
 * parent. When the form unmounts the field (e.g. user removed every
 * thermal file) the parent resets to `null` separately.
 */
import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  ThermalCalibration,
  ThermalCalibrationMode,
} from "@/features/import/lib/types"

interface ThermalCalibrationFieldProps {
  /** Sensible default chosen by the parent based on file shape. FLIR
   *  JPEGs → flir_one_pro (self-describing); Boson TIFFs →
   *  boson_centikelvin (what BosonUSB / farm-ng Amiga emit by
   *  default; see backend calibration.py BOSON_PRESETS). */
  defaultMode: ThermalCalibrationMode
  /**
   * Receives the chosen calibration on every change. Always emits a
   * value when the field is mounted — the parent gating this
   * component's render IS the on/off switch.
   *
   * Null is emitted only when the user-defined inputs are
   * temporarily invalid (so the parent can disable submit until the
   * numbers come back).
   */
  onChange: (next: ThermalCalibration | null) => void
}

const MODE_LABELS: Record<ThermalCalibrationMode, string> = {
  flir_one_pro: "FLIR One Pro (auto, per-file Planck)",
  // Centikelvin is what BosonUSB / farm-ng Amiga emit by default —
  // listed first among Boson modes since it's the most common in
  // practice. https://github.com/FLIR/BosonUSB
  boson_centikelvin: "Boson — centikelvin (T_K = pixel × 0.01)",
  boson_tlinear_high: "Boson TLinear — high-gain (0.04 K/count)",
  boson_tlinear_low: "Boson TLinear — low-gain (0.4 K/count)",
  boson_agc_nonradiometric: "Boson — non-radiometric (AGC, no temperature)",
  user_defined: "User-defined scale + offset",
}

const MODE_ORDER: ThermalCalibrationMode[] = [
  "flir_one_pro",
  "boson_centikelvin",
  "boson_tlinear_high",
  "boson_tlinear_low",
  "boson_agc_nonradiometric",
  "user_defined",
]

export function ThermalCalibrationField({
  defaultMode,
  onChange,
}: ThermalCalibrationFieldProps) {
  const [mode, setMode] = useState<ThermalCalibrationMode>(defaultMode)
  // Local strings so partial numeric typing (e.g. "0.0") doesn't
  // clobber to NaN as the user types.
  const [scale, setScale] = useState<string>("0.01")
  const [offset, setOffset] = useState<string>("0")

  // Sync the resolved calibration up to the parent on every change.
  // Two failure modes the parent shouldn't have to think about: a
  // user_defined entry with bad numeric input emits `null` (so the
  // parent can disable submit); otherwise emit the resolved object.
  useEffect(() => {
    if (mode === "user_defined") {
      const s = Number.parseFloat(scale)
      const o = Number.parseFloat(offset)
      if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(o)) {
        onChange(null)
        return
      }
      onChange({ mode, scale: s, offset: o })
      return
    }
    onChange({ mode })
    // onChange is parent-owned and re-created on every render; depend
    // on the actual sources of change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scale, offset])

  return (
    <div
      className="space-y-3 rounded-md border p-3"
      data-testid="thermal-calibration-field"
    >
      <div>
        <h4 className="font-medium text-sm">Thermal data detected</h4>
        <p className="text-muted-foreground text-xs">
          We found thermal frames in this batch. Pick the calibration mode
          that matches the camera so the extraction worker can compute
          per-pixel temperature. FLIR One Pro JPEGs are self-describing;
          Boson TIFFs need a mode pick.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="thermal-mode">Calibration mode</Label>
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as ThermalCalibrationMode)}
          >
            <SelectTrigger
              id="thermal-mode"
              data-testid="thermal-mode-trigger"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_ORDER.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {mode === "user_defined" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="thermal-scale">Scale (K / count)</Label>
              <Input
                id="thermal-scale"
                type="number"
                step="any"
                value={scale}
                onChange={(e) => setScale(e.target.value)}
                data-testid="thermal-scale"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="thermal-offset">Offset (K)</Label>
              <Input
                id="thermal-offset"
                type="number"
                step="any"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                data-testid="thermal-offset"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
