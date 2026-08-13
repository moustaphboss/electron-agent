import exifr from "exifr";
const { parse: parseExif } = exifr;

export interface ExifData {
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  aperture: number | null;
  shutter_speed: number | null;
  iso: number | null;
  focal_length: number | null;
  captured_at: string | null;
}

export async function extractExif(filePath: string): Promise<ExifData> {
  const exif = await parseExif(filePath, {
    pick: [
      "Make",
      "Model",
      "LensModel",
      "FNumber",
      "ExposureTime",
      "ISO",
      "FocalLength",
      "DateTimeOriginal",
    ],
  });
  return {
    camera_make: exif?.Make ?? null,
    camera_model: exif?.Model ?? null,
    lens: exif?.LensModel ?? null,
    aperture: exif?.FNumber ?? null,
    shutter_speed: exif?.ExposureTime ?? null,
    iso: exif?.ISO ?? null,
    focal_length: exif?.FocalLength ?? null,
    captured_at: exif?.DateTimeOriginal
      ? exif.DateTimeOriginal.toISOString()
      : null,
  };
}
