import { describe, expect, it } from "vitest"
import {
  guessRole,
  parseTable,
  parseTime,
  tempUnitOf,
  tidy,
  toCelsius,
  windowMean,
} from "./weather"

const TOA5 = `"TOA5","11905","CR1000","11905","CR1000.Std.31.02","CPU:GEMINI_weatherstation2_2023_CC1_EHF.CR1","5963","Table1"
"TIMESTAMP","RECORD","AirTC","RH","PPFD","windSpeed","SoilWaterPotential_B_Avg"
"TS","RN","°C","%","umol/m^2/s","m/s","kPa"
"","","Smp","Smp","Smp","Smp","Avg"
"2026-08-20 12:00:05",1,30,40,1800,1.9,"NAN"
"2026-08-20 12:00:35",2,32,38,1810,2.1,"NAN"
"2026-08-20 12:01:05",3,31,39,1805,2.0,-5
`

describe("weather", () => {
  it("reads a TOA5 file's names and units", () => {
    const t = parseTable(TOA5)
    expect(t.format).toBe("toa5")
    expect(t.names[2]).toBe("AirTC")
    expect(t.units[2]).toBe("°C")
    expect(t.rows).toHaveLength(3)
  })

  it("guesses roles and units", () => {
    expect(guessRole("TIMESTAMP", "TS")).toBe("time")
    expect(guessRole("RECORD", "RN")).toBe("skip")
    expect(guessRole("AirTC", "°C")).toBe("air_temp")
    expect(guessRole("RH", "%")).toBe("rh")
    expect(guessRole("PPFD")).toBe("par")
    expect(guessRole("windSpeed")).toBe("wind_speed")
    expect(guessRole("VWC_5cm")).toBe("soil_moisture")
    expect(guessRole("T_5cm")).toBe("soil_temp")
    expect(tempUnitOf("°C")).toBe("C")
    expect(tempUnitOf("deg F")).toBe("F")
  })

  it("converts temperatures", () => {
    expect(toCelsius(212, "F")).toBeCloseTo(100)
    expect(toCelsius(273.15, "K")).toBeCloseTo(0)
  })

  it("reads logger and spreadsheet times", () => {
    expect(parseTime("2026-08-20 00:00:05")).toBe("2026-08-20 00:00:05")
    expect(parseTime("8/20/2026 1:05 PM")).toBe("2026-08-20 13:05:00")
    expect(parseTime("8/20/26 0:15")).toBe("2026-08-20 00:15:00")
    expect(parseTime("not a time")).toBeNull()
  })

  it("tidies, converts to °C, averages and leaves NAN out", () => {
    const t = parseTable(TOA5)
    const { columns, rows } = tidy(
      [t],
      [
        { name: "TIMESTAMP", role: "time" },
        { name: "AirTC", role: "air_temp", unit: "F" },
        { name: "RH", role: "rh" },
        { name: "SoilWaterPotential_B_Avg", role: "soil_moisture" },
      ],
      1,
    )
    expect(columns).toEqual(["air_temp_c", "rh", "soil_moisture"])
    expect(rows.map((r) => r.time)).toEqual([
      "2026-08-20 12:00:00",
      "2026-08-20 12:01:00",
    ])
    expect(rows[0].values.air_temp_c).toBeCloseTo(toCelsius(31, "F"), 2)
    expect(rows[0].values.soil_moisture).toBeNull()
    expect(rows[1].values.soil_moisture).toBe(-5)
    expect(
      windowMean(rows, "rh", "2026-08-20", "12:00", "12:01").mean,
    ).toBeCloseTo((39 + 39) / 2)
  })
})
