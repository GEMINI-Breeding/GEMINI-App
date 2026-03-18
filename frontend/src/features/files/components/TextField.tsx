interface TextFieldProps {
  id: string;
  label: string;
  type?: "text" | "date";
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  suggestions?: string[];
}

export function TextField({
  id,
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  disabled,
  suggestions,
}: TextFieldProps) {
  const listId = suggestions?.length ? `${id}-suggestions` : undefined;

  return (
    <div>
      <label htmlFor={id} className="text-foreground mb-1.5 block">
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className={`border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-none ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        disabled={disabled}
        list={listId}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
