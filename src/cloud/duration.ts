const maxMinutes = 1440;

/**
 * Parses a lifetime into whole minutes: a number of seconds, or a string with a unit
 * (s, m, h, d). Rounds up, at least 1 minute.
 */
export function durationToMinutes(
  value: number | string | undefined,
  fallbackSeconds: number,
): number {
  let seconds: number;
  if (value === undefined) {
    seconds = fallbackSeconds;
  } else if (typeof value === 'number') {
    seconds = value;
  } else {
    const match =
      /^\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(
        value,
      );
    if (!match) {
      throw new Error(`invalid duration: ${JSON.stringify(value)}`);
    }
    const amount = Number(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    if (unit.startsWith('d')) {
      seconds = amount * 86400;
    } else if (unit.startsWith('h')) {
      seconds = amount * 3600;
    } else if (unit.startsWith('m')) {
      seconds = amount * 60;
    } else {
      seconds = amount;
    }
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`invalid duration: ${JSON.stringify(value)}`);
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes > maxMinutes) {
    throw new Error(`duration above the 24 hour maximum: ${JSON.stringify(value)}`);
  }
  return minutes;
}
