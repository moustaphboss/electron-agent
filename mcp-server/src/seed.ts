import { readdir } from "node:fs/promises";
import path from "node:path";
import { db } from "./db.js";
import { extractExif } from "./exif.js";

const PHOTOS_ROOT = "/Users/moustaphakebe/Pictures/1 Photography";
const EXCLUDED_DIRS = new Set(["raw", "smaller", "2025 Recap", "Paddy"]);

async function findJpgs(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".jpg"))
    .map((e) => path.join(e.parentPath, e.name))
    .filter((filePath) => {
      const relative = path.relative(root, filePath);
      const topLevelSegments = relative.split(path.sep);
      return !topLevelSegments.some((segment) => EXCLUDED_DIRS.has(segment));
    });
}

const KNOWN_CITIES = new Set([
  "Baden-Baden",
  "Frankfurt",
  "Heidelberg",
  "koln",
]);

function parseCountryAndCity(
  filePath: string,
  root: string,
): { country: string; city: string | null } {
  const relative = path.relative(root, filePath);
  const segments = relative.split(path.sep);
  const country = segments[0];
  const city =
    segments.length > 2 && KNOWN_CITIES.has(segments[1]) ? segments[1] : null;
  return { country, city };
}

async function extractPhotoData(filePath: string, root: string) {
  const exif = await extractExif(filePath);
  const { country, city } = parseCountryAndCity(filePath, root);
  return {
    file_path: filePath,
    filename: path.basename(filePath),
    country,
    city,
    ...exif,
  };
}

const insertPhoto = db.prepare(`
  INSERT OR IGNORE INTO photos (
    file_path, filename, country, city,
    camera_make, camera_model, lens,
    aperture, shutter_speed, iso, focal_length, captured_at
  ) VALUES (
    @file_path, @filename, @country, @city,
    @camera_make, @camera_model, @lens,
    @aperture, @shutter_speed, @iso, @focal_length, @captured_at
  )
`);

const insertMany = db.transaction(
  (rows: Awaited<ReturnType<typeof extractPhotoData>>[]) => {
    for (const row of rows) {
      insertPhoto.run(row);
    }
  },
);

async function main() {
  const files = await findJpgs(PHOTOS_ROOT);
  console.log(`Found ${files.length} JPGs`);

  const rows = [];
  for (const filePath of files) {
    try {
      rows.push(await extractPhotoData(filePath, PHOTOS_ROOT));
    } catch (err) {
      console.error(`Skipping ${filePath}:`, err);
    }
  }

  insertMany(rows);
  console.log(`Inserted ${rows.length} photos`);
}

main();
