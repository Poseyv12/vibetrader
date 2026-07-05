import fs from "fs";
import path from "path";
import { resolved } from "./settings";
import { listResearch, ResearchNote } from "./research";

/**
 * Semantic index over the research journal, embedded locally via LM Studio's
 * /v1/embeddings (nomic-embed). Vectors persist in data/embeddings.json keyed
 * by note id; notes missing vectors get backfilled lazily on first search.
 */

const FILE = path.join(process.cwd(), "data", "embeddings.json");
const g = globalThis as { __vtVectors?: Record<string, number[]> };

function loadVectors(): Record<string, number[]> {
  if (g.__vtVectors) return g.__vtVectors;
  try {
    g.__vtVectors = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    g.__vtVectors = {};
  }
  return g.__vtVectors!;
}

function saveVectors(v: Record<string, number[]>) {
  g.__vtVectors = v;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(v));
}

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${resolved.llmUrl()}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: resolved.embedModel(), input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

const noteText = (n: ResearchNote) => `${n.title}\n${n.content}`.slice(0, 2000);

export async function embedNote(note: ResearchNote): Promise<void> {
  const [vec] = await embed([noteText(note)]);
  const vectors = loadVectors();
  vectors[note.id] = vec;
  saveVectors(vectors);
}

/** Embed any notes that don't have vectors yet (batched). */
async function backfill(notes: ResearchNote[]): Promise<void> {
  const vectors = loadVectors();
  const missing = notes.filter((n) => !vectors[n.id]);
  if (!missing.length) return;
  for (let i = 0; i < missing.length; i += 8) {
    const batch = missing.slice(i, i + 8);
    const vecs = await embed(batch.map(noteText));
    batch.forEach((n, j) => (vectors[n.id] = vecs[j]));
  }
  saveVectors(vectors);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function searchJournal(query: string, k = 5) {
  const notes = listResearch();
  if (!notes.length) return [];
  await backfill(notes);
  const [qVec] = await embed([query]);
  const vectors = loadVectors();
  return notes
    .map((n) => ({ note: n, score: vectors[n.id] ? cosine(qVec, vectors[n.id]) : -1 }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ note, score }) => ({ ...note, score: Math.round(score * 1000) / 1000 }));
}
