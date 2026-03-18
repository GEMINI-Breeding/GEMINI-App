import {
  ChartSpline,
  Folder,
  Home,
  type LucideIcon,
  Play,
  Settings,
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
  {
    icon: Folder,
    title: "Files",
    path: "/files",
    subItems: [
      { title: "Upload Data", path: "/files/upload_data" },
      { title: "Manage Data", path: "/files/manage_data" },
    ],
  },
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
];
