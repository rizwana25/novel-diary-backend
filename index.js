require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

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
// INIT USER (DEVICE-BASED)
// --------------------
app.post("/users/init", async (req, res) => {
  const { deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  try {
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
    console.error(err);
    res.status(500).json({ error: "Failed to init user" });
  }
});

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
