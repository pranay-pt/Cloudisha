require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const nodemailer = require("nodemailer");
const multer     = require("multer");
const { MongoClient } = require("mongodb");
const cloudinary = require("cloudinary").v2;
const { Readable } = require("stream");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload      = multer({ storage: multer.memoryStorage() });
const groupUpload = multer({ storage: multer.memoryStorage() });

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_PASS }
});

let db;
async function connectDB() {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  db = client.db("cloudisha");
  console.log("MongoDB connected");
}
const users  = () => db.collection("users");
const groups = () => db.collection("groups");

function generateGroupId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function uploadToCloudinary(buffer, filename, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: Date.now() + "-" + filename.replace(/\.[^/.]+$/, ""), resource_type: "auto" },
      (err, result) => { if (err) return reject(err); resolve(result); }
    );
    Readable.from(buffer).pipe(stream);
  });
}

async function deleteFromCloudinary(publicId, resourceType = "raw") {
  try { await cloudinary.uploader.destroy(publicId, { resource_type: resourceType }); }
  catch (e) { console.error("Cloudinary delete error:", e.message); }
}

// SIGNUP
app.post("/send-verification", async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) return res.status(400).send("Missing fields");
  const existing = await users().findOne({ email });
  if (existing && existing.verified) return res.status(400).send("Account already exists. Please log in.");
  const token = Math.random().toString(36).substring(2);
  await users().updateOne({ email }, { $set: { email, password, username, verified: false, token } }, { upsert: true });
  const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
  const link = `${BASE_URL}/verify?token=${token}&email=${encodeURIComponent(email)}`;
  try {
    await transporter.sendMail({
      from: `"Cloudisha" <${process.env.BREVO_USER}>`,
      to: email,
      subject: "Verify your Cloudisha email",
      html: `<h2>Email Verification</h2><p>Click to verify:</p><a href="${link}">Verify Email</a>`
    });
    res.send({ success: true });
  } catch (err) {
    console.error("EMAIL ERROR:", err);
    res.status(500).send("Email failed");
  }
});

// VERIFY
app.get("/verify", async (req, res) => {
  const { email, token } = req.query;
  const user = await users().findOne({ email });
  if (user && user.token === token) {
    await users().updateOne({ email }, { $set: { verified: true } });
    return res.send(`<h2>Email verified</h2><script>setTimeout(()=>{window.location.href="/login.html"},2000)</script>`);
  }
  res.send("Invalid or expired link");
});

// LOGIN
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await users().findOne({ email });
  if (!user)          return res.status(400).json({ message: "User not found" });
  if (!user.verified) return res.status(403).json({ message: "Verify your email first" });
  if (user.password !== password) return res.status(401).json({ message: "Wrong password" });
  res.json({ success: true, username: user.username });
});

// UPLOAD personal file
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Missing email" });
  try {
    const result = await uploadToCloudinary(req.file.buffer, req.file.originalname, "cloudisha/personal");
    const fileDoc = { publicId: result.public_id, url: result.secure_url, name: req.file.originalname, resourceType: result.resource_type, uploadedAt: new Date() };
    await users().updateOne({ email }, { $push: { files: fileDoc } });
    res.json({ success: true, file: req.file.originalname });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// LIST personal files
app.get("/files", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ message: "Missing email" });
  const user = await users().findOne({ email });
  res.json(user?.files || []);
});

// DELETE personal file
app.delete("/files/:publicId(*)", async (req, res) => {
  const { email } = req.query;
  const publicId  = req.params.publicId;
  if (!email) return res.status(400).json({ message: "Missing email" });
  const user = await users().findOne({ email });
  const file = user?.files?.find(f => f.publicId === publicId);
  if (!file) return res.status(404).json({ message: "File not found" });
  await deleteFromCloudinary(publicId, file.resourceType);
  await users().updateOne({ email }, { $pull: { files: { publicId } } });
  res.json({ success: true });
});

