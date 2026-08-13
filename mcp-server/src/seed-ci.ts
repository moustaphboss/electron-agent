import path from "node:path";
import { db } from "./db.js";

// Fixture data for CI, where the real photo library isn't available.
// Reuses the already-committed app icon as a stand-in "photo" so the
// custom photo-file:// protocol has real bytes to serve.
const iconPath = path.join(import.meta.dirname, "../../resources/icon.png");

const insertFixture = db.prepare(`
  INSERT OR IGNORE INTO photos (
    file_path, filename, country, city,
    camera_make, camera_model, captured_at
  ) VALUES (
    @file_path, @filename, @country, @city,
    @camera_make, @camera_model, @captured_at
  )
`);

insertFixture.run({
  file_path: iconPath,
  filename: "icon.png",
  country: "Germany",
  city: "Berlin",
  camera_make: "Fixture",
  camera_model: "CI-Test",
  captured_at: "2026-01-01T00:00:00.000Z",
});

console.log("Seeded 1 fixture photo for CI");
