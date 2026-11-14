// Stroke icons on a 24 px grid.
const ICONS = {
  type: "m8 3 4 8 5-5 5 15H2L8 3z",
  difficulty: "m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0",
  distance: "M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4",
  time: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  ascent: "m22 7-8.5 8.5-5-5L2 17M16 7h6v6",
  descent: "m22 17-8.5-8.5-5 5L2 7M16 17h6v-6",
  pace: "M22 12h-4l-3 9L9 3l-3 9H2",
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  plus: "M5 12h14M12 5v14",
  map: "m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3zM9 3v15M15 6v15",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  pin: "M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};
export type IconName = keyof typeof ICONS;

export default function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]`}>
      <path d={ICONS[name]} />
    </svg>
  );
}
