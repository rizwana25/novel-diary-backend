const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// This line lets the server read JSON data sent from the app
app.use(express.json());

// Health check (used to see if server is alive)
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Test endpoint to check POST requests
app.post("/echo", (req, res) => {
  const message = req.body.message;

  res.json({
    received: message,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
