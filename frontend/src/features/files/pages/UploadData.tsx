import { useCallback, useState } from "react";
import { FilesService } from "@/client";
import { DataStructureForm, DataTypes, UploadList } from "../components";
import { GeoTiffValidationDialog } from "../components/GeoTiffValidationDialog";
import { MsgsSyncedUploadDialog } from "../components/MsgsSyncedUploadDialog";
import { Button } from "@/components/ui/button";
import useCustomToast from "@/hooks/useCustomToast";

export function UploadData() {
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [pendingValidation, setPendingValidation] = useState<string[]>([]);
  const [msgsSyncedDialogOpen, setMsgsSyncedDialogOpen] = useState(false);
  const [msgsSyncedSaved, setMsgsSyncedSaved] = useState<number | null>(null);
  const { showSuccessToast } = useCustomToast();

  const handleFormChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
    // Reset msgs_synced saved state when the path changes
    setMsgsSyncedSaved(null);
  };

  const handleFilesSelected = useCallback(
    async (paths: string[]) => {
      // Only try the first file, and only fill in empty fields
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
        // No EXIF available — that's fine, user fills in manually
      }
    },
    [],
  );

  const handleUploadComplete = useCallback(
    (destPaths: string[]) => {
      if (selectedFileType !== "Orthomosaic") return;
      const tifs = destPaths.filter((p) => /\.(tif|tiff)$/i.test(p));
      if (tifs.length > 0) setPendingValidation(tifs);
    },
    [selectedFileType],
  );

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="space-y-6">
          <DataTypes onChange={setSelectedFileType} />
          <DataStructureForm
            fileType={selectedFileType}
            values={formValues}
            onChange={handleFormChange}
          />
          <UploadList
            dataType={selectedFileType}
            formValues={formValues}
            onFilesSelected={handleFilesSelected}
            onUploadComplete={handleUploadComplete}
          />

          {selectedFileType === "Platform Logs" && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">msgs_synced.csv (optional)</p>
                  <p className="text-xs text-muted-foreground">
                    Upload a pre-synced image GPS manifest to skip EXIF extraction during Data Sync.
                    Platform logs will still be merged on top if present.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMsgsSyncedDialogOpen(true)}
                >
                  {msgsSyncedSaved !== null ? `Saved (${msgsSyncedSaved} rows)` : "Upload CSV"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingValidation.length > 0 && (
        <GeoTiffValidationDialog
          destPaths={pendingValidation}
          onClose={() => setPendingValidation([])}
        />
      )}

      <MsgsSyncedUploadDialog
        open={msgsSyncedDialogOpen}
        onClose={() => setMsgsSyncedDialogOpen(false)}
        onSaved={(rowCount) => {
          setMsgsSyncedSaved(rowCount);
          showSuccessToast(`msgs_synced.csv saved (${rowCount} rows)`);
        }}
        formValues={formValues}
      />
    </div>
  );
}
