import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const exifrGps = vi.fn()
const exifrParse = vi.fn()

vi.mock("exifr", () => ({
  default: {
    gps: (...args: unknown[]) => exifrGps(...args),
    parse: (...args: unknown[]) => exifrParse(...args),
  },
}))

import {
  fetchExifHeader,
  fetchObjectAsBlob,
  fetchObjectAsText,
  readImageGps,
} from "./imageGps"

describe("imageGps helpers", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    exifrGps.mockReset()
    exifrParse.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function okBlob(blob: Blob, status = 200) {
    return Promise.resolve({
      ok: true,
      status,
      blob: () => Promise.resolve(blob),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as Response)
  }

  describe("fetchObjectAsBlob", () => {
    it("hits /api/files/download/<bucket>/<obj> with a bearer token from localStorage", async () => {
      localStorage.setItem("gemini.auth.token", "tok-1")
      const blob = new Blob(["x"], { type: "image/jpeg" })
      fetchMock.mockReturnValueOnce(okBlob(blob))

      const out = await fetchObjectAsBlob("dir/img.jpg")
      expect(out).toBe(blob)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe("/api/files/download/gemini/dir/img.jpg")
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer tok-1",
      })
    })

    it("omits the Authorization header when no token is stored", async () => {
      fetchMock.mockReturnValueOnce(okBlob(new Blob()))
      await fetchObjectAsBlob("a.jpg")
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(init.headers).toEqual({})
    })

    it("throws when the response is not ok", async () => {
      fetchMock.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 404,
          blob: () => Promise.resolve(new Blob()),
        } as unknown as Response),
      )
      await expect(fetchObjectAsBlob("missing.jpg")).rejects.toThrow(
        "download missing.jpg: 404",
      )
    })
  })

  describe("fetchObjectAsText", () => {
    it("decodes the blob to text", async () => {
      const blob = {
        text: () => Promise.resolve("hello world"),
      } as unknown as Blob
      fetchMock.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          status: 200,
          blob: () => Promise.resolve(blob),
        } as unknown as Response),
      )
      const out = await fetchObjectAsText("notes.txt")
      expect(out).toBe("hello world")
    })
  })

  describe("fetchExifHeader", () => {
    it("sends a Range header for the first 128 KB and returns the buffer on 200", async () => {
      const buf = new ArrayBuffer(16)
      fetchMock.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(buf),
        } as unknown as Response),
      )
      const out = await fetchExifHeader("img.jpg")
      expect(out).toBe(buf)
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect((init.headers as Record<string, string>).Range).toBe(
        "bytes=0-131071",
      )
    })

    it("accepts a 206 Partial Content response", async () => {
      const buf = new ArrayBuffer(4)
      fetchMock.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 206,
          arrayBuffer: () => Promise.resolve(buf),
        } as unknown as Response),
      )
      const out = await fetchExifHeader("img.jpg")
      expect(out).toBe(buf)
    })

    it("returns null when the server responds with a non-ok / non-206 status", async () => {
      fetchMock.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 416,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        } as unknown as Response),
      )
      expect(await fetchExifHeader("img.jpg")).toBeNull()
    })

    it("returns null when fetch itself throws", async () => {
      fetchMock.mockRejectedValueOnce(new Error("net down"))
      expect(await fetchExifHeader("img.jpg")).toBeNull()
    })
  })

  describe("readImageGps", () => {
    const buf = new ArrayBuffer(8)

    it("returns {lat, lon, alt} when exifr provides all three", async () => {
      exifrGps.mockResolvedValueOnce({ latitude: 12.5, longitude: -45.25 })
      exifrParse.mockResolvedValueOnce({ GPSAltitude: 100, GPSAltitudeRef: 0 })
      expect(await readImageGps(buf)).toEqual({
        lat: 12.5,
        lon: -45.25,
        alt: 100,
      })
    })

    it("negates altitude when GPSAltitudeRef === 1 (below sea level)", async () => {
      exifrGps.mockResolvedValueOnce({ latitude: 0, longitude: 0 })
      exifrParse.mockResolvedValueOnce({ GPSAltitude: 50, GPSAltitudeRef: 1 })
      expect((await readImageGps(buf))?.alt).toBe(-50)
    })

    it("negates altitude when GPSAltitudeRef === '1' (string form)", async () => {
      exifrGps.mockResolvedValueOnce({ latitude: 0, longitude: 0 })
      exifrParse.mockResolvedValueOnce({ GPSAltitude: 50, GPSAltitudeRef: "1" })
      expect((await readImageGps(buf))?.alt).toBe(-50)
    })

    it("defaults altitude to 0 when GPSAltitude is missing", async () => {
      exifrGps.mockResolvedValueOnce({ latitude: 1, longitude: 2 })
      exifrParse.mockResolvedValueOnce({})
      expect((await readImageGps(buf))?.alt).toBe(0)
    })

    it("returns null when exifr.gps yields no usable coords", async () => {
      exifrGps.mockResolvedValueOnce(null)
      exifrParse.mockResolvedValueOnce(null)
      expect(await readImageGps(buf)).toBeNull()
    })

    it("returns null when latitude is not a number", async () => {
      exifrGps.mockResolvedValueOnce({ latitude: "x", longitude: 1 })
      exifrParse.mockResolvedValueOnce(null)
      expect(await readImageGps(buf)).toBeNull()
    })

    it("swallows exifr.gps rejections and returns null", async () => {
      exifrGps.mockRejectedValueOnce(new Error("bad jpeg"))
      exifrParse.mockResolvedValueOnce(null)
      expect(await readImageGps(buf)).toBeNull()
    })
  })
})
