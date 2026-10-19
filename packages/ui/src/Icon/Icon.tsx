import type { SVGProps } from 'react';

// The sidebar's icons, drawn on a 16×16 grid with a 1.5 stroke in the text color.
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      {...props}
    />
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m4 6 4 4 4-4" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </Svg>
  );
}

export function NewIssueIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 3H3.5a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1H12a1 1 0 0 0 1-1V8" />
      <path d="M11.5 2.5l2 2L8 10H6V8z" />
    </Svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2.5 7 8 2.5 13.5 7v6.5h-11z" />
      <path d="M6.5 13.5v-4h3v4" />
    </Svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" />
      <path d="M4 3.5h8l1.5 6v3h-11v-3z" />
    </Svg>
  );
}

export function MyQueueIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" {...props}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" />
    </Svg>
  );
}

export function ReviewsIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2.5 4h11M2.5 8h6M2.5 12h4" />
      <path d="m9.5 11.5 1.75 1.75 3.25-3.5" />
    </Svg>
  );
}

export function QueueIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" {...props}>
      <path d="M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.5M2.5 8h.5M2.5 12h.5" />
    </Svg>
  );
}

export function InitiativesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" />
    </Svg>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <Svg strokeLinejoin="round" {...props}>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8z" />
    </Svg>
  );
}

export function RoadmapIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" {...props}>
      <path d="M2.5 4h6M5 8h8.5M3.5 12h5" />
    </Svg>
  );
}

export function CyclesIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 2.5v2.5h-2.5" />
    </Svg>
  );
}

export function ActorsIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6" cy="6" r="2.2" />
      <path d="M2 13c.6-2 2-3 4-3s3.4 1 4 3" />
      <rect x="10.5" y="3.5" width="3.5" height="3.5" rx="1" />
    </Svg>
  );
}

export function MetricsIcon(props: IconProps) {
  return (
    <Svg strokeLinecap="round" {...props}>
      <path d="M3 13V9M8 13V4M13 13V7" />
    </Svg>
  );
}

export function RepositoryIcon(props: IconProps) {
  return (
    <Svg strokeLinejoin="round" {...props}>
      <path d="M4 12.5v-9a1 1 0 0 1 1-1h7.5v9.5H5a1 1 0 0 0-1 1 1 1 0 0 0 1 1h7.5" />
    </Svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg strokeLinejoin="round" {...props}>
      <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function CatalogIcon(props: IconProps) {
  return (
    <Svg strokeLinejoin="round" {...props}>
      <path d="M8 2 13.5 5 8 8 2.5 5z" />
      <path d="M2.5 8 8 11l5.5-3M2.5 11 8 14l5.5-3" />
    </Svg>
  );
}
