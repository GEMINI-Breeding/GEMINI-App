import { Link } from "@tanstack/react-router"
import type * as React from "react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: string | number
  icon: React.FC<{ className?: string }>
  loading?: boolean
  href?: string
}

export function StatCard({
  title,
  value,
  icon: Icon,
  loading,
  href,
}: StatCardProps) {
  const testId = `stat-card-${title.toLowerCase().replace(/ /g, "-")}`
  const valueId = `stat-value-${title.toLowerCase().replace(/ /g, "-")}`

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="mt-3">
        {loading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <p
            className="text-3xl font-bold tracking-tight"
            data-testid={valueId}
          >
            {value}
          </p>
        )}
      </div>
    </>
  )

  const className = cn(
    "rounded-lg border bg-card p-6 shadow-sm block",
    href &&
      "cursor-pointer hover:border-primary/50 hover:shadow-md transition-all",
  )

  if (href) {
    return (
      <Link to={href} className={className} data-testid={testId}>
        {inner}
      </Link>
    )
  }
  return (
    <div className={className} data-testid={testId}>
      {inner}
    </div>
  )
}
