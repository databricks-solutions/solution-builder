import { createFileRoute, redirect } from "@tanstack/react-router";

// The project list lives on the home page ("Your work": search, pages, share, delete).
// Kept as a redirect so old links and bookmarks to /projects still land somewhere.
export const Route = createFileRoute("/projects")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
