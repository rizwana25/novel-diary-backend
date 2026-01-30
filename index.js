import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const db = await mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

// --------------------
// INIT / GET USER
// --------------------
app.post("/users/init", async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

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
});

// --------------------
// INTRO STATUS  ✅ (THIS WAS MISSING)
// --------------------
app.get("/intro/status", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const [rows] = await db.query(
    "SELECT id FROM introductions WHERE user_id = ? LIMIT 1",
    [userId]
  );

  res.json({ hasIntro: rows.length > 0 });
});

// --------------------
// SAVE INTRO
// --------------------
app.post("/intro/save", async (req, res) => {
  const { userId, introText } = req.body;
  if (!userId || !introText)
    return res.status(400).json({ error: "invalid payload" });

  await db.query(
    "INSERT INTO introductions (user_id, text) VALUES (?, ?)",
    [userId, introText]
  );

  res.json({ success: true });
});

// --------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
