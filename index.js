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
   DEFAULT ROUTE
========================= */
app.get("/", (req, res) => {
  res.json({ message: "Backend running successfully" });
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

    const query = `
      INSERT INTO daily_entries (user_uid, entry_date, content)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        content = VALUES(content)
    `;

    await db.execute(query, [userUid, entryDate, content]);

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE ENTRY ERROR:", err);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

/* =========================
   WEEKLY ENTRIES (SPECIFIC ROUTE FIRST)
========================= */
app.get("/api/entries/week/:userUid", async (req, res) => {
  try {
    const { userUid } = req.params;

    if (!userUid) {
      return res.status(400).json({ error: "Missing userUid" });
    }

    const now = new Date();

    const day = now.getDay(); // 0 (Sun) - 6 (Sat)
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
app.get("/api/entries/week/:userUid/compiled", async (req, res) => {
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

    if (rows.length === 0) {
      return res.json({ chapterText: "No entries this week." });
    }

    let chapter = `Chapter: Week of ${startDate} to ${endDate}\n\n`;

    rows.forEach((entry) => {
      const dateOnly = entry.entry_date.toISOString().split("T")[0];
      chapter += `${dateOnly}\n`;
      chapter += `${entry.content}\n\n`;
    });

    res.json({ chapterText: chapter });

  } catch (err) {
    console.error("COMPILE ERROR:", err);
    res.status(500).json({ error: "Failed to compile weekly chapter" });
  }
});
app.post("/api/entries/week/:userUid/enhance", async (req, res) => {
  try {
    const { userUid } = req.params;

    if (!userUid) {
      return res.status(400).json({ error: "Missing userUid" });
    }

    /* =========================
       GET WEEK RANGE
    ========================= */
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1 - day);

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatDate = (d) => d.toISOString().split("T")[0];
    const startDate = formatDate(monday);
    const endDate = formatDate(sunday);

    /* =========================
       FETCH ENTRIES
    ========================= */
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

    if (rows.length === 0) {
      return res.json({ error: "No entries this week" });
    }

    /* =========================
       COMPILE RAW TEXT
    ========================= */
    let compiledText = "";
    rows.forEach((entry) => {
      compiledText += entry.content.trim() + "\n\n";
    });

    /* =========================
       CALL GEMINI
    ========================= */
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
Rewrite the following diary entries into a single cinematic third-person narrative chapter.

STRICT RULES:
- Do NOT invent events.
- Do NOT add conversations.
- Do NOT add sensory descriptions not present.
- Do NOT introduce new people.
- Use only information explicitly written.
- Merge naturally as a continuation of an ongoing story.
- Do not mention days or weeks.
- Keep it heartfelt and raw.
- Avoid melodrama.
- Do not summarize. Preserve all important details.

Diary Entries:
${compiledText}
                  `,
                },
              ],
            },
          ],
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    const enhancedText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Failed to generate narrative.";

    res.json({
      enhancedChapter: enhancedText,
    });
  } catch (err) {
    console.error("ENHANCE ERROR:", err);
    res.status(500).json({ error: "Failed to enhance chapter" });
  }
});

/* =========================
   FETCH SINGLE DAY ENTRY
========================= */
app.get("/api/entries/:userUid/:date", async (req, res) => {
  try {
    const { userUid, date } = req.params;

    const [rows] = await db.execute(
      "SELECT content FROM daily_entries WHERE user_uid = ? AND entry_date = ?",
      [userUid, date]
    );

    if (rows.length === 0) {
      return res.json({ content: "" });
    }

    res.json({ content: rows[0].content });
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
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
