/**
 * Final step of the /import wizard — surface created entities and an
 * "Import more" exit. Ported from
 * `backend/gemini-ui/src/components/import-wizard/step-confirm.tsx`.
 *
 * The "Go to experiment" button in gemini-ui pointed at `/experiments/$id`,
 * which doesn't exist in our app. We map it to the most useful destination
 * for each flow:
 *   - Genomic: `/genotyping/$studyId` if `results.studyId` was set.
 *   - Trait:   stays inside the wizard's "Import more" until Phase 9e
 *              wires a real experiment-detail page.
 */
import { useNavigate } from "@tanstack/react-router"
import { ArrowRight, CheckCircle, RotateCcw, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { UploadResults } from "@/features/import/lib/types"

interface StepConfirmProps {
  results: UploadResults
  onDone: () => void
}

export function StepConfirm({ results, onDone }: StepConfirmProps) {
  const navigate = useNavigate()

  const hasErrors = results.failedFiles > 0
  const allFailed = results.uploadedFiles === 0 && results.failedFiles > 0

  return (
    <div className="space-y-6" data-testid="import-step-confirm">
      <div className="flex flex-col items-center space-y-3 py-8 text-center">
        {allFailed ? (
          <XCircle className="text-destructive h-12 w-12" />
        ) : (
          <CheckCircle className="h-12 w-12 text-green-600" />
        )}
        <h2 className="text-xl font-semibold" data-testid="confirm-heading">
          {allFailed
            ? "Import Failed"
            : hasErrors
              ? "Import Completed with Errors"
              : "Import Complete"}
        </h2>
        <p className="text-muted-foreground">
          {allFailed
            ? "No files were uploaded successfully."
            : `${results.uploadedFiles} file${results.uploadedFiles !== 1 ? "s" : ""} uploaded successfully.`}
          {hasErrors && !allFailed
            ? ` ${results.failedFiles} file${results.failedFiles !== 1 ? "s" : ""} failed.`
            : ""}
        </p>
      </div>

      {results.createdEntities.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Created Entities</h3>
          <div className="space-y-1.5">
            {results.createdEntities.map((entity, i) => (
              <div
                key={`${entity.type}-${entity.id}-${i}`}
                className="flex items-center gap-2 text-sm"
              >
                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600" />
                <span className="text-muted-foreground">{entity.type}:</span>
                <span className="font-medium">{entity.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border p-4">
        <h3 className="mb-2 font-medium">Upload Summary</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Files uploaded</span>
            <p className="text-lg font-semibold">{results.uploadedFiles}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Files failed</span>
            <p className="text-lg font-semibold">{results.failedFiles}</p>
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="outline" onClick={onDone} data-testid="import-more">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Import More
        </Button>
        {results.studyId && (
          <Button
            data-testid="go-to-study"
            onClick={() =>
              navigate({
                to: "/genotyping/$studyId",
                params: { studyId: results.studyId as string },
              })
            }
          >
            Open study
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
