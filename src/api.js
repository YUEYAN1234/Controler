const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

export function clearToken() {
  localStorage.removeItem('token');
}

export function getStoredUser() {
  const u = localStorage.getItem('user');
  return u ? JSON.parse(u) : null;
}

export function setStoredUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem('user');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    clearToken();
    clearStoredUser();
    window.location.reload();
    throw new Error('认证失败');
  }

  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(res.ok ? '服务器返回了无效响应' : raw);
    }
  }

  if (!res.ok) throw new Error(data?.error || raw || '请求失败');
  return data;
}

// Auth
export const login = (username, password) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

export const register = (username, password, displayName, inviteCode) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, displayName, inviteCode }) });

export const getMe = () => request('/auth/me');

export const changePassword = (oldPassword, newPassword) =>
  request('/auth/change-password', { method: 'PUT', body: JSON.stringify({ oldPassword, newPassword }) });

// Folders
export const getFolders = (team) => request(`/folders?team=${team || 'control'}`);
export const createFolder = (name, parentId, team) =>
  request('/folders', { method: 'POST', body: JSON.stringify({ name, parentId, team }) });
export const renameFolder = (id, name) =>
  request(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
export const deleteFolder = (id) =>
  request(`/folders/${id}`, { method: 'DELETE' });

// Files
export const getFiles = (folderId, team) =>
  request(`/files?${folderId ? `folderId=${folderId}&` : ''}team=${team || 'control'}`);
export const searchFiles = (query, team) =>
  request(`/files/search?q=${encodeURIComponent(query)}&team=${team || 'control'}`);

export const uploadFiles = (files, folderId, team) => {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  if (folderId) fd.append('folderId', folderId);
  fd.append('team', team || 'control');
  return request('/files/upload', { method: 'POST', body: fd });
};

export const deleteFile = (id) => request(`/files/${id}`, { method: 'DELETE' });
export const moveFile = (id, targetFolderId) =>
  request(`/files/${id}/move`, { method: 'PATCH', body: JSON.stringify({ targetFolderId }) });
export const moveFolder = (id, targetFolderId) =>
  request(`/folders/${id}/move`, { method: 'PATCH', body: JSON.stringify({ targetFolderId }) });
export const reorderFiles = (updates) =>
  request('/files/reorder', { method: 'POST', body: JSON.stringify({ updates }) });

export const getDownloadUrl = (id) => `${API_BASE}/files/${id}/download?token=${getToken()}`;
export const getPreviewUrl = (id) => `${API_BASE}/files/${id}/preview?token=${getToken()}`;

export const batchDownload = async (fileIds) => {
  const token = getToken();
  const res = await fetch(`${API_BASE}/files/batch-download`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fileIds })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '下载失败' }));
    throw new Error(err.error || '下载失败');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'batch-download.zip';
  a.click();
  URL.revokeObjectURL(url);
};

// Comments
export const getComments = (fileId) => request(`/comments/${fileId}`);
export const addComment = (fileId, content) =>
  request(`/comments/${fileId}`, { method: 'POST', body: JSON.stringify({ content }) });
export const deleteComment = (id) => request(`/comments/${id}`, { method: 'DELETE' });

// Announcements
export const getAnnouncements = () => request('/announcements');
export const createAnnouncement = (title, content, pinned, attachmentFileId) =>
  request('/announcements', { method: 'POST', body: JSON.stringify({ title, content, pinned, attachmentFileId }) });
export const updateAnnouncement = (id, title, content, pinned, attachmentFileId) =>
  request(`/announcements/${id}`, { method: 'PUT', body: JSON.stringify({ title, content, pinned, attachmentFileId }) });
export const deleteAnnouncement = (id) =>
  request(`/announcements/${id}`, { method: 'DELETE' });

// Messages
export const getMessages = () => request('/messages');
export const postMessage = (content) =>
  request('/messages', { method: 'POST', body: JSON.stringify({ content }) });
export const deleteMessage = (id) => request(`/messages/${id}`, { method: 'DELETE' });
export const getReplies = (messageId) => request(`/messages/${messageId}/replies`);
export const postReply = (messageId, content) =>
  request(`/messages/${messageId}/replies`, { method: 'POST', body: JSON.stringify({ content }) });
export const deleteReply = (id) => request(`/messages/replies/${id}`, { method: 'DELETE' });

// Games
export const submitGameScore = (game, score) =>
  request('/games/scores', { method: 'POST', body: JSON.stringify({ game, score }) });
export const getLeaderboard = (game) => request(`/games/leaderboard/${game}`);
export const getMyBestScore = (game) => request(`/games/my-best/${game}`);

// Reservations
export const getReservations = (month, team) => request(`/reservations?month=${month}&team=${team || 'control'}`);
export const createReservation = (data) =>
  request('/reservations', { method: 'POST', body: JSON.stringify(data) });
export const updateReservation = (id, data) =>
  request(`/reservations/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteReservation = (id) => request(`/reservations/${id}`, { method: 'DELETE' });

// Chat
export const sendChatMessage = (messages, team, sessionId, attachments = []) => {
  const payload = { messages, team, sessionId };
  if (attachments && attachments.length > 0) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    for (const file of attachments) fd.append('attachments', file);
    return request('/chat', { method: 'POST', body: fd });
  }
  return request('/chat', { method: 'POST', body: JSON.stringify(payload) });
};

export const streamChatMessage = async (messages, team, sessionId, attachments = [], { signal, onEvent } = {}) => {
  const token = getToken();
  const payload = { messages, team, sessionId };
  let body;
  const headers = {};

  if (token) headers['Authorization'] = `Bearer ${token}`;

  if (attachments && attachments.length > 0) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    for (const file of attachments) fd.append('attachments', file);
    body = fd;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers,
    body,
    signal
  });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    clearStoredUser();
    window.location.reload();
    throw new Error('认证失败');
  }

  if (!res.ok) {
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!data && /Cannot POST \/api\/chat\/stream/i.test(raw)) {
      throw new Error('流式聊天接口还没有在后端生效，请重启后端服务后再试');
    }
    if (!data && /^\s*</.test(raw)) {
      throw new Error('服务器返回了异常页面，请确认后端服务已更新并正常运行');
    }
    throw new Error(data?.error || raw || '请求失败');
  }

  if (!res.body) throw new Error('当前浏览器不支持流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;

  const emitBlock = (block) => {
    let event = 'message';
    const dataLines = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;
    const data = JSON.parse(dataLines.join('\n'));
    if (event === 'error') throw new Error(data.error || '请求失败');
    if (event === 'done') donePayload = data;
    onEvent?.({ type: event, data });
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) emitBlock(block);
  }

  if (buffer.trim()) emitBlock(buffer);
  return donePayload;
};
export const getChatSessions = () => request('/chat/sessions');
export const getChatSession = (id) => request(`/chat/sessions/${id}`);
