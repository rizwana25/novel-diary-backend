require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =========================
   DATABASE (already working)
   ========================= */
const db = mysql.createPool({
  uri: process.env.MYSQL_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   FIREBASE ADMIN INIT
   ========================= */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

/* =========================
   AUTH MIDDLEWARE
   ========================= */
async function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // uid, email, etc.
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* =========================
   ROUTES
   ========================= */

// health check (public)
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// auth test route (protected)
app.get("/me", auth, (req, res) => {
  res.json({
    uid: req.user.uid,
    email: req.user.email || null,
  });
});
app.post("/intro", auth, async (req, res) => {
  const { introText, rawInputs } = req.body;
  const uid = req.user.uid;

  if (!introText) {
    return res.status(400).json({ error: "Intro text required" });
  }

  try {
    await db.execute(
      `INSERT INTO intro (firebase_uid, intro_text, raw_inputs)
       VALUES (?, ?, ?)`,
      [uid, introText, JSON.stringify(rawInputs)]
    );

    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Intro already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* =========================
   START SERVER
   ========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
