require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --------------------
// DATABASE CONNECTION
// --------------------
const db = mysql.createPool(
  process.env.MYSQL_PUBLIC_URL
    ? process.env.MYSQL_PUBLIC_URL
    : {
        host: process.env.MYSQLHOST,
        port: process.env.MYSQLPORT,
        user: process.env.MYSQLUSER,
        password: process.env.MYSQLPASSWORD,
        database: process.env.MYSQLDATABASE,
      }
);

// --------------------
// HEALTH CHECK
// --------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------
// INIT USER (DEVICE BASED)
// --------------------
app.post("/users/init", async (req, res) => {
  const { deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: "Missing deviceId" });
  }

  try {
    const [rows] = await db.query(
      "SELECT id FROM users WHERE device_id = ?",
      [deviceId]
    );

    if (rows.length > 0) {
      return res.json({ userId: rows[0].id });
    }

    const [result] = await db.query(
      "INSERT INTO users (device_id) VALUES (?)",
      [deviceId]
    );

    res.json({ userId: result.insertId });
  } catch (err) {
    console.error("User init error:", err);
    res.status(500).json({ error: "Failed to init user" });
  }
});

// --------------------
// INTRO STATUS
// --------------------
app.get("/intro/status", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  try {
    const [rows] = await db.query(
      "SELECT 1 FROM user_intro WHERE user_id = ? LIMIT 1",
      [userId]
    );

    res.json({ hasIntro: rows.length > 0 });
  } catch (err) {
    console.error("Intro status error:", err);
    res.status(500).json({ error: "Failed to check intro" });
  }
});

// --------------------
// SAVE INTRODUCTION
// --------------------
app.post("/intro/save", async (req, res) => {
  const { userId, introText } = req.body;

  if (!userId || !introText) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    await db.query(
      `INSERT INTO user_intro (user_id, intro_text)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE intro_text = VALUES(intro_text)`,
      [userId, introText]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Intro save error:", err);
    res.status(500).json({ error: "Failed to save intro" });
  }
});

// --------------------
// GET TODAY'S JOURNAL
// --------------------
app.get("/journal/today", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  try {
    const [rows] = await db.query(
      `SELECT content FROM journal_entries
       WHERE user_id = ? AND entry_date = CURDATE()`,
      [userId]
    );

    res.json({
      content: rows.length > 0 ? rows[0].content : "",
    });
  } catch (err) {
    console.error("Load journal error:", err);
    res.status(500).json({ error: "Failed to load entry" });
  }
});

// --------------------
// SAVE TODAY'S JOURNAL
// --------------------
app.post("/journal/save", async (req, res) => {
  const { userId, content } = req.body;

  if (!userId || content === undefined) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    await db.query(
      `INSERT INTO journal_entries (user_id, entry_date, content)
       VALUES (?, CURDATE(), ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content)`,
      [userId, content]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save journal error:", err);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
