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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// Auth
export const login = (username, password) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

export const register = (username, password, displayName, inviteCode) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, displayName, inviteCode }) });

export const getMe = () => request('/auth/me');

// Folders
export const getFolders = () => request('/folders');
export const createFolder = (name, parentId) =>
  request('/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) });
export const renameFolder = (id, name) =>
  request(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
export const deleteFolder = (id) =>
  request(`/folders/${id}`, { method: 'DELETE' });

// Files
export const getFiles = (folderId) =>
  request(`/files${folderId ? `?folderId=${folderId}` : ''}`);

export const uploadFiles = (files, folderId) => {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  if (folderId) fd.append('folderId', folderId);
  return request('/files/upload', { method: 'POST', body: fd });
};

export const deleteFile = (id) => request(`/files/${id}`, { method: 'DELETE' });
export const moveFile = (id, folderId) =>
  request(`/files/${id}/move`, { method: 'PUT', body: JSON.stringify({ folderId }) });

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
