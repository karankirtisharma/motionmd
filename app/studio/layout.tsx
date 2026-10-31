import type { ReactNode } from "react";
import "@/studio/styles/globals.css";

/** Screen1 styles and fonts only load on the studio route. */
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div id="md-studio-root">
      <link rel="preload" href="/studio/media/fonts/e6099e249fd938cc-s.p.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/studio/media/fonts/4c9affa5bc8f420e-s.p.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      {children}
    </div>
  );
}
