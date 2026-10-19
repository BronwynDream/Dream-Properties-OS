import type { MetadataRoute } from "next";

// Dream OS on a phone's home screen (2026-10-19, Arc E1). Simon: agents use
// it "whilst out in the field". Installing gives a home-screen icon (Dream's
// crescent) and a full-screen app without the browser bars. Opens on the
// map, the screen agents reach for most in the field.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dream OS",
    short_name: "Dream OS",
    description: "Dream Knysna's operating system: listings, sellers, documents and the Knysna map.",
    start_url: "/map",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#302A4C",
    theme_color: "#122E87",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
