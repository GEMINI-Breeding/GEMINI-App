import {
  ChartSpline,
  Dna,
  Folder,
  Home,
  type LucideIcon,
  Play,
  Settings,
  Terminal,
} from "lucide-react"

export type SubItem = {
  title: string
  path: string
}

export type NavItem = {
  icon: LucideIcon
  title: string
  path: string
  subItems?: SubItem[]
}

// Mirrors `main`'s sidebar for the imagery + analyze surfaces. ML /
// inference / annotation features are routed through the Process pipeline
// wizard (Roboflow model config in pipeline-wizard Step 3; inference as
// the wizard's `inference` step opened via RunTool). The standalone
// /models and /annotations surfaces from Phase 8 were removed because
// they didn't exist on main.
//
// Genotyping is a new top-level surface added in Phase 9 — no analog on
// main, but the GEMINIbase backend ships GenotypingStudies / Variants /
// GWAS controllers, and the data flow has zero orthomosaic / pipeline
// coupling, so it lives outside the Process wizard.
export const sidebarItems: NavItem[] = [
  { icon: Home, title: "Home", path: "/" },
  { icon: Folder, title: "Files", path: "/files" },
  {
    icon: Play,
    title: "Process",
    path: "/process",
  },
  {
    icon: ChartSpline,
    title: "Analyze",
    path: "/analyze",
  },
  { icon: Dna, title: "Genotyping", path: "/genotyping" },
  { icon: Settings, title: "Settings", path: "/settings" },
  { icon: Terminal, title: "Console", path: "/console" },
]
