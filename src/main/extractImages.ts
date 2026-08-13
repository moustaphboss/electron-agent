/**
 * Pulls photo file paths out of a tool's raw JSON result, deterministically —
 * never relies on the model repeating file paths correctly in prose.
 */
export function extractImagePaths(
  toolName: string,
  jsonText: string,
): string[] {
  try {
    const parsed = JSON.parse(jsonText);
    if (toolName === "search_photos" && Array.isArray(parsed?.photos)) {
      return parsed.photos
        .map((p: unknown) => (p as { file_path?: unknown })?.file_path)
        .filter((p: unknown): p is string => typeof p === "string");
    }
    if (
      toolName === "get_photo_details" &&
      typeof parsed?.file_path === "string"
    ) {
      return [parsed.file_path];
    }
  } catch {
    // Not JSON (e.g. "No photo found with id X.") — nothing to extract.
  }
  return [];
}
