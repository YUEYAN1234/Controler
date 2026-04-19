import React, { useState, useEffect, useRef } from 'react';
import { getFolders, getFiles, createFolder, deleteFolder, renameFolder, uploadFiles, deleteFile, getDownloadUrl, getPreviewUrl, batchDownload } from '../api';
import { useAuth } from '../AuthContext';
import FileComments from './FileComments';

function FileManager() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeCommentFile, setActiveCommentFile] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [fldRs, filRs] = await Promise.all([
        getFolders(),
        getFiles(currentFolderId)
      ]);
      setFolders(fldRs);
      setFiles(filRs);
    } catch (err) {
      console.error(err);
      alert('获取文件失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Exit select mode when navigating folders
    setSelectedFiles(new Set());
    setSelectMode(false);
  }, [currentFolderId]);

  const handleCreateFolder = async () => {
    const name = window.prompt('请输入文件夹名称：');
    if (!name || !name.trim()) return;
    try {
      await createFolder(name, currentFolderId);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRenameFolder = async (id, oldName) => {
    const name = window.prompt('请输入新名称：', oldName);
    if (!name || !name.trim() || name === oldName) return;
    try {
      await renameFolder(id, name);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteFolder = async (id) => {
    if (!window.confirm('确定删除此文件夹及内部所有内容？')) return;
    try {
      await deleteFolder(id);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleFileUpload = async (e) => {
    const selectedFilesLocal = e.target.files;
    if (!selectedFilesLocal || selectedFilesLocal.length === 0) return;
    
    setUploading(true);
    try {
      await uploadFiles(selectedFilesLocal, currentFolderId);
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteFile = async (id) => {
    if (!window.confirm('确定删除此文件？')) return;
    try {
      await deleteFile(id);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleFileSelection = (fileId) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.id)));
    }
  };

  const handleBatchDownload = async () => {
    if (selectedFiles.size === 0) return;
    setBatchDownloading(true);
    try {
      await batchDownload([...selectedFiles]);
    } catch (err) {
      alert(err.message);
    } finally {
      setBatchDownloading(false);
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedFiles(new Set());
  };

  const getBreadcrumbs = () => {
    const crumbs = [];
    let curr = currentFolderId;
    while (curr) {
      const f = folders.find(x => x.id === curr);
      if (f) {
        crumbs.unshift(f);
        curr = f.parent_id;
      } else {
        break;
      }
    }
    return crumbs;
  };

  const subFolders = folders.filter(f => f.parent_id === currentFolderId);
  const breadcrumbs = getBreadcrumbs();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 className="page-title">📁 文件管理</h2>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {files.length > 0 && !selectMode && (
            <button className="btn btn-ghost" onClick={() => setSelectMode(true)} style={{ border: '1px solid var(--glass-border)' }}>
              ☑ 批量操作
            </button>
          )}
          <button className="btn btn-ghost" onClick={handleCreateFolder} style={{ border: '1px solid var(--glass-border)' }}>
            + 新建文件夹
          </button>
          <input 
            type="file" 
            multiple 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            style={{ display: 'none' }} 
          />
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? '上传中...' : '上传数据文件'}
          </button>
        </div>
      </div>

      {/* Batch select toolbar */}
      {selectMode && (
        <div className="batch-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={files.length > 0 && selectedFiles.size === files.length}
                onChange={toggleSelectAll}
                className="batch-checkbox"
              />
              全选
            </label>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              已选 <span style={{ color: 'var(--primary-color)', fontWeight: 600 }}>{selectedFiles.size}</span> / {files.length} 个文件
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="btn btn-primary"
              onClick={handleBatchDownload}
              disabled={selectedFiles.size === 0 || batchDownloading}
              style={{ fontSize: '0.85rem' }}
            >
              {batchDownloading ? '打包中...' : `📦 批量下载 (${selectedFiles.size})`}
            </button>
            <button className="btn btn-ghost" onClick={exitSelectMode} style={{ fontSize: '0.85rem' }}>
              取消
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', fontSize: '1.1rem', alignItems: 'center' }}>
        <span 
          style={{ cursor: 'pointer', color: currentFolderId === null ? 'var(--text-color)' : 'var(--primary-color)' }}
          onClick={() => setCurrentFolderId(null)}
        >
          根目录
        </span>
        {breadcrumbs.map(f => (
          <React.Fragment key={f.id}>
            <span style={{ color: 'var(--text-muted)' }}>/</span>
            <span 
              style={{ cursor: 'pointer', color: f.id === currentFolderId ? 'var(--text-color)' : 'var(--primary-color)' }}
              onClick={() => setCurrentFolderId(f.id)}
            >
              {f.name}
            </span>
          </React.Fragment>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>加载中...</div>
      ) : (
        <div className="file-list">
          {subFolders.length === 0 && files.length === 0 && (
            <div className="dropzone" onClick={() => fileInputRef.current?.click()}>
              <div style={{ fontSize: '3rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>📁</div>
              <div style={{ color: 'var(--text-muted)' }}>此文件夹为空。点击上传文件。</div>
            </div>
          )}

          {subFolders.map(folder => (
            <div key={`folder-${folder.id}`} className="file-item">
              <div className="file-icon">📁</div>
              <div className="file-details">
                <div className="file-name" onClick={() => setCurrentFolderId(folder.id)}>
                  {folder.name}
                </div>
                <div className="file-meta">
                  由 {folder.creator_name} 创建 · {new Date(folder.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="file-actions">
                <button className="btn btn-ghost" onClick={() => handleRenameFolder(folder.id, folder.name)}>重命名</button>
                {(user.role === 'admin' || user.id === folder.created_by) && (
                  <button className="btn btn-danger" onClick={() => handleDeleteFolder(folder.id)}>删除</button>
                )}
              </div>
            </div>
          ))}

          {files.map(file => (
            <div
              key={`file-${file.id}`}
              className={`file-item ${selectMode && selectedFiles.has(file.id) ? 'file-item-selected' : ''}`}
              onClick={selectMode ? () => toggleFileSelection(file.id) : undefined}
              style={selectMode ? { cursor: 'pointer' } : undefined}
            >
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.id)}
                  onChange={() => toggleFileSelection(file.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="batch-checkbox"
                  style={{ marginRight: '0.75rem' }}
                />
              )}
              <div className="file-icon">📄</div>
              <div className="file-details">
                <div className="file-name" onClick={selectMode ? undefined : () => window.open(getPreviewUrl(file.id), '_blank')}>
                  {file.original_name}
                </div>
                <div className="file-meta">
                  {(file.size / 1024).toFixed(2)} KB · 
                  上传者: {file.uploader_name} · 
                  {new Date(file.created_at).toLocaleDateString()} · 
                  <span style={{ color: 'var(--primary-color)', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setActiveCommentFile(file); }}>
                    {file.comment_count} 条注释记录
                  </span>
                </div>
              </div>
              {!selectMode && (
                <div className="file-actions">
                  <a className="btn btn-ghost" href={getDownloadUrl(file.id)} download={file.original_name}>下载</a>
                  <button className="btn btn-ghost" onClick={() => setActiveCommentFile(file)}>记录</button>
                  {(user.role === 'admin' || user.id === file.uploaded_by) && (
                    <button className="btn btn-danger" onClick={() => handleDeleteFile(file.id)}>删除</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeCommentFile && (
        <FileComments file={activeCommentFile} onClose={() => {
          const scrollY = document.querySelector('.main-content')?.scrollTop || window.scrollY;
          setActiveCommentFile(null);
          fetchData().then(() => {
            requestAnimationFrame(() => {
              const el = document.querySelector('.main-content');
              if (el) el.scrollTop = scrollY;
              else window.scrollTo(0, scrollY);
            });
          });
        }} />
      )}
    </div>
  );
}

export default FileManager;
