import path from "node:path";
import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { pipeline } from "@huggingface/transformers";
import sharp from "sharp";
import { db } from "./db.js";

// mcp-server/dist/indexEmbeddings.js -> repo root .env is two levels up
config({ path: path.join(import.meta.dirname, "../../.env") });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CAPTION_MODEL = "claude-sonnet-5";
const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const CONCURRENCY = 5;
// Anthropic's vision endpoint caps images at 10MB base64 and resizes anything
// above ~1568px on the long edge server-side anyway, so downscaling to that
// before sending is free — same caption quality, no risk of the raw camera
// JPEG (often 15-25MB) blowing the size limit.
const MAX_EDGE_PX = 1568;

const CAPTION_PROMPT = `Describe this photograph in 2-3 sentences for a visual search index. Focus only on what's visually present: the scene and setting, main subjects, lighting and mood, and dominant colors or textures. Do not mention camera settings, location names, or dates — those are tracked separately. Avoid generic praise words like "beautiful" or "stunning"; describe concretely what makes the scene visually distinct, as if describing it to someone who can't see it.`;

async function captionPhoto(filePath: string): Promise<string> {
  const resized = await sharp(filePath)
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const base64 = resized.toString("base64");
  const message = await anthropic.messages.create({
    model: CAPTION_MODEL,
    max_tokens: 350,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: base64 },
          },
          { type: "text", text: CAPTION_PROMPT },
        ],
      },
    ],
  });
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error(`No caption text returned for ${filePath}`);
  }
  return block.text.trim();
}

async function main() {
  const photos = db
    .prepare("SELECT id, file_path FROM photos")
    .all() as { id: number; file_path: string }[];
  console.error(`Indexing ${photos.length} photos with ${EMBEDDING_MODEL}...`);

  const embed = await pipeline("feature-extraction", EMBEDDING_MODEL);

  const upsert = db.prepare(`
    INSERT INTO photo_embeddings (photo_id, caption, embedding, model, created_at)
    VALUES (@photo_id, @caption, @embedding, @model, @created_at)
    ON CONFLICT(photo_id) DO UPDATE SET
      caption = excluded.caption,
      embedding = excluded.embedding,
      model = excluded.model,
      created_at = excluded.created_at
  `);

  let done = 0;
  let failed = 0;

  for (let i = 0; i < photos.length; i += CONCURRENCY) {
    const batch = photos.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (photo) => {
        try {
          const caption = await captionPhoto(photo.file_path);
          const output = await embed(caption, { pooling: "mean", normalize: true });
          const vector = Float32Array.from(output.data as Float32Array);

          upsert.run({
            photo_id: photo.id,
            caption,
            embedding: Buffer.from(vector.buffer),
            model: EMBEDDING_MODEL,
            created_at: new Date().toISOString(),
          });

          done++;
          console.error(`[${done + failed}/${photos.length}] ${photo.file_path}`);
        } catch (err) {
          failed++;
          console.error(`[FAILED] ${photo.file_path}:`, err);
        }
      }),
    );
  }

  console.error(`Done. ${done} indexed, ${failed} failed.`);
}

main();
