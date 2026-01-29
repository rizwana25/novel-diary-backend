require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --------------------
// TEMP LOGIN CODE STORE
// --------------------
const loginCodes = {}; 
// { email: { code, expiresAt } }

// --------------------
// EMAIL SETUP
// --------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --------------------
// HEALTH CHECK
// --------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------
// START LOGIN (SEND CODE)
// --------------------
app.post("/auth/start", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  loginCodes[email] = { code, expiresAt };

  try {
    await transporter.sendMail({
      from: `"Novel Diary" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your login code",
      text: `Your login code is: ${code}\n\nThis code expires in 10 minutes.`,
    });

    res.json({ message: "Login code sent to email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// --------------------
// VERIFY LOGIN CODE
// --------------------
app.post("/auth/verify", (req, res) => {
  const { email, code } = req.body;

  const record = loginCodes[email];

  if (!record) {
    return res.status(400).json({ error: "No login request found" });
  }

  if (Date.now() > record.expiresAt) {
    delete loginCodes[email];
    return res.status(400).json({ error: "Code expired" });
  }

  if (record.code !== code) {
    return res.status(400).json({ error: "Invalid code" });
  }

  delete loginCodes[email];

  res.json({
    message: "Login successful",
    userId: email,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
