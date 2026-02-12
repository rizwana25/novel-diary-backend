require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =========================
   DATABASE CONNECTION
========================= */
const db = mysql.createPool({
  uri: process.env.MYSQL_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/health", async (req, res) => {
  try {
    await db.execute("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ status: "error", db: "not connected" });
  }
});

/* =========================
   SAVE DAILY ENTRY
========================= */
app.post("/api/entries", async (req, res) => {
  try {
    const { userUid, entryDate, content } = req.body;

    if (!userUid || !entryDate) {
      return res.status(400).json({ error: "Missing fields" });
    }

    await db.execute(
      `
      INSERT INTO daily_entries (user_uid, entry_date, content)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE content = VALUES(content)
      `,
      [userUid, entryDate, content]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE ENTRY ERROR:", err);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

/* =========================
   FETCH SINGLE ENTRY
========================= */
app.get("/api/entries/:userUid/:date", async (req, res) => {
  try {
    const { userUid, date } = req.params;

    const [rows] = await db.execute(
      "SELECT content FROM daily_entries WHERE user_uid = ? AND entry_date = ?",
      [userUid, date]
    );

    res.json({ content: rows[0]?.content || "" });
  } catch (err) {
    console.error("FETCH ENTRY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch entry" });
  }
});

/* =========================
   FETCH ALL ENTRY DATES
========================= */
app.get("/api/entries/:userUid", async (req, res) => {
  try {
    const { userUid } = req.params;

    const [rows] = await db.execute(
      "SELECT entry_date FROM daily_entries WHERE user_uid = ? ORDER BY entry_date DESC",
      [userUid]
    );

    res.json(rows);
  } catch (err) {
    console.error("FETCH DATES ERROR:", err);
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

/* =========================
   FETCH WEEKLY ENTRIES
========================= */
app.get("/api/entries/week/:userUid", async (req, res) => {
  try {
    const { userUid } = req.params;

    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatDate = (d) => d.toISOString().split("T")[0];

    const startDate = formatDate(monday);
    const endDate = formatDate(sunday);

    const [rows] = await db.execute(
      `
      SELECT entry_date, content
      FROM daily_entries
      WHERE user_uid = ?
      AND entry_date BETWEEN ? AND ?
      ORDER BY entry_date ASC
      `,
      [userUid, startDate, endDate]
    );

    res.json({
      weekStart: startDate,
      weekEnd: endDate,
      entries: rows,
    });
  } catch (err) {
    console.error("WEEK FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to fetch weekly entries" });
  }
});

app.post("/api/entries/week/:userUid/enhance", async (req, res) => {
  try {
    const { userUid } = req.params;

    if (!userUid) {
      return res.status(400).json({ error: "Missing userUid" });
    }

    /* =========================
       CALCULATE WEEK RANGE
    ========================= */
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatDate = (d) => d.toISOString().split("T")[0];
    const weekStart = formatDate(monday);
    const weekEnd = formatDate(sunday);

    /* =========================
       CHECK IF CHAPTER EXISTS
    ========================= */
    const [existing] = await db.execute(
      "SELECT chapter_text FROM weekly_chapters WHERE user_uid = ? AND week_start = ?",
      [userUid, weekStart]
    );

    if (existing.length > 0) {
      return res.json({
        enhancedChapter: existing[0].chapter_text,
        source: "database"
      });
    }

    /* =========================
       FETCH WEEKLY ENTRIES
    ========================= */
    const [entries] = await db.execute(
      `SELECT content
       FROM daily_entries
       WHERE user_uid = ?
       AND entry_date BETWEEN ? AND ?
       ORDER BY entry_date ASC`,
      [userUid, weekStart, weekEnd]
    );

    if (entries.length === 0) {
      return res.json({ error: "No entries this week" });
    }

    let compiledText = "";
    entries.forEach((e) => {
      compiledText += e.content.trim() + "\n\n";
    });

    /* =========================
       CALL GEMINI 2.5
    ========================= */
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
Rewrite the following diary entries into a single continuous third-person narrative.

Voice:
- Use "she" consistently.
- Stay fully inside her experience.
- Do not step outside her perspective.

Strict Rules:
- Do NOT invent events.
- Do NOT add conversations.
- Do NOT introduce new people.
- Do NOT summarize.
- Do NOT mention dates or weeks.

Diary Entries:
${compiledText}
                  `
                }
              ]
            }
          ]
        })
      }
    );

    const geminiData = await geminiResponse.json();

    if (geminiData.error) {
      console.error(geminiData.error);
      return res.status(500).json({ error: "AI generation failed" });
    }

    const enhancedText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!enhancedText) {
      return res.status(500).json({ error: "No AI output" });
    }

    /* =========================
       SAVE CHAPTER
    ========================= */
    await db.execute(
      `INSERT INTO weekly_chapters 
       (user_uid, week_start, week_end, chapter_text)
       VALUES (?, ?, ?, ?)`,
      [userUid, weekStart, weekEnd, enhancedText]
    );

    res.json({
      enhancedChapter: enhancedText,
      source: "generated"
    });

  } catch (err) {
    console.error("ENHANCE ERROR:", err);
    res.status(500).json({ error: "Failed to enhance chapter" });
  }
});
app.post("/api/profile", async (req, res) => {
  try {
    const { userUid, name, pronoun, place, life_phase, daily_life, dreams } = req.body;

    if (!userUid) {
      return res.status(400).json({ error: "Missing userUid" });
    }

    await db.execute(
      `INSERT INTO user_profiles 
      (user_uid, name, pronoun, place, life_phase, daily_life, dreams)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        pronoun = VALUES(pronoun),
        place = VALUES(place),
        life_phase = VALUES(life_phase),
        daily_life = VALUES(daily_life),
        dreams = VALUES(dreams)`,
      [userUid, name, pronoun, place, life_phase, daily_life, dreams]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("PROFILE SAVE ERROR:", err);
    res.status(500).json({ error: "Failed to save profile" });
  }
});
app.get("/api/profile/:userUid", async (req, res) => {
  try {
    const { userUid } = req.params;

    const [rows] = await db.execute(
      "SELECT * FROM user_profiles WHERE user_uid = ?",
      [userUid]
    );

    if (rows.length === 0) {
      return res.json({ profile: null });
    }

    res.json({ profile: rows[0] });

  } catch (err) {
    console.error("PROFILE FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});
app.post("/api/profile/:userUid/generate-intro", async (req, res) => {
  try {
    const { userUid } = req.params;

    const [rows] = await db.execute(
      "SELECT * FROM user_profiles WHERE user_uid = ?",
      [userUid]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const profile = rows[0];

    const profileText = `
Name: ${profile.name}
Pronoun: ${profile.pronoun}
Place: ${profile.place}
Life Phase: ${profile.life_phase}
Daily Life: ${profile.daily_life}
Dreams: ${profile.dreams}
`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
Write a third-person introduction for a memoir.

STRICT RULES:
- Do NOT invent events.
- Do NOT add backstory.
- Use only the information provided.
- Keep tone natural and grounded.
- Do not sound dramatic.
- Do not summarize life lessons.
- Do not mention time markers like years.
- This is the opening of a printed book.

Profile:
${profileText}
                  `
                }
              ]
            }
          ]
        })
      }
    );

    const geminiData = await geminiResponse.json();

    const introText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!introText) {
      return res.status(500).json({ error: "Failed to generate intro" });
    }

    await db.execute(
      "UPDATE user_profiles SET generated_intro = ? WHERE user_uid = ?",
      [introText, userUid]
    );

    res.json({
      intro: introText,
      source: "generated"
    });

  } catch (err) {
    console.error("INTRO GENERATION ERROR:", err);
    res.status(500).json({ error: "Failed to generate intro" });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
