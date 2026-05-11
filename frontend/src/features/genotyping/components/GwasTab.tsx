/**
 * GWAS tab on the StudyDetail page. Composes the submit form + recent
 * runs panel, both scoped to the current study.
 */
import { GwasRecentRuns } from "@/features/genotyping/components/GwasRecentRuns"
import { GwasSubmitForm } from "@/features/genotyping/components/GwasSubmitForm"

export interface GwasTabProps {
  studyId: string
}

export function GwasTab({ studyId }: GwasTabProps) {
  return (
    <div className="space-y-8" data-testid="genotyping-study-gwas-tab">
      <GwasSubmitForm studyId={studyId} />
      <GwasRecentRuns studyId={studyId} />
    </div>
  )
}
