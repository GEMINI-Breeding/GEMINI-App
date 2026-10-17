import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * The old first-run address. Set-up now happens on the home page itself,
 * which opens (inside the normal layout) whether or not a processing stack
 * is connected; this only keeps old links and bookmarks working.
 */
export const Route = createFileRoute("/setup")({
  beforeLoad: () => {
    throw redirect({ to: "/" })
  },
})
