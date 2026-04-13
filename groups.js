// groups.js — all group UI logic

const email = sessionStorage.getItem("email");
if (!email) window.location.href = "login.html";

let activeGroupId = null;

// ==========================
// LOAD MY GROUPS (sidebar)
// ==========================
async function loadMyGroups() {
  const res = await fetch(`${API}/groups/mine?email=${encodeURIComponent(email)}`);
  const groups = await res.json();
  const list = document.getElementById("groupList");

  if (!groups.length) {
    list.innerHTML = `<p style="color:#aaa;font-size:13px;">No groups yet.</p>`;
    return;
  }

  list.innerHTML = groups.map(g => {
    const isAdmin = g.admins.includes(email);
    const pendingBadge = isAdmin && g.pendingRequests.length
      ? `<span style="background:#e53935;color:white;border-radius:10px;padding:1px 7px;font-size:11px;float:right;">${g.pendingRequests.length}</span>`
      : "";
    return `
      <div class="group-item ${g.id === activeGroupId ? 'active' : ''}" onclick="openGroup('${g.id}')">
        <div class="gname">
          ${g.name}
          ${isAdmin ? `<span class="gadmin-badge">Admin</span>` : ""}
          ${pendingBadge}
        </div>
        <div class="gid">ID: ${g.id}</div>
      </div>`;
  }).join("");
}

// ==========================
// OPEN A GROUP
// ==========================
window.openGroup = async function (groupId) {
  activeGroupId = groupId;
  loadMyGroups(); // refresh sidebar active state

  const res = await fetch(`${API}/groups/${groupId}?email=${encodeURIComponent(email)}`);
  if (!res.ok) { alert("Could not load group"); return; }
  const group = await res.json();

  const isAdmin = group.admins.includes(email);
  const isOwner = group.createdBy === email;
  const main = document.getElementById("groupMain");

  main.innerHTML = `
    <!-- HEADER -->
    <div class="group-header">
      <div>
        <h2>${group.name}</h2>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span class="group-id-tag" title="Click to copy" onclick="copyGroupId('${group.id}')">
            🔑 ${group.id}
          </span>
          <span class="header-meta">${group.members.length} member${group.members.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      ${!isOwner ? `<button class="btn-leave" onclick="leaveGroup('${group.id}')">🚪 Leave</button>` : ""}
    </div>

    <!-- PENDING REQUESTS (admin only) -->
    ${isAdmin ? `
    <div class="section-card" id="pendingSection">
      <h3>🙋 Join Requests ${group.pendingRequests.length ? `<span style="color:#e53935;">(${group.pendingRequests.length})</span>` : ""}</h3>
      <div id="pendingList">${renderPending(group, groupId)}</div>
    </div>` : ""}

    <!-- MEMBERS -->
    <div class="section-card">
      <h3>👥 Members</h3>
      <div id="memberList">${renderMembers(group, isAdmin, isOwner)}</div>
    </div>

    <!-- UPLOAD -->
    <div class="section-card">
      <h3>📤 Upload to Group</h3>
      <div class="upload-row">
        <input type="file" id="groupFileInput" multiple />
        <button class="btn-upload" onclick="uploadGroupFiles('${groupId}')">Upload</button>
      </div>
    </div>

    <!-- FILES -->
    <div class="section-card">
      <h3>📁 Shared Files</h3>
      <div id="groupFileList"><p style="color:#aaa;">Loading...</p></div>
    </div>
  `;

  loadGroupFiles(groupId);
};

function renderPending(group, groupId) {
  if (!group.pendingRequests.length) return `<p style="color:#aaa;font-size:13px;">No pending requests.</p>`;
  return group.pendingRequests.map(req => `
    <div class="request-item">
      <span class="req-email">📧 ${req}</span>
      <div class="request-actions">
        <button class="btn-approve" onclick="approveRequest('${groupId}','${req}')">✅ Approve</button>
        <button class="btn-reject"  onclick="rejectRequest('${groupId}','${req}')">❌ Reject</button>
      </div>
    </div>`).join("");
}

function renderMembers(group, isAdmin, isOwner) {
  return group.members.map(m => {
    const isMemberAdmin = group.admins.includes(m);
    const canPromote = isAdmin && !isMemberAdmin && m !== email;
    return `
      <div class="member-item">
        <div class="member-info">
          ${isMemberAdmin ? `<span class="admin-crown">👑</span>` : `<span>👤</span>`}
          <span>${m}</span>
          ${m === group.createdBy ? `<span style="font-size:11px;color:#888;">(owner)</span>` : ""}
        </div>
        ${canPromote
          ? `<button class="btn-promote" onclick="promoteToAdmin('${group.id}','${m}')">Make Admin</button>`
          : ""}
      </div>`;
  }).join("");
}