// CREATE GROUP
app.post("/groups/create", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ message: "Missing fields" });
  let groupId;
  do { groupId = generateGroupId(); } while (await groups().findOne({ id: groupId }));
  await groups().insertOne({ id: groupId, name, createdBy: email, admins: [email], members: [email], pendingRequests: [], files: [] });
  res.json({ success: true, groupId });
});

// MY GROUPS
app.get("/groups/mine", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ message: "Missing email" });
  res.json(await groups().find({ members: email }).toArray());
});

// GROUP INFO
app.get("/groups/:groupId", async (req, res) => {
  const { email } = req.query;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(403).json({ message: "Not a member" });
  res.json(group);
});

// REQUEST JOIN
app.post("/groups/:groupId/request", async (req, res) => {
  const { email } = req.body;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (group.members.includes(email)) return res.status(400).json({ message: "Already a member" });
  if (group.pendingRequests.includes(email)) return res.status(400).json({ message: "Request already pending" });
  await groups().updateOne({ id: req.params.groupId }, { $push: { pendingRequests: email } });
  res.json({ success: true });
});

// APPROVE
app.post("/groups/:groupId/approve", async (req, res) => {
  const { adminEmail, applicantEmail } = req.body;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.admins.includes(adminEmail)) return res.status(403).json({ message: "Not an admin" });
  if (!group.pendingRequests.includes(applicantEmail)) return res.status(400).json({ message: "No pending request" });
  await groups().updateOne({ id: req.params.groupId }, { $pull: { pendingRequests: applicantEmail }, $push: { members: applicantEmail } });
  res.json({ success: true });
});

// REJECT
app.post("/groups/:groupId/reject", async (req, res) => {
  const { adminEmail, applicantEmail } = req.body;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.admins.includes(adminEmail)) return res.status(403).json({ message: "Not an admin" });
  await groups().updateOne({ id: req.params.groupId }, { $pull: { pendingRequests: applicantEmail } });
  res.json({ success: true });
});

// PROMOTE
app.post("/groups/:groupId/promote", async (req, res) => {
  const { adminEmail, targetEmail } = req.body;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.admins.includes(adminEmail)) return res.status(403).json({ message: "Not an admin" });
  if (!group.members.includes(targetEmail)) return res.status(400).json({ message: "Not a member" });
  if (group.admins.includes(targetEmail)) return res.status(400).json({ message: "Already an admin" });
  await groups().updateOne({ id: req.params.groupId }, { $push: { admins: targetEmail } });
  res.json({ success: true });
});

// LEAVE
app.post("/groups/:groupId/leave", async (req, res) => {
  const { email } = req.body;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(400).json({ message: "Not a member" });
  if (group.createdBy === email) return res.status(400).json({ message: "Owner cannot leave. Delete the group instead." });
  await groups().updateOne({ id: req.params.groupId }, { $pull: { members: email, admins: email } });
  res.json({ success: true });
});

// GROUP FILE UPLOAD
app.post("/groups/:groupId/upload", groupUpload.array("files"), async (req, res) => {
  const { email } = req.body;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(403).json({ message: "Not a member" });
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: "No files" });
  try {
    const uploaded = await Promise.all(req.files.map(async (f) => {
      const result = await uploadToCloudinary(f.buffer, f.originalname, `cloudisha/groups/${req.params.groupId}`);
      return { publicId: result.public_id, url: result.secure_url, name: f.originalname, resourceType: result.resource_type, uploadedAt: new Date() };
    }));
    await groups().updateOne({ id: req.params.groupId }, { $push: { files: { $each: uploaded } } });
    res.json({ success: true, files: uploaded.map(f => f.name) });
  } catch (err) {
    console.error("Group upload error:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// LIST GROUP FILES
app.get("/groups/:groupId/files", async (req, res) => {
  const { email } = req.query;
  const group = await groups().findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (!group.members.includes(email)) return res.status(403).json({ message: "Not a member" });
  res.json(group.files || []);
});

connectDB().then(() => {
  app.listen(3000, () => console.log("Server running on http://localhost:3000"));
}).catch(err => {
  console.error("MongoDB connection failed:", err);
  process.exit(1);
});
