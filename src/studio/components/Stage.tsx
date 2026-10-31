import Image from "next/image";
import type { ReactNode } from "react";
import { LensFilter } from "./LensFilter";

/** The persistent room: plate → UI (children) → light → grain. Never re-mounts. */
export function Stage({ children }: { children: ReactNode }) {
  return (
    <main className="stage">
      <LensFilter />
      <Image
        className="stage__plate"
        src="/studio/media/plate/wall-ledge-marble.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        quality={90}
      />
      {children}
      <div className="light" aria-hidden>
        <span className="light__shaft" />
        <span className="light__shaft" />
        <span className="light__shaft" />
      </div>
      <div className="grain" aria-hidden />
    </main>
  );
}
