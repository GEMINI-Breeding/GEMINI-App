/**
 * StepNavigator — a run's steps one card at a time: a picker at the top to go
 * to any step (each with its status), and arrows beside the card for the step
 * before and after. The next step stays locked until what it needs is done
 * (by default this step); hovering the locked arrow says what is left to do.
 */
import {
  AlertCircle,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Lock,
  Minus,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  type NavStatus,
  type NavStep,
  nextLockReason,
  STATUS_LABEL,
  waitingOn,
} from "@/features/process/lib/stepNav"

export function StatusIcon({
  status,
  className = "size-4",
}: {
  status: NavStatus
  className?: string
}) {
  switch (status) {
    case "completed":
      return <Check className={`${className} text-green-600`} />
    case "running":
      return <Loader2 className={`${className} animate-spin text-blue-600`} />
    case "failed":
      return <AlertCircle className={`${className} text-red-600`} />
    case "ready":
      return <Circle className={`${className} text-primary`} />
    case "skipped":
      return <Minus className={`${className} text-muted-foreground`} />
    case "unavailable":
      return <Ban className={`${className} text-amber-600`} />
    default:
      return <Lock className={`${className} text-muted-foreground`} />
  }
}

const BAR: Record<NavStatus, string> = {
  completed: "bg-green-500",
  running: "bg-blue-500 animate-pulse",
  failed: "bg-red-500",
  ready: "bg-primary/40",
  locked: "bg-muted",
  skipped: "bg-muted-foreground/30",
  unavailable: "bg-amber-500/60",
}

function Arrow({
  side,
  target,
  lock,
  onGo,
}: {
  side: "prev" | "next"
  target: NavStep | undefined
  lock: string | null
  onGo: () => void
}) {
  const Icon = side === "prev" ? ChevronLeft : ChevronRight
  const label = target
    ? `${side === "prev" ? "Previous" : "Next"}: ${target.label}`
    : side === "prev"
      ? "This is the first step"
      : "This is the last step"
  const button = (
    <Button
      variant="outline"
      className="h-auto min-h-24 w-10 shrink-0 self-stretch rounded-lg p-0"
      disabled={!target || Boolean(lock)}
      aria-label={lock ? `${label} (locked)` : label}
      data-testid={`step-${side}`}
      onClick={onGo}
    >
      {lock ? (
        <span className="flex flex-col items-center gap-1">
          <Icon className="size-5 opacity-50" />
          <Lock className="size-3.5" />
        </span>
      ) : (
        <Icon className="size-5" />
      )}
    </Button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button gets no hover, so the wrapper takes it. */}
        <span
          className="flex shrink-0 self-stretch"
          tabIndex={lock ? 0 : -1}
          data-testid={`step-${side}-wrap`}
        >
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side={side === "prev" ? "right" : "left"}
        className="max-w-64"
      >
        {lock ? (
          <span data-testid="step-next-lock">
            <strong>{target?.label} is locked.</strong> {lock}
          </span>
        ) : (
          label
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export function StepNavigator({
  steps,
  statusOf,
  shownKey,
  nextKey,
  onShow,
  children,
}: {
  steps: NavStep[]
  statusOf: (key: string) => NavStatus
  shownKey: string
  /** The step to do next (shown by default). */
  nextKey: string | null
  onShow: (key: string) => void
  /** The cards of every step; the navigator shows the one of `shownKey`. */
  children: React.ReactNode
}) {
  const idx = Math.max(
    0,
    steps.findIndex((s) => s.key === shownKey),
  )
  const cur = steps[idx]
  const prev = steps[idx - 1]
  const next = steps[idx + 1]
  const nextStatus = next ? statusOf(next.key) : null
  // The next step opens as soon as what it needs is done: by default every
  // earlier required step, but a step can need less (trait extraction does
  // not need the plot images, so it can be reached before making them).
  const lock =
    !next || nextStatus !== "locked"
      ? null
      : (nextLockReason(cur, statusOf(cur.key)) ??
        `It needs ${waitingOn(steps, next.key, statusOf).join(", ")} first.`)
  const nextStep = steps.find((s) => s.key === nextKey)

  return (
    <div className="space-y-3" data-testid="step-navigator">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select value={cur.key} onValueChange={onShow}>
          <SelectTrigger
            className="h-9 w-full sm:w-96"
            data-testid="step-picker"
            aria-label="Go to step"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {steps.map((s, i) => {
              const st = statusOf(s.key)
              const waits =
                st === "locked" ? waitingOn(steps, s.key, statusOf) : []
              return (
                <SelectItem
                  key={s.key}
                  value={s.key}
                  disabled={st === "locked"}
                  data-testid={`step-pick-${s.key}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusIcon status={st} className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {i + 1}. {s.label}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {STATUS_LABEL[st]}
                      {s.key === nextKey && st !== "running" ? " · next" : ""}
                      {waits.length ? ` · needs ${waits.join(", ")}` : ""}
                    </span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">
          Step {idx + 1} of {steps.length}
        </span>
        {nextStep && nextStep.key !== cur.key && (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            data-testid="step-go-next"
            onClick={() => onShow(nextStep.key)}
          >
            Go to the step to do next: {nextStep.label}
          </Button>
        )}
      </div>
      {/* Where each step stands, at a glance; click a segment to go to that
          step (a locked one says what it waits for). */}
      <div className="flex gap-1" data-testid="step-bar">
        {steps.map((s) => {
          const st = statusOf(s.key)
          const locked = st === "locked"
          const waits = locked ? waitingOn(steps, s.key, statusOf) : []
          const here = s.key === cur.key
          return (
            <button
              key={s.key}
              type="button"
              disabled={locked}
              aria-current={here ? "step" : undefined}
              aria-label={`${s.label}: ${STATUS_LABEL[st]}${locked ? " (locked)" : ""}`}
              title={
                locked
                  ? `${s.label} is locked${waits.length ? `: it needs ${waits.join(", ")} first` : ""}`
                  : `${s.label}: ${STATUS_LABEL[st]}${here ? " (shown)" : " · click to open"}`
              }
              data-testid={`step-bar-${s.key}`}
              onClick={() => onShow(s.key)}
              // A taller hit area than the thin bar it draws.
              className="group flex-1 py-1.5 disabled:cursor-not-allowed enabled:cursor-pointer"
            >
              <span
                className={`block h-1.5 rounded-full transition-[height] ${BAR[st]} ${
                  here
                    ? "ring-foreground/60 ring-2 ring-offset-1"
                    : locked
                      ? ""
                      : "group-hover:h-2.5"
                }`}
              />
            </button>
          )
        })}
      </div>
      <div className="flex items-stretch gap-3">
        <Arrow
          side="prev"
          target={prev}
          lock={null}
          onGo={() => prev && onShow(prev.key)}
        />
        <div
          className="min-w-0 flex-1 rounded-lg border p-4"
          data-testid="step-card"
        >
          {children}
        </div>
        <Arrow
          side="next"
          target={next}
          lock={lock}
          onGo={() => next && onShow(next.key)}
        />
      </div>
    </div>
  )
}
