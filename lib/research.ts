import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/** Persisted research notes, grouped by local date. */

export interface ResearchNote {
  id: string;
  date: string; // YYYY-MM-DD local
  title: string;
  content: string; // markdown
  source: "copilot" | "generated";
  created: number;
}

const FILE = path.join(process.cwd(), "data", "research.json");
const g = globalThis as { __vtResearch?: ResearchNote[] };

export function todayStr(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function load(): ResearchNote[] {
  if (g.__vtResearch) return g.__vtResearch;
  try {
    g.__vtResearch = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    g.__vtResearch = [];
  }
  return g.__vtResearch!;
}

function save(notes: ResearchNote[]) {
  g.__vtResearch = notes;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(notes, null, 2));
}

/** Newest first, capped to the most recent 60 notes. */
export function listResearch(): ResearchNote[] {
  return [...load()].sort((a, b) => b.created - a.created).slice(0, 60);
}

export function addResearch(
  title: string,
  content: string,
  source: ResearchNote["source"]
): ResearchNote {
  const note: ResearchNote = {
    id: randomUUID(),
    date: todayStr(),
    title: title.slice(0, 80),
    content,
    source,
    created: Date.now(),
  };
  save([...load(), note]);
  // index for semantic search; dynamic import avoids a module cycle,
  // fire-and-forget so a down embed model never blocks a save
  import("./embeddings")
    .then((m) => m.embedNote(note))
    .catch((e) => console.error("[embed]", e instanceof Error ? e.message : e));
  return note;
}

export function deleteResearch(id: string): boolean {
  const notes = load();
  const next = notes.filter((n) => n.id !== id);
  if (next.length === notes.length) return false;
  save(next);
  return true;
}
