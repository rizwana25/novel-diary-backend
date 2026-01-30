require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

/* --------------------
   DATABASE CONNECTION
-------------------- */

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

/* --------------------
   HEALTH CHECK
-------------------- */

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* --------------------
   USER INIT (DEVICE BASED)
-------------------- */

app.post("/users/init", async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId required" });
    }

    const [rows] = await db.query(
      "SELECT id FROM users WHERE device_id = ?",
      [deviceId]
    );

    let userId;

    if (rows.length === 0) {
      const [result] = await db.query(
        "INSERT INTO users (device_id) VALUES (?)",
        [deviceId]
      );
      userId = result.insertId;
    } else {
      userId = rows[0].id;
    }

    res.json({ userId });
  } catch (err) {
    console.error("USER INIT ERROR ↓↓↓");
    console.error(err); // 👈 THIS is the missing piece
    res.status(500).json({ error: err.message });
  }
});

/* --------------------
   INTRO STATUS
-------------------- */

app.get("/intro/status", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const [rows] = await db.query(
      "SELECT id FROM introductions WHERE user_id = ?",
      [userId]
    );

    res.json({
      hasIntro: rows.length > 0,
    });
  } catch (err) {
    console.error("INTRO STATUS ERROR:", err);
    res.status(500).json({ error: "Intro status failed" });
  }
});

/* --------------------
   SAVE INTRO (ONCE)
-------------------- */

app.post("/intro/save", async (req, res) => {
  try {
    const { userId, content } = req.body;

    if (!userId || !content) {
      return res.status(400).json({ error: "userId and content required" });
    }

    await db.query(
      "INSERT INTO introductions (user_id, content) VALUES (?, ?)",
      [userId, content]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE INTRO ERROR:", err);
    res.status(500).json({ error: "Failed to save introduction" });
  }
});

/* --------------------
   START SERVER
-------------------- */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
