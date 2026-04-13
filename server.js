require("dotenv").config();

const multer = require("multer");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));
app.use(express.json());

app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS
  }
});

let users = {};
let groups = {};

function generateGroupId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// SEND VERIFICATION
app.post("/send-verification", async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) return res.status(400).send("Missing fields");
  if (users[email] && users[email].verified) return res.status(400).send("Account already exists. Please log in.");

  const token = Math.random().toString(36).substring(2);
  users[email] = { email, password, username, verified: false, token };
  const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
  const link = `${BASE_URL}/verify?token=${token}&email=${encodeURIComponent(email)}`;

  try {
    await transporter.sendMail({
      from: `"Cloudisha ☁️" <${process.env.BREVO_USER}>`,
      to: email,
      subject: "Verify your Cloudisha email ☁️",
      html: `<h2>Email Verification</h2><p>Click to verify:</p><a href="${link}">Verify Email</a>`
    });
    console.log("✅ Email sent to:", email);
    res.send({ success: true });
  } catch (err) {
    console.error("❌ EMAIL ERROR:", err);
    res.status(500).send("Email failed");
  }
});

// VERIFY
app.get("/verify", (req, res) => {
  const { email, token } = req.query;
  if (users[email] && users[email].token === token) {
    users[email].verified = true;
    return res.send(`<h2>Email verified ✅</h2><script>setTimeout(()=>{window.location.href="/login.html"},2000)</script>`);
  }
  res.send("Invalid or expired link ❌");
});

// LOGIN
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (!user) return res.status(400).send("User not found");
  if (!user.verified) return res.status(403).send("Verify your email first");
  if (user.password !== password) return res.status(401).send("Wrong password");
  res.send({ success: true, username: user.username });
});

// PERSONAL FILE UPLOAD
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.send({ success: true, file: req.file.filename });
});

app.get("/files", (req, res) => {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) return res.status(500).json({ message: "Could not read files" });
    res.json(files.filter(f => !fs.statSync(path.join(UPLOADS_DIR, f)).isDirectory()));
  });
});

app.delete("/files/:name", (req, res) => {
  const filename = path.basename(req.params.name);
  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ message: "File not found" });
  fs.unlink(filepath, (err) => {
    if (err) return res.status(500).json({ message: "Delete failed" });
    res.json({ success: true });
  });
});

app.use("/uploads", express.static(UPLOADS_DIR));

// ==========================
// 👥 GROUP ROUTES
// ==========================

// CREATE GROUP
app.post("/groups/create", (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ message: "Missing fields" });
  let groupId;
  do { groupId = generateGroupId(); } while (groups[groupId]);

  groups[groupId] = { id: groupId, name, createdBy: email, admins: [email], members: [email], pendingRequests: [], files: [] };
  console.log(`✅ Group created: ${groupId} by ${email}`);
  res.json({ success: true, groupId });
});

// MY GROUPS
app.get("/groups/mine", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ message: "Missing email" });
  res.json(Object.values(groups).filter(g => g.members.includes(email)));
});

// GROUP INFO
app.get("/groups/:groupId", (req, res) => {
  const { email } = req.query;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(403).json({ message: "Not a member" });
  res.json(group);
});

// REQUEST TO JOIN
app.post("/groups/:groupId/request", (req, res) => {
  const { email } = req.body;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (group.members.includes(email)) return res.status(400).json({ message: "Already a member" });
  if (group.pendingRequests.includes(email)) return res.status(400).json({ message: "Request already pending" });
  group.pendingRequests.push(email);
  res.json({ success: true });
});

// APPROVE
app.post("/groups/:groupId/approve", (req, res) => {
  const { adminEmail, applicantEmail } = req.body;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.admins.includes(adminEmail)) return res.status(403).json({ message: "Not an admin" });
  if (!group.pendingRequests.includes(applicantEmail)) return res.status(400).json({ message: "No pending request" });
  group.pendingRequests = group.pendingRequests.filter(e => e !== applicantEmail);
  group.members.push(applicantEmail);
  res.json({ success: true });
});

// REJECT
app.post("/groups/:groupId/reject", (req, res) => {
  const { adminEmail, applicantEmail } = req.body;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.admins.includes(adminEmail)) return res.status(403).json({ message: "Not an admin" });
  group.pendingRequests = group.pendingRequests.filter(e => e !== applicantEmail);
  res.json({ success: true });
});

// PROMOTE TO ADMIN
app.post("/groups/:groupId/promote", (req, res) => {
  const { adminEmail, targetEmail } = req.body;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.admins.includes(adminEmail)) return res.status(403).json({ message: "Not an admin" });
  if (!group.members.includes(targetEmail)) return res.status(400).json({ message: "Not a member" });
  if (group.admins.includes(targetEmail)) return res.status(400).json({ message: "Already an admin" });
  group.admins.push(targetEmail);
  res.json({ success: true });
});

// LEAVE GROUP
app.post("/groups/:groupId/leave", (req, res) => {
  const { email } = req.body;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(400).json({ message: "Not a member" });
  if (group.createdBy === email) return res.status(400).json({ message: "Owner cannot leave. Delete the group instead." });
  group.members = group.members.filter(e => e !== email);
  group.admins  = group.admins.filter(e => e !== email);
  res.json({ success: true });
});

// GROUP FILE UPLOAD
const groupStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const groupDir = path.join(UPLOADS_DIR, "groups", req.params.groupId);
    if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
    cb(null, groupDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const groupUpload = multer({ storage: groupStorage });

app.post("/groups/:groupId/upload", groupUpload.array("files"), (req, res) => {
  const { email } = req.body;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(403).json({ message: "Not a member" });
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: "No files" });
  const names = req.files.map(f => f.filename);
  group.files.push(...names);
  res.json({ success: true, files: names });
});

// LIST GROUP FILES
app.get("/groups/:groupId/files", (req, res) => {
  const { email } = req.query;
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(403).json({ message: "Not a member" });
  res.json(group.files);
});

app.use("/group-uploads", express.static(path.join(UPLOADS_DIR, "groups")));

app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));