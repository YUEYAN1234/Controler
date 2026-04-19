import React, { useState, useEffect } from 'react';
import { getComments, addComment, deleteComment } from '../api';
import { useAuth } from '../AuthContext';

function FileComments({ file, onClose }) {
  const [comments, setComments] = useState([]);
  const [newContent, setNewContent] = useState('');
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchComments = async () => {
    try {
      const data = await getComments(file.id);
      setComments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, [file]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    try {
      await addComment(file.id, newContent);
      setNewContent('');
      fetchComments();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定删除此注释？')) return;
    try {
      await deleteComment(id);
      fetchComments();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>文件注释: {file.original_name}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem' }} className="comments-panel">
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>加载中...</div>
          ) : comments.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>暂无注释，添加第一条记录吧</div>
          ) : (
            comments.map(c => (
              <div key={c.id} className="comment">
                <div className="comment-header">
                  <strong>{c.author_name}</strong>
                  <span>{new Date(c.created_at).toLocaleString()}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
                {(user.role === 'admin' || user.id === c.user_id) && (
                  <button 
                    className="btn btn-ghost" 
                    style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', marginTop: '0.5rem', color: 'var(--danger-color)' }}
                    onClick={() => handleDelete(c.id)}
                  >
                    删除
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
          <textarea 
            className="input-field" 
            style={{ flex: 1, resize: 'none', height: '60px', padding: '0.5rem' }} 
            placeholder="添加注释/实验记录..." 
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '0 1rem' }}>提交</button>
        </form>
      </div>
    </div>
  );
}

export default FileComments;
