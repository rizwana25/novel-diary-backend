require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ✅ DB CONNECTION (USING MYSQL_PUBLIC_URL)
const db = mysql.createPool({
  uri: process.env.MYSQL_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ✅ USER INIT
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

    if (rows.length > 0) {
      return res.json({ userId: rows[0].id, isNew: false });
    }

    const [result] = await db.query(
      "INSERT INTO users (device_id) VALUES (?)",
      [deviceId]
    );

    res.json({ userId: result.insertId, isNew: true });
  } catch (err) {
    console.error("USER INIT ERROR ↓↓↓", err);
    res.status(500).json({ error: "User init failed" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
