import React, { useState, useEffect, useRef } from 'react';
import { getFolders, getFiles, createFolder, deleteFolder, renameFolder, uploadFiles, deleteFile, getDownloadUrl, getPreviewUrl, batchDownload, moveFile, moveFolder, reorderFiles, searchFiles } from '../api';
import { useAuth } from '../AuthContext';
import { FaChartLine, FaDownload } from 'react-icons/fa';
import FileComments from './FileComments';
import FilePreview from './FilePreview';

const EXCEL_EXTENSIONS = new Set(['xlsx', 'xls']);

function isExcelFile(file) {
  const ext = file.original_name?.split('.').pop()?.toLowerCase();
  return EXCEL_EXTENSIONS.has(ext);
}

function FileManager({ onPlotFiles }) {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeCommentFile, setActiveCommentFile] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [activeTeam, setActiveTeam] = useState('control');
  const [dragItem, setDragItem] = useState(null); // { type: 'file'|'folder', id }
  const [dropTarget, setDropTarget] = useState(null); // folder id or 'root'
  const [fileDropTarget, setFileDropTarget] = useState(null);
  const [dropAction, setDropAction] = useState(null); // 'above' | 'below' | 'combine'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [fldRs, filRs] = await Promise.all([
        getFolders(activeTeam),
        getFiles(currentFolderId, activeTeam)
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
  }, [currentFolderId, activeTeam]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError('');
      setSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError('');

    const timer = setTimeout(async () => {
      try {
        const results = await searchFiles(query, activeTeam);
        if (!cancelled) setSearchResults(Array.isArray(results) ? results : []);
      } catch (err) {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError(err.message || '搜索失败');
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, activeTeam]);

  const handleCreateFolder = async () => {
    const name = window.prompt('请输入文件夹名称：');
    if (!name || !name.trim()) return;
    try {
      await createFolder(name, currentFolderId, activeTeam);
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
      await uploadFiles(selectedFilesLocal, currentFolderId, activeTeam);
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const uploadDroppedFiles = async (droppedFiles, targetFolderId = currentFolderId) => {
    if (!droppedFiles || droppedFiles.length === 0) return;

    setUploading(true);
    try {
      await uploadFiles(droppedFiles, targetFolderId, activeTeam);
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounterRef.current = 0;
    await uploadDroppedFiles(e.dataTransfer.files, currentFolderId);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
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

  const handlePlotFiles = (targetFiles) => {
    const excelFiles = targetFiles.filter(isExcelFile);
    if (excelFiles.length === 0) {
      alert('请选择 Excel 文件后再作图');
      return;
    }
    onPlotFiles?.(excelFiles);
    setSelectedFiles(new Set());
    setSelectMode(false);
  };

  const openFilePreview = (file) => {
    const ext = file.original_name?.split('.').pop()?.toLowerCase();
    if (ext === 'html' || ext === 'htm') {
      window.open(getPreviewUrl(file.id), '_blank');
    } else {
      setPreviewFile(file);
    }
  };

  const openSearchResultFolder = (file) => {
    setCurrentFolderId(file.folder_id || null);
    setSearchQuery('');
  };

  const handleTeamSwitch = (team) => {
    setActiveTeam(team);
    setCurrentFolderId(null);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError('');
  };

  // Internal drag-and-drop handlers
  const handleItemDragStart = (e, type, id) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
    setDragItem({ type, id });
  };

  const handleItemDragEnd = () => {
    setDragItem(null);
    setDropTarget(null);
    setFileDropTarget(null);
    setDropAction(null);
  };

  const handleFolderDragOver = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setDropTarget(folderId);
      return;
    }
    // Don't allow dropping folder onto itself
    if (dragItem && dragItem.type === 'folder' && dragItem.id === folderId) return;
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(folderId);
  };

  const handleFolderDragLeave = (e) => {
    e.preventDefault();
    setDropTarget(null);
  };

  const handleFolderDrop = async (e, targetFolderId) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    setDragItem(null);

    try {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        setDragging(false);
        dragCounterRef.current = 0;
        await uploadDroppedFiles(e.dataTransfer.files, targetFolderId);
        return;
      }

      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (!data || !data.type) return;

      if (data.type === 'folder') {
        if (data.id === targetFolderId) return;
        await moveFolder(data.id, targetFolderId);
      } else if (data.type === 'file') {
        await moveFile(data.id, targetFolderId);
      }
      fetchData();
    } catch (err) {
      if (err.message) alert(err.message);
    }
  };

  const handleFileDragOver = (e, fileId) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setFileDropTarget(fileId);
      setDropAction('below');
      return;
    }
    if (dragItem && dragItem.type === 'file' && dragItem.id === fileId) return;
    if (dragItem && dragItem.type === 'folder') return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height * 0.25) {
      setFileDropTarget(fileId);
      setDropAction('above');
    } else if (y > rect.height * 0.75) {
      setFileDropTarget(fileId);
      setDropAction('below');
    } else {
      setFileDropTarget(fileId);
      setDropAction('combine');
    }
    e.dataTransfer.dropEffect = 'move';
  };

  const handleFileDragLeave = (e) => {
    e.preventDefault();
    setFileDropTarget(null);
    setDropAction(null);
  };

  const handleFileDrop = async (e, targetFile) => {
    e.preventDefault();
    e.stopPropagation();
    setFileDropTarget(null);
    const action = dropAction;
    setDropAction(null);

    try {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        setDragging(false);
        dragCounterRef.current = 0;
        await uploadDroppedFiles(e.dataTransfer.files, currentFolderId);
        return;
      }

      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (!data || data.type !== 'file' || data.id === targetFile.id) return;

      if (action === 'combine') {
        const name = window.prompt('将文件合并至新文件夹，请输入文件夹名称：', '新文件夹');
        if (!name || !name.trim()) return;
        const newFolder = await createFolder(name, currentFolderId, activeTeam);
        await moveFile(data.id, newFolder.id);
        await moveFile(targetFile.id, newFolder.id);
        fetchData();
      } else if (action === 'above' || action === 'below') {
        const dragIndex = files.findIndex(f => f.id === data.id);
        const targetIndex = files.findIndex(f => f.id === targetFile.id);
        if (dragIndex === -1 || targetIndex === -1) return;

        const newFiles = [...files];
        const [draggedFile] = newFiles.splice(dragIndex, 1);
        
        const adjustedTargetIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex;
        const insertIndex = action === 'above' ? adjustedTargetIndex : adjustedTargetIndex + 1;
        newFiles.splice(insertIndex, 0, draggedFile);

        setFiles(newFiles); 
        const updates = newFiles.map((f, i) => ({ id: f.id, sort_order: i }));
        await reorderFiles(updates);
        fetchData();
      }
    } catch (err) {
      if (err.message) alert(err.message);
    }
  };

  // Drop on breadcrumb root
  const handleRootDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    setDragItem(null);

    try {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        setDragging(false);
        dragCounterRef.current = 0;
        await uploadDroppedFiles(e.dataTransfer.files, null);
        return;
      }

      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (!data || !data.type) return;

      if (data.type === 'folder') {
        await moveFolder(data.id, null);
      } else if (data.type === 'file') {
        await moveFile(data.id, null);
      }
      fetchData();
    } catch (err) {
      if (err.message) alert(err.message);
    }
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
  const isSearching = searchQuery.trim().length > 0;
  const activeTeamName = activeTeam === 'power' ? '动力组' : '控制组';
  const selectedExcelFiles = files.filter(file => selectedFiles.has(file.id) && isExcelFile(file));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 className="page-title" style={{ marginBottom: 0 }}>📁 文件管理</h2>
          <div className="team-switcher">
            <button className={`team-btn ${activeTeam === 'control' ? 'team-btn-active' : ''}`} onClick={() => handleTeamSwitch('control')}>控制组</button>
            <button className={`team-btn ${activeTeam === 'power' ? 'team-btn-active' : ''}`} onClick={() => handleTeamSwitch('power')}>动力组</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {files.length > 0 && !selectMode && !isSearching && (
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

      <div className="file-search-bar">
        <div className="file-search-input-wrap">
          <span className="file-search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            className="file-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`在${activeTeamName}搜索文件`}
          />
          {searchQuery && (
            <button type="button" className="file-search-clear" onClick={() => setSearchQuery('')}>
              清除
            </button>
          )}
        </div>
        {isSearching && (
          <div className="file-search-status">
            {searchLoading ? '搜索中...' : `${searchResults.length} 个结果`}
          </div>
        )}
      </div>

      {/* Batch select toolbar */}
      {selectMode && !isSearching && (
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
              onClick={() => handlePlotFiles(selectedExcelFiles)}
              disabled={selectedExcelFiles.length === 0}
              style={{ fontSize: '0.85rem' }}
              title={selectedExcelFiles.length === 0 ? '请选择 Excel 文件' : '将选中的 Excel 文件加入数据绘图'}
            >
              <FaChartLine aria-hidden="true" />
              作图 ({selectedExcelFiles.length})
            </button>
            <button
              className="btn btn-primary"
              onClick={handleBatchDownload}
              disabled={selectedFiles.size === 0 || batchDownloading}
              style={{ fontSize: '0.85rem' }}
            >
              {!batchDownloading && <FaDownload aria-hidden="true" />}
              {batchDownloading ? '打包中...' : `批量下载 (${selectedFiles.size})`}
            </button>
            <button className="btn btn-ghost" onClick={exitSelectMode} style={{ fontSize: '0.85rem' }}>
              取消
            </button>
          </div>
        </div>
      )}

      {isSearching && (
        <div className="file-search-results team-content-transition">
          {searchError && (
            <div className="preview-error">{searchError}</div>
          )}
          {!searchError && searchLoading && (
            <div className="file-search-empty">正在搜索...</div>
          )}
          {!searchError && !searchLoading && searchResults.length === 0 && (
            <div className="file-search-empty">没有找到匹配的文件</div>
          )}
          {!searchError && !searchLoading && searchResults.map(file => (
            <div key={`search-file-${file.id}`} className="file-item file-search-result">
              <div className="file-icon">📄</div>
              <div className="file-details">
                <div className="file-name" onClick={() => openFilePreview(file)}>
                  {file.original_name}
                </div>
                <div className="file-meta">
                  {(file.size / 1024).toFixed(2)} KB · 上传者 {file.uploader_name || '未知'} · {new Date(file.created_at).toLocaleDateString()} · {file.comment_count} 条记录
                </div>
                <div className="file-search-path">{file.folder_path || '根目录'}</div>
              </div>
              <div className="file-actions">
                <button className="btn btn-ghost" onClick={() => openSearchResultFolder(file)}>定位</button>
                <button className="btn btn-ghost" onClick={() => openFilePreview(file)}>预览</button>
                <a className="btn btn-ghost" href={getDownloadUrl(file.id)} download={file.original_name}>下载</a>
                {isExcelFile(file) && (
                  <button className="btn btn-ghost" onClick={() => handlePlotFiles([file])} title="加入数据绘图">
                    <FaChartLine aria-hidden="true" />
                    作图
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => setActiveCommentFile(file)}>记录</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isSearching && (
      <div className="team-content-transition" key={activeTeam}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', fontSize: '1.1rem', alignItems: 'center' }}>
        <span 
          style={{ cursor: 'pointer', color: currentFolderId === null ? 'var(--text-color)' : 'var(--primary-color)', padding: '2px 6px', borderRadius: '4px', border: dropTarget === 'root' ? '2px dashed var(--primary-color)' : '2px solid transparent', transition: 'all 0.2s' }}
          onClick={() => setCurrentFolderId(null)}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget('root'); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={handleRootDrop}
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
        <div
          className="file-list"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{ position: 'relative' }}
        >
          {dragging && (
            <div className="drag-overlay">
              <div className="drag-overlay-content">
                <div style={{ fontSize: '3rem' }}>📂</div>
                <div>松开鼠标上传文件</div>
              </div>
            </div>
          )}
          {subFolders.length === 0 && files.length === 0 && !dragging && (
            <div className="dropzone" onClick={() => fileInputRef.current?.click()}>
              <div style={{ fontSize: '3rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>📁</div>
              <div style={{ color: 'var(--text-muted)' }}>此文件夹为空。点击或拖拽上传文件。</div>
            </div>
          )}

          {subFolders.map(folder => (
            <div
              key={`folder-${folder.id}`}
              className={`file-item ${dropTarget === folder.id ? 'file-item-drop-target' : ''} ${dragItem && dragItem.type === 'folder' && dragItem.id === folder.id ? 'file-item-dragging' : ''}`}
              draggable
              onDragStart={(e) => handleItemDragStart(e, 'folder', folder.id)}
              onDragEnd={handleItemDragEnd}
              onDragOver={(e) => handleFolderDragOver(e, folder.id)}
              onDragLeave={handleFolderDragLeave}
              onDrop={(e) => handleFolderDrop(e, folder.id)}
            >
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
              className={`file-item ${selectMode && selectedFiles.has(file.id) ? 'file-item-selected' : ''} ${dragItem && dragItem.type === 'file' && dragItem.id === file.id ? 'file-item-dragging' : ''}`}
              onClick={selectMode ? () => toggleFileSelection(file.id) : undefined}
              style={{
                ...(selectMode ? { cursor: 'pointer' } : {}),
                ...(fileDropTarget === file.id && dropAction === 'above' ? { boxShadow: '0 -2px 0 var(--primary-color)' } : {}),
                ...(fileDropTarget === file.id && dropAction === 'below' ? { boxShadow: '0 2px 0 var(--primary-color)' } : {}),
                ...(fileDropTarget === file.id && dropAction === 'combine' ? { backgroundColor: 'var(--glass-bg-hover)', boxShadow: 'inset 0 0 0 2px var(--primary-color)' } : {})
              }}
              draggable={!selectMode}
              onDragStart={!selectMode ? (e) => handleItemDragStart(e, 'file', file.id) : undefined}
              onDragEnd={handleItemDragEnd}
              onDragOver={!selectMode ? (e) => handleFileDragOver(e, file.id) : undefined}
              onDragLeave={!selectMode ? handleFileDragLeave : undefined}
              onDrop={!selectMode ? (e) => handleFileDrop(e, file) : undefined}
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
                <div className="file-name" onClick={selectMode ? undefined : () => {
                  const ext = file.original_name?.split('.').pop()?.toLowerCase();
                  if (ext === 'html' || ext === 'htm') {
                    window.open(getPreviewUrl(file.id), '_blank');
                  } else {
                    setPreviewFile(file);
                  }
                }}>
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
                  <button className="btn btn-ghost" onClick={() => {
                    const ext = file.original_name?.split('.').pop()?.toLowerCase();
                    if (ext === 'html' || ext === 'htm') {
                      window.open(getPreviewUrl(file.id), '_blank');
                    } else {
                      setPreviewFile(file);
                    }
                  }}>预览</button>
                  <a className="btn btn-ghost" href={getDownloadUrl(file.id)} download={file.original_name}>下载</a>
                  {isExcelFile(file) && (
                    <button className="btn btn-ghost" onClick={() => handlePlotFiles([file])} title="加入数据绘图">
                      <FaChartLine aria-hidden="true" />
                      作图
                    </button>
                  )}
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
      </div>
      )}

      {previewFile && (
        <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
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
