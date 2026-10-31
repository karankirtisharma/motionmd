import type { SVGProps } from "react";

// Lucide-style line icons at a 1.25 stroke (blueprint §8)
function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
);

export const HeartIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M19.5 12.6 12 20l-7.5-7.4A4.6 4.6 0 0 1 12 6.3a4.6 4.6 0 0 1 7.5 6.3Z" />
  </Base>
);

export const ListIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Base>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" />
  </Base>
);

export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M8 5v14M16 5v14" strokeWidth={2.5} />
  </Base>
);

export const ArrowRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);

export const ArrowLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Base>
);

export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Base>
);

export const FrameIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="M7 6v12M17 6v12" />
  </Base>
);

export const CubeIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
    <path d="M4 7.5 12 12l8-4.5M12 12v9" />
  </Base>
);

export const DropIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3.5s6 6.6 6 10.6a6 6 0 0 1-12 0c0-4 6-10.6 6-10.6Z" />
  </Base>
);

export const SoundIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Base>
);

export const MuteIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </Base>
);

export const CaptionsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6" />
  </Base>
);

export const MotionOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M5.5 18.5 18.5 5.5" />
  </Base>
);

export const GlobeIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.5 3.6 5.4 3.6 8.5s-1.1 6-3.6 8.5c-2.5-2.5-3.6-5.4-3.6-8.5S9.5 6 12 3.5Z" />
  </Base>
);

export const StarIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="m12 3.5 2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.8l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7L12 3.5Z" />
  </Base>
);

export const BriefIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h5" />
    <path d="M14 3.5 18.5 8v4.5M14 3.5V8h4.5M9 12h5M9 15.5h3M17.5 15v6M14.5 18h6" />
  </Base>
);

export const MailIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
  </Base>
);

export const LinkIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Base>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);

export const GridIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </Base>
);

export const SlidersIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Base>
);

export const DocIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
    <path d="M14 3.5V8h4.5M9 12.5h6M9 16h6M9 9h2" />
  </Base>
);

export const PenIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4L16.5 4.5Z" />
  </Base>
);

export const LayersIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8 12 3.5Z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
  </Base>
);

export const FilmIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
    <path d="M8 3.5v17M16 3.5v17M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />
  </Base>
);

export const CheckCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.3 2.4 2.4 4.6-4.9" />
  </Base>
);

export const ExpandIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Base>
);

export const CloudUpIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6A3.8 3.8 0 0 1 17.5 18.5" />
    <path d="M12 20.5v-8M8.8 15.5 12 12.3l3.2 3.2" />
  </Base>
);

export const PhoneIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
    <path d="M11 18.5h2" />
  </Base>
);

export const BottleIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M10 2.5h4v3h-4zM11 5.5V8M13 5.5V8" />
    <rect x="6.5" y="8" width="11" height="13.5" rx="3.5" />
  </Base>
);

export const CarIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 15.5v-2.8l2-4.2a2 2 0 0 1 1.8-1.2h8.4a2 2 0 0 1 1.8 1.2l2 4.2v2.8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
    <path d="M4.5 12.5h15M7 16.5v1.8M17 16.5v1.8" />
    <circle cx="7.5" cy="14.3" r=".6" />
    <circle cx="16.5" cy="14.3" r=".6" />
  </Base>
);

export const WineIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M7.5 3h9l-.6 5.5a3.9 3.9 0 0 1-7.8 0L7.5 3ZM8 7h8M12 12.5v8M8.5 20.5h7" />
  </Base>
);
