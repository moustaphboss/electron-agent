import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dbPath = path.join(import.meta.dirname, "../data/photos.db");
mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    country TEXT NOT NULL,
    city TEXT,
    camera_make TEXT,
    camera_model TEXT,
    lens TEXT,
    aperture REAL,
    shutter_speed REAL,
    iso INTEGER,
    focal_length REAL,
    captured_at TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS photo_embeddings (
    photo_id INTEGER PRIMARY KEY REFERENCES photos(id),
    caption TEXT NOT NULL,
    embedding BLOB NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);
