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
