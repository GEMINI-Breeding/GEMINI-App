import { createFileRoute } from "@tanstack/react-router"

import { WizardShell } from "@/features/import/components/WizardShell"

function ImportPage() {
  return (
    <div className="container max-w-5xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Import data</h1>
        <p className="text-muted-foreground text-sm">
          Drop CSV / TSV / XLSX / HapMap / VCF files. The wizard auto-detects
          the data shape and routes you through metadata, optional column
          mapping, and bulk ingest.
        </p>
      </header>
      <WizardShell />
    </div>
  )
}

export const Route = createFileRoute("/_layout/import")({
  component: ImportPage,
  head: () => ({ meta: [{ title: "Import — GEMINI" }] }),
})
