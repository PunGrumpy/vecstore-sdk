import type { Path } from "opentype.js";

const TWO_THIRDS = 2 / 3;

export const cubicPathData = (glyphs: Path, precision: number): string => {
  const format = (value: number): string => value.toFixed(precision);
  let previousX = 0;
  let previousY = 0;
  const segments: string[] = [];
  for (const command of glyphs.commands) {
    if (command.type === "Z") {
      segments.push("Z");
      continue;
    }
    if (command.type === "Q") {
      const control1X = previousX + TWO_THIRDS * (command.x1 - previousX);
      const control1Y = previousY + TWO_THIRDS * (command.y1 - previousY);
      const control2X = command.x + TWO_THIRDS * (command.x1 - command.x);
      const control2Y = command.y + TWO_THIRDS * (command.y1 - command.y);
      segments.push(
        `C${format(control1X)} ${format(control1Y)} ${format(control2X)} ${format(control2Y)} ${format(command.x)} ${format(command.y)}`
      );
    } else if (command.type === "C") {
      segments.push(
        `C${format(command.x1)} ${format(command.y1)} ${format(command.x2)} ${format(command.y2)} ${format(command.x)} ${format(command.y)}`
      );
    } else {
      segments.push(`${command.type}${format(command.x)} ${format(command.y)}`);
    }
    previousX = command.x;
    previousY = command.y;
  }
  return segments.join("");
};
