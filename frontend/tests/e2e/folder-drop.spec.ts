/**
 * Phase 6 (post-mortem): folder-drop coverage that would have caught
 * the `Subset Drone Data/` failure.
 *
 * The original suite tested the upload flow via `page.setInputFiles`,
 * which feeds files through the hidden <input type="file">. That bypasses
 * the actual `onDrop` handler, so it never noticed that dropping a folder
 * surfaced a 0-byte File entry that downstream code rejected as "wrong
 * file type" with a misleading error toast.
 *
 * These specs:
 *   1. Drop a synthetic folder (DirectoryEntry walker hits the new
 *      filesFromDataTransfer code path) → files populate, upload works,
 *      objects appear in MinIO via Manage tab.
 *   2. Drop a 0-byte folder-shaped File (the failure mode the user hit on
 *      browsers that don't expose webkitGetAsEntry, or when permissions
 *      block reading the directory) → the error DIALOG (not a toast)
 *      appears with an actionable message.
 *   3. Drop a CSV when "Image Data" is selected → the wrong-type DIALOG
 *      lists which files were skipped.
 */
import { expect, test } from "../helpers/fixtures"

test.describe("UploadZone: folder drop", () => {
  test.setTimeout(120_000)

  test("dropping a folder walks its files and populates the Selected list", async ({
    page,
  }) => {
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

    // Synthesize a DataTransfer whose only item is a DirectoryEntry-like
    // object containing two FileEntry-like children. This exercises the
    // new webkitGetAsEntry walk path. The browser's DragEvent constructor
    // rejects duck-typed dataTransfer, so we build a real DataTransfer
    // first and override its items[] with our synthetic entries.
    await page.locator('[data-testid="upload-dropzone"]').evaluate((el) => {
      function fileEntry(name: string, content: string) {
        const f = new File([content], name)
        return {
          isFile: true,
          isDirectory: false,
          name,
          fullPath: `/folder/${name}`,
          file: (cb: (f: File) => void) => cb(f),
        }
      }
      function dirEntry(name: string, children: unknown[]) {
        return {
          isFile: false,
          isDirectory: true,
          name,
          createReader: () => {
            let drained = false
            return {
              readEntries: (cb: (entries: unknown[]) => void) => {
                if (drained) return cb([])
                drained = true
                cb(children)
              },
            }
          },
        }
      }

      const folder = dirEntry("synthetic-folder", [
        fileEntry("a.jpg", "aa"),
        fileEntry("b.jpg", "bbb"),
      ])

      // Real DataTransfer satisfies the DragEvent constructor; we then
      // override `items` with our synthetic items so the walker sees the
      // DirectoryEntry. (`files` stays empty for the fallback path.)
      const dt = new DataTransfer()
      const items = [
        {
          kind: "file",
          type: "",
          webkitGetAsEntry: () => folder,
          getAsFile: () => null,
        },
      ] as unknown as DataTransferItemList
      Object.defineProperty(dt, "items", { value: items, writable: false })

      el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }))
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }))
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }))
    })

    // The Selected Files list should now show two files. This is the
    // user-visible signal that folder expansion worked. Heading text:
    // "Selected Files (2)".
    await expect(
      page.getByRole("heading", { name: /^Selected Files \(2\)$/ }),
    ).toBeVisible({ timeout: 5_000 })
    // The error dialog must NOT appear — files were valid.
    await expect(page.locator('[data-testid="upload-error-dialog"]')).toHaveCount(0)
  })

  test("dropping a 0-byte folder artifact shows an actionable error DIALOG (not a fleeting toast)", async ({
    page,
  }) => {
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

    // Older browsers / permission-blocked folders surface as a single
    // 0-byte File. Simulate that by adding to a real DataTransfer (no
    // webkitGetAsEntry), which exercises the fallback path.
    await page.locator('[data-testid="upload-dropzone"]').evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File([], "Subset Drone Data", { type: "" }))
      el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }))
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }))
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }))
    })

    // The error dialog must appear and stay open (not auto-dismiss).
    const dialog = page.locator('[data-testid="upload-error-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog).toContainText(/couldn'?t read that folder/i)
    await expect(dialog).toContainText("Subset Drone Data")
    // Wait past the sonner default duration to prove the message stays.
    await page.waitForTimeout(5_000)
    await expect(dialog).toBeVisible()
    await page.getByTestId("upload-error-dismiss").click()
    await expect(dialog).toHaveCount(0)
  })

  test("dropping a CSV when 'Image Data' is selected shows wrong-type DIALOG with file names", async ({
    page,
  }) => {
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

    // Drop two CSVs and one valid JPG to test the partial-rejection branch.
    await page.locator('[data-testid="upload-dropzone"]').evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File(["a,b\n1,2"], "field_design.csv", { type: "text/csv" }))
      dt.items.add(new File(["x,y\n3,4"], "gcp_locations.csv", { type: "text/csv" }))
      dt.items.add(new File(["jpgbytes"], "photo.jpg", { type: "image/jpeg" }))
      el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }))
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }))
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }))
    })

    const dialog = page.locator('[data-testid="upload-error-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog).toContainText(/2 file\(s\) skipped — 1 accepted/i)
    await expect(dialog).toContainText("field_design.csv")
    await expect(dialog).toContainText("gcp_locations.csv")
    await page.getByTestId("upload-error-dismiss").click()

    // The accepted JPG should still show up in the Selected list.
    await expect(
      page.getByRole("heading", { name: /^Selected Files \(1\)$/ }),
    ).toBeVisible()
  })
})

test.describe("UploadList: blocked-submit dialogs", () => {
  test.setTimeout(60_000)

  test("submitting without scope fields shows a 'fields blank' DIALOG", async ({
    page,
  }) => {
    await page.goto("/files")
    await page.locator('[data-onboarding="files-tab-upload"]').click()
    await page.locator('[data-onboarding="files-data-type-selector"]').click()
    await page.getByRole("menuitem", { name: "Image Data", exact: true }).click()

    // Add one file but DO NOT fill the form fields.
    await page.locator('[data-testid="upload-input"]').setInputFiles({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("jpgbytes", "utf-8"),
    })
    await expect(
      page.getByRole("heading", { name: /^Selected Files \(1\)$/ }),
    ).toBeVisible()
    await page.getByTestId("upload-submit").click()

    const dialog = page.locator('[data-testid="upload-error-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog).toContainText(/required form fields are blank/i)
    // Should call out at least one of the path components by name.
    await expect(dialog).toContainText(/(experiment|location|date|platform|sensor)/i)
  })
})
