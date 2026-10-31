import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Experience } from "@/studio/components/Experience";
import { SPLASH_COOKIE } from "@/studio/components/splash-cookie";
import { RefOverlay } from "@/studio/components/RefOverlay";
import { Stage } from "@/studio/components/Stage";
import { cursorFromParams } from "@/studio/store/cursor";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const embedded = first(params.embed) === "lounge";
  return {
    title: "Motion Design — Studio",
    description: "Explore Motion Design's films, formats, industries and creative studio.",
    robots: { index: !embedded, follow: !embedded },
  };
}

export default async function StudioPage({ searchParams }: Props) {
  const params = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, first(value)]));
  const embedded = params.embed === "lounge";
  const deepLink = Object.keys(params).some((key) => key !== "ref" && key !== "splash");
  const entered = (await cookies()).has(SPLASH_COOKIE);
  const showSplash = !embedded && (params.splash === "1" || (!entered && !deepLink));
  return (
    <Stage>
      <Experience initial={cursorFromParams(params)} showSplash={showSplash} railOpen={params.rail === "open"} embedded={embedded} />
      <RefOverlay mode={params.ref} />
    </Stage>
  );
}
