import {
  Brain,
  ChartSpline,
  Folder,
  Home,
  type LucideIcon,
  Play,
  Settings,
  Tags,
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

export const sidebarItems: NavItem[] = [
  { icon: Home, title: "Home", path: "/" },
  { icon: Folder, title: "Files", path: "/files" },
  {
    icon: Play,
    title: "Process",
    path: "/process",
  },
  {
    icon: Brain,
    title: "Models",
    path: "/models",
    subItems: [
      { title: "Registry", path: "/models" },
      { title: "Run inference", path: "/models/inference" },
      { title: "Train", path: "/models/train" },
    ],
  },
  { icon: Tags, title: "Annotations", path: "/annotations" },
  {
    icon: ChartSpline,
    title: "Analyze",
    path: "/analyze",
  },
  { icon: Settings, title: "Settings", path: "/settings" },
  { icon: Terminal, title: "Console", path: "/console" },
];
