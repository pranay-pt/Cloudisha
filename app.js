// Use same origin always — works on localhost AND on Railway/any deployment
const API = "";

// ==========================
// 🔐 SIGNUP
// ==========================
window.signup = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const username = prompt("Enter a username for your account:");

  if (!email || !password || !username) {
    alert("Fill all fields");
    return;
  }

  try {
    const res = await fetch(`${API}/send-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, username })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }

    alert("📧 Verification email sent! Check your inbox");

  } catch (err) {
    console.error(err);
    alert("Error: " + err.message);
  }
};

// ==========================
// 🔐 LOGIN
// ==========================
window.login = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("Enter email & password");
    return;
  }

  try {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text);
    }

    // ✅ FIXED: was duplicated — only check once
    if (!res.ok) {
      throw new Error(data.message || data || "Login failed");
    }

    // Save username in session
    sessionStorage.setItem("username", data.username);
    sessionStorage.setItem("email", email);

    window.location.href = "dashboard.html";

  } catch (err) {
    console.error(err);
    alert(err.message);
  }
};

// ==========================
// 🚪 LOGOUT
// ==========================
// ✅ FIXED: was missing entirely — dashboard logout button had no handler
window.logout = function () {
  sessionStorage.clear();
  window.location.href = "login.html";
};

// ==========================
// 🎨 THEME TOGGLE
// ==========================
const themes = ["light", "dark", "system"];
let currentTheme = localStorage.getItem("theme") || "light";

applyTheme(currentTheme);

// ✅ FIXED: moved themeBtn lookup inside DOMContentLoaded so it works on
//    both pages (login.html has no #themeToggle, dashboard.html does)
document.addEventListener("DOMContentLoaded", () => {
  const themeBtn = document.getElementById("themeToggle");
  updateButton(themeBtn);

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      let index = themes.indexOf(currentTheme);
      currentTheme = themes[(index + 1) % themes.length];
      localStorage.setItem("theme", currentTheme);
      applyTheme(currentTheme);
      updateButton(themeBtn);
    });
  }

  // Load files only on dashboard page
  if (document.getElementById("fileList")) {
    loadFiles();

    // Wire up search & filter
    document.getElementById("searchInput").addEventListener("input", loadFiles);
    document.getElementById("typeFilter").addEventListener("change", loadFiles);
  }
});

function applyTheme(theme) {
  document.body.classList.remove("light", "dark");
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.body.classList.add(isDark ? "dark" : "light");
  } else {
    document.body.classList.add(theme);
  }
}

function updateButton(btn) {
  if (!btn) return;
  if (currentTheme === "light") btn.innerText = "🌞";
  else if (currentTheme === "dark") btn.innerText = "🌙";
  else btn.innerText = "💻";
}

// ==========================
// 📤 UPLOAD
// ==========================
window.upload = async function () {
  const fileInput = document.getElementById("fileInput");
  const files = Array.from(fileInput.files);

  if (files.length === 0) {
    alert("Select at least one file");
    return;
  }

  let uploaded = 0;
  let failed = 0;

  // Upload all files in parallel
  await Promise.all(files.map(async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/upload`, {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      uploaded++;
    } catch (err) {
      console.error("Failed to upload", file.name, err);
      failed++;
    }
  }));

  if (failed === 0) {
    alert(`✅ ${uploaded} file${uploaded > 1 ? "s" : ""} uploaded!`);
  } else {
    alert(`⚠️ ${uploaded} uploaded, ${failed} failed.`);
  }

  fileInput.value = "";
  loadFiles();
};

// ==========================
// 📁 LOAD & DISPLAY FILES
// ==========================
// ✅ FIXED: was missing entirely — dashboard showed an empty grid forever
async function loadFiles() {
  const searchVal = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const typeVal = document.getElementById("typeFilter")?.value || "all";
  const container = document.getElementById("fileList");
  if (!container) return;

  try {
    const res = await fetch(`${API}/files`);
    const files = await res.json();

    const filtered = files.filter(name => {
      const matchSearch = name.toLowerCase().includes(searchVal);
      const ext = name.split(".").pop().toLowerCase();

      let matchType = true;
      if (typeVal === "image") matchType = ["jpg","jpeg","png","gif","webp","svg"].includes(ext);
      else if (typeVal === "pdf") matchType = ext === "pdf";
      else if (typeVal === "audio") matchType = ["mp3","wav","ogg","m4a"].includes(ext);
      else if (typeVal === "other") matchType = !["jpg","jpeg","png","gif","webp","svg","pdf","mp3","wav","ogg","m4a"].includes(ext);

      return matchSearch && matchType;
    });

    if (filtered.length === 0) {
      container.innerHTML = "<p style='padding:20px;color:#999;'>No files found.</p>";
      return;
    }

    container.innerHTML = filtered.map(name => {
      const url = `${API}/uploads/${name}`;
      const ext = name.split(".").pop().toLowerCase();
      const isImage = ["jpg","jpeg","png","gif","webp","svg"].includes(ext);

      const preview = isImage
        ? `<div class="preview"><img src="${url}" alt="${name}" /></div>`
        : `<div class="preview" style="font-size:36px">${fileIcon(ext)}</div>`;

      return `
        <div class="file-card">
          ${preview}
          <div class="file-info">
            <a href="${url}" target="_blank">${name}</a><br/>
            <small>${ext.toUpperCase()}</small>
          </div>
          <div class="actions">
            <button onclick="window.open('${url}')">⬇️ Download</button>
            <button onclick="deleteFile('${name}')">🗑️ Delete</button>
          </div>
        </div>`;
    }).join("");

  } catch (err) {
    console.error(err);
    container.innerHTML = "<p style='color:red;padding:20px;'>Failed to load files.</p>";
  }
}

function fileIcon(ext) {
  if (ext === "pdf") return "📄";
  if (["mp3","wav","ogg","m4a"].includes(ext)) return "🎵";
  if (["mp4","mov","avi"].includes(ext)) return "🎬";
  if (["zip","rar","7z"].includes(ext)) return "🗜️";
  return "📁";
}

// ==========================
// 🗑️ DELETE FILE
// ==========================
window.deleteFile = async function (name) {
  if (!confirm(`Delete "${name}"?`)) return;

  try {
    const res = await fetch(`${API}/files/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Delete failed");
    loadFiles();
  } catch (err) {
    alert(err.message);
  }
};