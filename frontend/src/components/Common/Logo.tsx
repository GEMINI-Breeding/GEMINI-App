import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"
import icon from "/assets/images/gemi-icon.png"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const content =
    variant === "responsive" ? (
      <div className="flex items-center gap-2">
        <img src={icon} alt="GEMI" className={cn("size-10", className)} />
        <span className="font-semibold text-xl group-data-[collapsible=icon]:hidden">
          GEMI
        </span>
      </div>
    ) : variant === "full" ? (
      <div className="flex items-center gap-2">
        <img src={icon} alt="GEMI" className={cn("size-10", className)} />
        <span className="font-semibold text-xl">GEMI</span>
      </div>
    ) : (
      <img src={icon} alt="GEMI" className={cn("size-10", className)} />
    )

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
