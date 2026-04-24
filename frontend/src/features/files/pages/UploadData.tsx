import { useCallback, useState } from "react";
import { FilesService, OpenAPI } from "@/client";
import { DataStructureForm, DataTypes, UploadList } from "../components";
import { GeoTiffValidationCard } from "../components/GeoTiffValidationCard";
import { MsgsSyncedUploadDialog } from "../components/MsgsSyncedUploadDialog";
import { ReferenceDataUploadDialog } from "../components/ReferenceDataUploadDialog";
import { MultispectralUploadDialog } from "../components/MultispectralUploadDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openUrl } from "@/lib/platform";

function apiUrl(path: string): string {
  const base = OpenAPI.BASE.replace(/\/$/, "")
  return base + path
}

export function UploadData() {
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [rgbTifPath, setRgbTifPath] = useState<string | null>(null);
  const [demTifPath, setDemTifPath] = useState<string | null>(null);
  const [syncedCsvText, setSyncedCsvText] = useState<string | null>(null);
  const [syncedCsvPath, setSyncedCsvPath] = useState<string | null>(null);
  const [dockerErrorMsg, setDockerErrorMsg] = useState<string | null>(null);
  const [refDataFile, setRefDataFile] = useState<File | null>(null);
  const [multispectralUploadId, setMultispectralUploadId] = useState<string | null>(null);

  const handleDockerError = useCallback((msg: string) => {
    setDockerErrorMsg(msg);
  }, []);

  const handleFormChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleFilesSelected = useCallback(
    async (paths: string[]) => {
      const firstPath = paths[0];
      if (!firstPath) return;
      try {
        const meta = await FilesService.extractMetadata({
          requestBody: { file_path: firstPath },
        }) as { date?: string; platform?: string; sensor?: string };
        setFormValues((prev) => {
          const next = { ...prev };
          if (meta.date && !next.date) next.date = meta.date;
          if (meta.platform && !next.platform) next.platform = meta.platform;
          if (meta.sensor && !next.sensor) next.sensor = meta.sensor;
          return next;
        });
      } catch {
        // No EXIF available — fine, user fills in manually
      }
    },
    [],
  );

  const handleRgbUploadComplete = useCallback(
    async (destPaths: string[]) => {
      const tif = destPaths.find((p) => /\.(tif|tiff)$/i.test(p));
      if (tif) setRgbTifPath(tif);
    },
    [],
  );

  const handleDemUploadComplete = useCallback(
    async (destPaths: string[]) => {
      const tif = destPaths.find((p) => /\.(tif|tiff)$/i.test(p));
      if (tif) setDemTifPath(tif);
    },
    [],
  );

  const handleUploadComplete = useCallback(
    async (destPaths: string[], uploadId?: string) => {
      if (selectedFileType === "Multispectral Data") {
        if (uploadId) setMultispectralUploadId(uploadId);
        return;
      }
      if (selectedFileType === "Synced Metadata") {
        const csvPath = destPaths.find((p) => /\.csv$/i.test(p));
        if (!csvPath) return;
        try {
          const url = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(csvPath)}`);
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
          });
          if (!res.ok) return;
          const text = await res.text();
          setSyncedCsvText(text);
          setSyncedCsvPath(csvPath);
        } catch {
          // silently ignore — user can upload again
        }
      } else if (selectedFileType === "Reference Data") {
        const filePath = destPaths[0];
        if (!filePath) return;
        const url = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(filePath)}`);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
        });
        if (!res.ok) {
          console.error("Could not read uploaded reference file:", await res.text());
          return;
        }
        const blob = await res.blob();
        const fileName = filePath.split(/[\\/]/).pop() ?? "reference.csv";
        setRefDataFile(new File([blob], fileName));
      }
    },
    [selectedFileType],
  );

  return (
    <div className="bg-background">
      <div className="pt-6">
        <div className="grid grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            <DataTypes onChange={(t) => { setSelectedFileType(t); setRgbTifPath(null); setDemTifPath(null); }} />
            <DataStructureForm
              fileType={selectedFileType}
              values={formValues}
              onChange={handleFormChange}
            />
          </div>

          {selectedFileType === "Orthomosaic" ? (
            <div className="space-y-6">
              <div>
                <UploadList
                  dataType={selectedFileType}
                  formValues={formValues}
                  onFilesSelected={handleFilesSelected}
                  onUploadComplete={handleRgbUploadComplete}
                  label="RGB Orthomosaic (.tif) — required"
                />
                {rgbTifPath && <GeoTiffValidationCard key={rgbTifPath} destPath={rgbTifPath} />}
              </div>
              <div className="border-t pt-6">
                <UploadList
                  dataType="Orthomosaic DEM"
                  formValues={formValues}
                  onUploadComplete={handleDemUploadComplete}
                  label="DEM (.tif) — optional (required for plant height)"
                />
                {demTifPath && <GeoTiffValidationCard key={demTifPath} destPath={demTifPath} />}
              </div>
            </div>
          ) : (
            <UploadList
              dataType={selectedFileType}
              formValues={formValues}
              onFilesSelected={handleFilesSelected}
              onUploadComplete={handleUploadComplete}
              onDockerError={handleDockerError}
            />
          )}

        </div>
      </div>

      {multispectralUploadId && (
        <MultispectralUploadDialog
          open
          uploadId={multispectralUploadId}
          onClose={() => setMultispectralUploadId(null)}
        />
      )}

      {refDataFile && (
        <ReferenceDataUploadDialog
          open
          file={refDataFile}
          formValues={formValues}
          onClose={() => setRefDataFile(null)}
        />
      )}

      {syncedCsvText !== null && (
        <MsgsSyncedUploadDialog
          open
          initialCsvText={syncedCsvText}
          destPath={syncedCsvPath ?? undefined}
          onClose={() => { setSyncedCsvText(null); setSyncedCsvPath(null); }}
          onSaved={(_rowCount) => { setSyncedCsvText(null); setSyncedCsvPath(null); }}
        />
      )}

      <Dialog open={dockerErrorMsg !== null} onOpenChange={(open) => { if (!open) setDockerErrorMsg(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Docker Required</DialogTitle>
            <DialogDescription asChild>
              <div className="text-muted-foreground space-y-3 text-sm">
                <p>
                  Extracting <strong className="text-foreground">.bin files</strong> on Windows and macOS
                  requires Docker Desktop to run the extraction tool inside a Linux container.
                </p>
                {dockerErrorMsg?.toLowerCase().includes("not running") ||
                dockerErrorMsg?.toLowerCase().includes("start docker") ? (
                  <p>
                    Docker Desktop is installed but does not appear to be running. Please start
                    Docker Desktop, wait for it to finish loading, then try uploading again.
                  </p>
                ) : (
                  <p>
                    Docker Desktop was not found on this machine. Install it, then restart GEMI.
                    The extraction tool (~1 GB) will build automatically the first time — no
                    extra setup needed.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setDockerErrorMsg(null)}>
              Close
            </Button>
            <Button onClick={() => openUrl("https://www.docker.com/products/docker-desktop/")}>
              Download Docker Desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
