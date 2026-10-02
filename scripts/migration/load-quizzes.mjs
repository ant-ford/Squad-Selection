#!/usr/bin/env node
// Loads the Hockey Rules quizzes (questions, answer keys, explanations) into
// public.quizzes from a JSON file kept outside the repository (it's public,
// and the answer keys aren't). The file is what the Fillout quiz forms held:
// { "<quiz key>": { "title", "blocks": [ {type: "text"|"question"|"image", ...} ] } }.
//
//   node load-quizzes.mjs --file=quizzes.json                        dry run, eddy-preview
//   node load-quizzes.mjs --file=quizzes.json --apply                write eddy-preview
//   ... --apply --target=production --i-understand-this-writes-production
//
// Upserts by quiz key, so loading again updates the questions. Scores are
// untouched (quiz_scores; past ones come with the Airtable import).

import fs from "node:fs";
import { connect, parseArgs, targetDatabase } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { target: "preview" });
if (typeof args.file !== "string" || !fs.existsSync(args.file)) throw new Error("--file must be the quizzes JSON");
const apply = args.apply === true;
const target = targetDatabase(args);

const source = JSON.parse(fs.readFileSync(args.file, "utf8"));
const rows = Object.entries(source).map(([key, q], i) => {
  const texts = q.blocks.filter((b) => b.type === "text").map((b) => b.text);
  const questions = q.blocks
    .filter((b) => b.type === "question")
    .map((b) => ({ id: b.id, text: b.text, options: b.options, correct: b.correct, points: b.points ?? 1, explanation: b.explanation ?? null }));
  for (const qn of questions) {
    if (!qn.correct.length || qn.correct.some((c) => !qn.options.some((o) => o.id === c))) throw new Error(`${key}: question ${qn.id} has no valid answer`);
  }
  return {
    key,
    // The form's heading, e.g. "THE FAMOUS MEN'S HOCKEY RULES QUIZ 1.0 (Corrected for 2026 Rules)".
    title: (texts[0] ?? q.title).split("\n")[0].trim(),
    // The welcome; Fillout's name placeholder becomes {name}.
    intro: [texts[0]?.split("\n").slice(1).join("\n").trim(), ...texts.slice(1)].filter(Boolean).join("\n\n").replace(/\{\{[^}]+\}\}/g, "{name}") || null,
    questions,
    sort: i + 1,
  };
});
for (const r of rows) console.log(`${r.key}: "${r.title}", ${r.questions.length} questions, ${r.questions.reduce((n, q) => n + q.points, 0)} points`);
if (!apply) {
  console.log(`Dry run for ${target.label}: add --apply to write.`);
} else {
  const db = await connect(target.url);
  try {
    for (const r of rows) {
      await db.query(
        `insert into public.quizzes (key, title, intro, questions, sort) values ($1, $2, $3, $4, $5)
         on conflict (key) do update set title = excluded.title, intro = excluded.intro, questions = excluded.questions, sort = excluded.sort`,
        [r.key, r.title, r.intro, JSON.stringify(r.questions), r.sort],
      );
    }
    console.log(`Loaded ${rows.length} quizzes into ${target.label}.`);
  } finally {
    await db.end();
  }
}
