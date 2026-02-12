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
    const [rows] = await db.execute("SELECT 1");
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
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
