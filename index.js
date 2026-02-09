require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ================= DATABASE ================= */
const db = mysql.createPool({
  uri: process.env.MYSQL_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

/* ================= FIREBASE ADMIN ================= */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

/* ================= AUTH MIDDLEWARE ================= */
async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const token = header.split(" ")[1];
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ================= HEALTH ================= */
app.get("/health", (_, res) => res.json({ ok: true }));

/* ================= CHECK INTRO ================= */
app.get("/intro", auth, async (req, res) => {
  const [rows] = await db.execute(
    "SELECT intro_text FROM intro WHERE firebase_uid = ?",
    [req.user.uid]
  );
  res.json({ exists: rows.length > 0, intro: rows[0]?.intro_text });
});

/* ================= GENERATE INTRO ================= */
app.post("/generate-intro", auth, async (req, res) => {
  const d = req.body;

  const prompt = `
Write a quiet, raw, heartfelt novel-style opening.

Rules:
- Mention the name "${d.name}" once
- Use ${d.pronoun} pronouns
- Start at "${d.place}"
- Simple language, unresolved
- Short paragraphs
- End EXACTLY with: Her story begins here today.

Life phase: ${d.phase}
Daily life: ${d.daily}
Mood: ${d.detail}
  `;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  const data = await r.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    return res.status(500).json({ error: "Gemini failed" });
  }

  res.json({ introText: text });
});

/* ================= SAVE INTRO ================= */
app.post("/intro", auth, async (req, res) => {
  const { introText, rawInputs } = req.body;

  await db.execute(
    `INSERT INTO intro (firebase_uid, intro_text, raw_inputs)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE intro_text = VALUES(intro_text)`,
    [req.user.uid, introText, JSON.stringify(rawInputs)]
  );

  res.json({ saved: true });
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
