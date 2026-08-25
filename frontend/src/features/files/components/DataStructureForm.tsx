import { useQuery } from "@tanstack/react-query";
import { FolderTree } from "lucide-react";
import { TextField } from "./TextField";
import { dataTypes } from "@/config/dataTypes";
import { FilesService } from "@/client";

interface DataStructureFormProps {
  fileType?: string | null;
  values?: {
    name?: string;
    experiment?: string;
    location?: string;
    population?: string;
    date?: string;
    platform?: string;
    sensor?: string;
    image_type?: string;
  };
  onChange?: (field: string, value: string) => void;
  /** Suppress the Image Type picker — used where the tag is already
   * determined automatically (e.g. the DJI thermal directory flow, which
   * uploads thermal/RGB files as separately-tagged batches itself). */
  hideImageType?: boolean;
}

// Placeholder tag on image uploads — not consumed by any pipeline logic yet
// (see backend FileUpload.image_type), stored for future use e.g. auto-
// suggesting relevant processing steps based on what kind of imagery this is.
const IMAGE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "rgb", label: "RGB" },
  { value: "thermal", label: "Thermal" },
  { value: "multispectral", label: "Multispectral" },
];

export function DataStructureForm({
  fileType,
  values = {},
  onChange,
  hideImageType = false,
}: DataStructureFormProps) {
  const { data: fieldValues } = useQuery({
    queryKey: [
      "field-values",
      fileType,
      values.experiment,
      values.location,
      values.population,
      values.platform,
      values.sensor,
    ],
    queryFn: () =>
      FilesService.readFieldValues({
        dataType: fileType ?? undefined,
        experiment: values.experiment || undefined,
        location: values.location || undefined,
        population: values.population || undefined,
        platform: values.platform || undefined,
        sensor: values.sensor || undefined,
      }),
    enabled: !!fileType,
  });

  // if no file type is selected show this message
  if (!fileType) {
    return (
      <div className="border-border bg-card rounded-lg border p-6">
        <p className="text-muted-foreground">Please select a file type.</p>
      </div>
    );
  }

  // fields for file type
  const config = dataTypes[fileType as keyof typeof dataTypes];
  const fields = config?.fields || [];

  const handleChange = (field: string) => (value: string) => {
    onChange?.(field, value);
  };

  return (
    <div data-onboarding="files-data-structure-form" className="border-border bg-card rounded-lg border p-6">
      <div className="mb-4 flex items-center gap-2">
        <FolderTree className="text-card-foreground h-5 w-5" />
        <h2 className="text-foreground">Data Structure</h2>
      </div>

      <div className="space-y-4">
        {fields.map((field, index) => {
          const previousField = fields[index - 1];
          const isDisabled = previousField
            ? !values[previousField as keyof typeof values]
            : false;

          return (
            <TextField
              key={field}
              id={field}
              label={field.charAt(0).toUpperCase() + field.slice(1)}
              type={field === "date" ? "date" : "text"}
              placeholder={`${field}`}
              value={values[field as keyof typeof values]}
              onChange={handleChange(field)}
              disabled={isDisabled}
              suggestions={fieldValues?.[field]}
            />
          );
        })}

        {fileType === "Image Data" && !hideImageType && (
          <div>
            <label className="text-foreground mb-1.5 block text-sm">
              Image Type <span className="text-muted-foreground">(optional)</span>
            </label>
            <div className="flex gap-2">
              {IMAGE_TYPE_OPTIONS.map((opt) => {
                const selected = values.image_type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      handleChange("image_type")(selected ? "" : opt.value)
                    }
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:border-primary/50 text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
