import { useQuery } from "@tanstack/react-query";
import { FolderTree } from "lucide-react";
import { TextField } from "./TextField";
import { dataTypes } from "@/config/dataTypes";
import { FilesService } from "@/client";

interface DataStructureFormProps {
  fileType?: string | null;
  values?: {
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
    <div className="border-border bg-card rounded-lg border p-6">
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
      </div>
    </div>
  );
}
