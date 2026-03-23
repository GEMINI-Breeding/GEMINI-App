import { useCallback, useState } from "react";
import { FilesService, OpenAPI } from "@/client";
import { DataStructureForm, DataTypes, UploadList } from "../components";
import { GeoTiffValidationDialog } from "../components/GeoTiffValidationDialog";
import { MsgsSyncedUploadDialog } from "../components/MsgsSyncedUploadDialog";

function apiUrl(path: string): string {
  const base = OpenAPI.BASE.replace(/\/$/, "")
  return base + path
}

export function UploadData() {
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [pendingValidation, setPendingValidation] = useState<string[]>([]);
  const [syncedCsvText, setSyncedCsvText] = useState<string | null>(null);
  const [syncedCsvPath, setSyncedCsvPath] = useState<string | null>(null);

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

  const handleUploadComplete = useCallback(
    async (destPaths: string[]) => {
      if (selectedFileType === "Orthomosaic") {
        const tifs = destPaths.filter((p) => /\.(tif|tiff)$/i.test(p));
        if (tifs.length > 0) setPendingValidation(tifs);
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
      }
    },
    [selectedFileType],
  );

  return (
    <div className="bg-background">
      <div className="pt-6">
        <div className="grid grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            <DataTypes onChange={setSelectedFileType} />
            <DataStructureForm
              fileType={selectedFileType}
              values={formValues}
              onChange={handleFormChange}
            />
          </div>

          <UploadList
            dataType={selectedFileType}
            formValues={formValues}
            onFilesSelected={handleFilesSelected}
            onUploadComplete={handleUploadComplete}
          />
        </div>
      </div>

      {pendingValidation.length > 0 && (
        <GeoTiffValidationDialog
          destPaths={pendingValidation}
          onClose={() => setPendingValidation([])}
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
    </div>
  );
}
