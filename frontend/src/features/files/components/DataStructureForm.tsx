import { FolderTree } from "lucide-react";
import { TextField } from "./TextField";
import { dataTypes } from "@/config/dataTypes";

// Pre-migration, this form queried FilesService.readFieldValues to offer
// autocomplete suggestions (previously-used experiment/location/population
// values). The new backend has no equivalent endpoint — suggestions go
// away; the form still works with plain text entry. Resurrecting them is
// Phase 11 work (Taxonomy admin) once an "experiments/sites/populations"
// CRUD surface exists.

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
  };
  onChange?: (field: string, value: string) => void;
}

export function DataStructureForm({
  fileType,
  values = {},
  onChange,
}: DataStructureFormProps) {
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
              suggestions={undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
