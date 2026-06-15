import React, { useState, useEffect, useRef } from 'react';
import { getAnnouncements, createAnnouncement, deleteAnnouncement, updateAnnouncement, uploadFiles, getDownloadUrl } from '../api';
import { useAuth } from '../AuthContext';

function Announcements() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ title: '', content: '', pinned: false, attachmentFileId: null, attachmentName: '' });
  const [editingId, setEditingId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const { user } = useAuth();

  const fetchAnnouncements = async () => {
    try {
      const data = await getAnnouncements();
      setAnnouncements(data);
    } catch (err) {
      console.error(err);
      alert('获取公告失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateAnnouncement(editingId, formData.title, formData.content, formData.pinned, formData.attachmentFileId);
      } else {
        await createAnnouncement(formData.title, formData.content, formData.pinned, formData.attachmentFileId);
      }
      setIsModalOpen(false);
      fetchAnnouncements();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定删除此公告？')) return;
    try {
      await deleteAnnouncement(id);
      fetchAnnouncements();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAttachmentUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const results = await uploadFiles(files, null);
      setFormData(prev => ({ ...prev, attachmentFileId: results[0].id, attachmentName: results[0].original_name }));
    } catch (err) {
      alert('附件上传失败: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = () => {
    setFormData(prev => ({ ...prev, attachmentFileId: null, attachmentName: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openModal = (announcement = null) => {
    if (announcement) {
      setEditingId(announcement.id);
      setFormData({ 
        title: announcement.title, 
        content: announcement.content, 
        pinned: announcement.pinned === 1,
        attachmentFileId: announcement.attachment_file_id || null,
        attachmentName: announcement.attachment_name || ''
      });
    } else {
      setEditingId(null);
      setFormData({ title: '', content: '', pinned: false, attachmentFileId: null, attachmentName: '' });
    }
    setIsModalOpen(true);
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 className="page-title">📢 系统公告</h2>
        {user.role === 'admin' && (
          <button className="btn btn-primary" onClick={() => openModal()}>发布公告</button>
        )}
      </div>

      <div className="file-list">
        {announcements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>暂无公告</div>
        ) : announcements.map(a => (
          <div key={a.id} className={`file-item ${a.pinned ? 'announcement-pinned' : 'announcement-normal'}`} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 600, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary-color)' }}>
                {a.pinned === 1 && <span style={{ fontSize: '0.75rem', background: 'var(--primary-color)', color: '#000', padding: '0.1rem 0.4rem', borderRadius: '4px', letterSpacing: '1px' }}>置顶</span>}
                {a.title}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {a.author_name} · {new Date(a.created_at).toLocaleString()}
              </div>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: 'var(--text-color)', width: '100%', marginBottom: a.attachment_file_id ? '1rem' : '0' }}>
              {a.content}
            </div>
            
            {a.attachment_file_id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem', background: 'rgba(0,240,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '4px', width: '100%' }}>
                <span style={{ fontSize: '1.2rem' }}>📎</span>
                <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--primary-color)' }}>
                  {a.attachment_name} 
                  <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({(a.attachment_size / 1024).toFixed(1)} KB)</span>
                </span>
                <a className="btn btn-ghost" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }} href={getDownloadUrl(a.attachment_file_id)} download={a.attachment_name}>下载附件</a>
              </div>
            )}

            {user.role === 'admin' && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', width: '100%', justifyContent: 'flex-end', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '0.8rem' }}>
                <button className="btn btn-ghost" onClick={() => openModal(a)}>编辑</button>
                <button className="btn btn-danger" onClick={() => handleDelete(a.id)}>删除</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>{editingId ? '编辑公告' : '发布公告'}</h3>
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="input-group">
                <label>标题</label>
                <input required type="text" className="input-field" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
              </div>
              <div className="input-group">
                <label>内容</label>
                <textarea required className="input-field" style={{ height: '120px', resize: 'vertical' }} value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})}></textarea>
              </div>
              
              <div className="input-group">
                <label>附件 (可选)</label>
                {formData.attachmentName ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem', border: '1px solid var(--glass-border)', borderRadius: '4px', background: 'rgba(0,0,0,0.3)' }}>
                    <span style={{ color: 'var(--primary-color)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formData.attachmentName}</span>
                    <button type="button" className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={removeAttachment}>移除</button>
                  </div>
                ) : (
                  <div>
                    <input type="file" ref={fileInputRef} onChange={handleAttachmentUpload} style={{ display: 'none' }} />
                    <button type="button" className="btn btn-ghost" style={{ border: '1px dashed var(--glass-border)', width: '100%' }} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? '上传中...' : '+ 选取并上传附件'}
                    </button>
                  </div>
                )}
              </div>

              <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="pinned" checked={formData.pinned} onChange={e => setFormData({...formData, pinned: e.target.checked})} />
                <label htmlFor="pinned" style={{ margin: 0 }}>设为置顶</label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={uploading}>保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Announcements;
