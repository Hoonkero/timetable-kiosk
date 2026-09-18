#!/usr/bin/env node
// Validates timetable JSON files before publishing: node scripts/validate-data.js data/*.json
"use strict";
const fs = require("node:fs");
const DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "weekend"]);
let failed = 0;
for (const file of process.argv.slice(2)) {
  const problems = [];
  const root = JSON.parse(fs.readFileSync(file, "utf8"));
  const schedule = root.schedule || root;
  const classes = schedule.classes || {};
  if (!Object.keys(classes).length) problems.push("no classes");
  for (const [id, item] of Object.entries(classes)) {
    for (const [day, lessons] of Object.entries(item.days || {})) {
      if (!DAYS.has(day)) problems.push(`${id}: unknown day "${day}"`);
      (lessons || []).forEach((lesson, index) => {
        if (!lesson.subject) problems.push(`${id}/${day}#${index + 1}: missing subject`);
        if (lesson.time && !/^\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}$/.test(lesson.time)) problems.push(`${id}/${day}#${index + 1}: bad time "${lesson.time}"`);
        if (lesson.week && !["even", "odd"].includes(lesson.week)) problems.push(`${id}/${day}#${index + 1}: week must be even|odd`);
      });
    }
  }
  if (problems.length) { failed += 1; console.error(`✗ ${file}\n  ${problems.join("\n  ")}`); }
  else console.log(`✓ ${file}: ${Object.keys(classes).length} classes`);
}
process.exit(failed ? 1 : 0);
