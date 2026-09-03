export function getErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  const directMessage = getNestedString(value, ["message"]);

  if (directMessage) {
    return directMessage;
  }

  const errorMessage = getNestedString(value, ["error", "message"]);

  if (errorMessage) {
    return errorMessage;
  }

  return fallback;
}

export function getNestedString(
  value: unknown,
  path: string[],
): string | undefined {
  const nested = getNestedValue(value, path);
  return typeof nested === "string" ? nested : undefined;
}

export function getNestedValue(value: unknown, path: string[]): unknown {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
