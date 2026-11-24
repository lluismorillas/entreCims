/** What each axis measures: x under the tick labels, y rotated along the left edge. */
export default function AxisTitles({
  x,
  y,
  width,
  height,
  pad,
}: {
  x: string;
  y: string;
  width: number;
  height: number;
  pad: { left: number; right: number; top: number; bottom: number };
}) {
  return (
    <g className="fill-slate-300 font-medium">
      <text x={pad.left + (width - pad.left - pad.right) / 2} y={height - 4} textAnchor="middle">
        {x}
      </text>
      <text transform={`translate(12 ${pad.top + (height - pad.top - pad.bottom) / 2}) rotate(-90)`} textAnchor="middle">
        {y}
      </text>
    </g>
  );
}
