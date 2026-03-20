import { FaGithub } from "react-icons/fa"
import { openUrl } from "@/lib/platform"

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t py-4 px-6">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-muted-foreground text-sm">GEMI - {currentYear}</p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => openUrl("https://github.com/GEMINI-Breeding/GEMINI-App")}
            aria-label="GitHub"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <FaGithub className="h-5 w-5" />
          </button>
        </div>
      </div>
    </footer>
  )
}
