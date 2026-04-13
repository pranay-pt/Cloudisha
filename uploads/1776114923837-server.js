require("dotenv").config();

const multer = require("multer");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { Resend } = require("resend");

const app = express();
// ✅ Allow requests from Live Server (any localhost port) and direct Express access
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman) or any localhost origin
    if (!origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));
app.use(express.json());

// ==========================
// 📁 SERVE FRONTEND
// ==========================
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// ==========================
// 🔥 Init Resend
// ==========================
const resend = new Resend(process.env.RESEND_API_KEY);

// ==========================
// 🧠 TEMP DATABASE
// ==========================
let users = {};

// ==========================
// 📧 SEND VERIFICATION EMAIL
// ==========================
app.post("/send-verification", async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).send("Missing fields");
  }

  // ✅ FIXED: prevent overwriting already-verified accounts
  if (users[email] && users[email].verified) {
    return res.status(400).send("Account already exists and is verified. Please log in.");
  }

  const token = Math.random().toString(36).substring(2);

  users[email] = { email, password, username, verified: false, token };

  const link = `http://localhost:3000/verify?token=${token}&email=${encodeURIComponent(email)}`;

  try {
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "Verify your Cloudisha email ☁️",
      html: `
        <h2>Email Verification</h2>
        <p>Click below to verify your account:</p>
        <a href="${link}">Verify Email</a>
      `
    });

    console.log("✅ Email sent to:", email);
    res.send({ success: true });

  } catch (err) {
    console.error("❌ EMAIL ERROR:", err);
    res.status(500).send("Email failed");
  }
});

// ==========================
// ✅ VERIFY LINK
// ==========================
app.get("/verify", (req, res) => {
  const { email, token } = req.query;

  if (users[email] && users[email].token === token) {
    users[email].verified = true;

    return res.send(`
      <h2>Email verified successfully ✅</h2>
      <p>Redirecting to login...</p>
      <script>
        setTimeout(() => { window.location.href = "/login.html"; }, 2000);
      </script>
    `);
  }

  res.send("Invalid or expired link ❌");
});

// ==========================
// 🔐 LOGIN
// ==========================
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = users[email];

  if (!user) return res.status(400).send("User not found");
  if (!user.verified) return res.status(403).send("Verify your email first");
  if (user.password !== password) return res.status(401).send("Wrong password");

  res.send({ success: true, username: user.username });
});

// ==========================
// 📁 FILE UPLOAD SETUP
// ==========================
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// ==========================
// 📤 UPLOAD FILE
// ==========================
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  res.send({ success: true, file: req.file.filename });
});

// ==========================
// 📋 LIST FILES
// ✅ FIXED: was missing — dashboard had no way to fetch the file list
// ==========================
app.get("/files", (req, res) => {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) return res.status(500).json({ message: "Could not read files" });
    res.json(files);
  });
});

// ==========================
// 🗑️ DELETE FILE
// ✅ FIXED: was missing — delete button in dashboard had no server handler
// ==========================
app.delete("/files/:name", (req, res) => {
  const filename = path.basename(req.params.name); // prevent path traversal
  const filepath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ message: "File not found" });
  }

  fs.unlink(filepath, (err) => {
    if (err) return res.status(500).json({ message: "Delete failed" });
    res.json({ success: true });
  });
});

// Serve uploaded files
app.use("/uploads", express.static(UPLOADS_DIR));

// ==========================
// 🚀 START SERVER
// ==========================
app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});