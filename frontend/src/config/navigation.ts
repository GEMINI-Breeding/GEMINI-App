import {
  ChartSpline,
  Folder,
  Home,
  type LucideIcon,
  Play,
  Settings,
  Terminal,
} from "lucide-react";

export type SubItem = {
  title: string;
  path: string;
};

export type NavItem = {
  icon: LucideIcon;
  title: string;
  path: string;
  subItems?: SubItem[];
};

// Mirrors `main`'s sidebar exactly. ML / inference / annotation features
// are routed through the Process pipeline wizard (Roboflow model config
// in the pipeline-wizard Step 3; inference as the wizard's `inference`
// step opened via RunTool). The standalone /models and /annotations
// surfaces from Phase 8 were removed because they didn't exist on main.
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
  { icon: Settings, title: "Settings", path: "/settings" },
  { icon: Terminal, title: "Console", path: "/console" },
];