// ==========================
// LOAD GROUP FILES
// ==========================
async function loadGroupFiles(groupId) {
  const container = document.getElementById("groupFileList");
  if (!container) return;

  try {
    const res = await fetch(`${API}/groups/${groupId}/files?email=${encodeURIComponent(email)}`);
    const files = await res.json();

    if (!files.length) {
      container.innerHTML = `<p style="color:#aaa;">No files uploaded yet.</p>`;
      return;
    }

    container.innerHTML = `<div class="group-files-grid">${files.map(f => {
      const ext = f.name.split(".").pop().toLowerCase();
      const isImage = ["jpg","jpeg","png","gif","webp","svg"].includes(ext);
      const preview = isImage
        ? `<div class="preview"><img src="${f.url}" alt="${f.name}"/></div>`
        : `<div class="preview" style="font-size:36px">${fileIcon(ext)}</div>`;
      return `
        <div class="file-card">
          ${preview}
          <div class="file-info">
            <a href="${f.url}" target="_blank">${f.name}</a><br/>
            <small>${ext.toUpperCase()}</small>
          </div>
          <div class="actions">
            <button onclick="window.open('${f.url}')">⬇️ Download</button>
          </div>
        </div>`;
    }).join("")}</div>`;

  } catch (err) {
    container.innerHTML = `<p style="color:red;">Failed to load files.</p>`;
  }
}

// ==========================
// UPLOAD GROUP FILES
// ==========================
window.uploadGroupFiles = async function (groupId) {
  const input = document.getElementById("groupFileInput");
  const files = Array.from(input.files);
  if (!files.length) { alert("Select files first"); return; }

  const formData = new FormData();
  files.forEach(f => formData.append("files", f));
  formData.append("email", email);

  try {
    const res = await fetch(`${API}/groups/${groupId}/upload`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    alert(`✅ ${data.files.length} file${data.files.length > 1 ? "s" : ""} uploaded!`);
    input.value = "";
    loadGroupFiles(groupId);
  } catch (err) {
    alert(err.message);
  }
};

// ==========================
// CREATE GROUP
// ==========================
window.createGroup = async function () {
  const name = document.getElementById("newGroupName").value.trim();
  if (!name) { alert("Enter a group name"); return; }

  try {
    const res = await fetch(`${API}/groups/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text); }
    if (!res.ok) throw new Error(data.message || "Server error");
    closeModal("createModal");
    document.getElementById("newGroupName").value = "";
    alert(`✅ Group created!\nShare this ID with others: ${data.groupId}`);
    await loadMyGroups();
    openGroup(data.groupId);
  } catch (err) {
    alert(err.message);
  }
};

// ==========================
// JOIN GROUP
// ==========================
window.requestJoin = async function () {
  const groupId = document.getElementById("joinGroupId").value.trim().toUpperCase();
  if (!groupId) { alert("Enter a Group ID"); return; }

  try {
    const res = await fetch(`${API}/groups/${groupId}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text); }
    if (!res.ok) throw new Error(data.message || "Server error");
    closeModal("joinModal");
    document.getElementById("joinGroupId").value = "";
    alert("✅ Join request sent! Wait for an admin to approve.");
  } catch (err) {
    alert(err.message);
  }
};

// ==========================
// APPROVE / REJECT
// ==========================
window.approveRequest = async function (groupId, applicantEmail) {
  try {
    const res = await fetch(`${API}/groups/${groupId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: email, applicantEmail })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    await loadMyGroups();
    openGroup(groupId);
  } catch (err) { alert(err.message); }
};

window.rejectRequest = async function (groupId, applicantEmail) {
  try {
    const res = await fetch(`${API}/groups/${groupId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: email, applicantEmail })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    await loadMyGroups();
    openGroup(groupId);
  } catch (err) { alert(err.message); }
};

// ==========================
// PROMOTE TO ADMIN
// ==========================
window.promoteToAdmin = async function (groupId, targetEmail) {
  if (!confirm(`Make ${targetEmail} an admin?`)) return;
  try {
    const res = await fetch(`${API}/groups/${groupId}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: email, targetEmail })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    openGroup(groupId);
  } catch (err) { alert(err.message); }
};

// ==========================
// LEAVE GROUP
// ==========================
window.leaveGroup = async function (groupId) {
  if (!confirm("Leave this group?")) return;
  try {
    const res = await fetch(`${API}/groups/${groupId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    activeGroupId = null;
    document.getElementById("groupMain").innerHTML = `<div class="placeholder">👈 Select a group or create one to get started</div>`;
    loadMyGroups();
  } catch (err) { alert(err.message); }
};

// ==========================
// COPY GROUP ID
// ==========================
window.copyGroupId = function (id) {
  navigator.clipboard.writeText(id).then(() => alert(`📋 Group ID "${id}" copied!`));
};

// ==========================
// MODAL HELPERS
// ==========================
window.openCreateModal = () => document.getElementById("createModal").classList.add("show");
window.openJoinModal   = () => document.getElementById("joinModal").classList.add("show");
window.closeModal = (id) => document.getElementById(id).classList.remove("show");

// Close modal on backdrop click
document.querySelectorAll(".modal-backdrop").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m) m.classList.remove("show"); });
});

// Init
loadMyGroups();