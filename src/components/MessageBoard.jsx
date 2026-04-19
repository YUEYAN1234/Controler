import React, { useState, useEffect } from 'react';
import { getMessages, postMessage, deleteMessage, getReplies, postReply, deleteReply } from '../api';
import { useAuth } from '../AuthContext';

function MessageBoard() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyContent, setReplyContent] = useState('');
  const [loadingReplies, setLoadingReplies] = useState(false);
  const { user } = useAuth();

  const fetchMessages = async () => {
    try {
      const data = await getMessages();
      setMessages(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMessages(); }, []);

  const handlePost = async (e) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    try {
      await postMessage(newContent);
      setNewContent('');
      fetchMessages();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定删除留言？')) return;
    try {
      await deleteMessage(id);
      if (expandedId === id) setExpandedId(null);
      fetchMessages();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleReplies = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setLoadingReplies(true);
    setReplyContent('');
    try {
      const data = await getReplies(id);
      setReplies(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReplies(false);
    }
  };

  const handleReply = async (e, messageId) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    try {
      await postReply(messageId, replyContent);
      setReplyContent('');
      const data = await getReplies(messageId);
      setReplies(data);
      fetchMessages();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteReply = async (replyId, messageId) => {
    if (!window.confirm('确定删除回复？')) return;
    try {
      await deleteReply(replyId);
      const data = await getReplies(messageId);
      setReplies(data);
      fetchMessages();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>加载中...</div>;

  return (
    <div>
      <h2 className="page-title">💬 留言板</h2>

      <form onSubmit={handlePost} style={{ marginTop: '1.5rem', marginBottom: '2rem', display: 'flex', gap: '0.8rem', alignItems: 'stretch' }}>
        <textarea
          className="input-field"
          style={{ flex: 1, resize: 'none', height: '48px' }}
          placeholder="说点什么吧..."
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary" style={{ padding: '0.6rem 1.5rem' }}>发布</button>
      </form>

      <div className="file-list">
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无留言，来第一个发言吧</div>
        ) : messages.map(m => (
          <div key={m.id} className="file-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--primary-color)', fontSize: '0.95rem' }}>{m.author_name}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{new Date(m.created_at).toLocaleString()}</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', width: '100%', marginBottom: '0.8rem' }}>
              {m.content}
            </div>
            <div style={{ display: 'flex', gap: '0.8rem', width: '100%', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '0.6rem', alignItems: 'center' }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '0.85rem', padding: '0.2rem 0.6rem' }}
                onClick={() => toggleReplies(m.id)}
              >
                {expandedId === m.id ? '收起回复' : `回复 (${m.reply_count})`}
              </button>
              {(user.role === 'admin' || user.id === m.user_id) && (
                <button
                  className="btn btn-danger"
                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem', marginLeft: 'auto' }}
                  onClick={() => handleDelete(m.id)}
                >
                  删除
                </button>
              )}
            </div>

            {expandedId === m.id && (
              <div style={{ width: '100%', marginTop: '0.8rem', paddingLeft: '1rem', borderLeft: '2px solid var(--primary-color)' }}>
                {loadingReplies ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>加载回复中...</div>
                ) : (
                  <>
                    {replies.map(r => (
                      <div key={r.id} style={{ marginBottom: '0.6rem', padding: '0.6rem', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--primary-color)', fontSize: '0.85rem' }}>{r.author_name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{new Date(r.created_at).toLocaleString()}</span>
                            {(user.role === 'admin' || user.id === r.user_id) && (
                              <button className="btn btn-ghost" style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem', color: 'var(--danger-color)' }} onClick={() => handleDeleteReply(r.id, m.id)}>删除</button>
                            )}
                          </div>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{r.content}</div>
                      </div>
                    ))}
                    <form onSubmit={e => handleReply(e, m.id)} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input
                        className="input-field"
                        style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.9rem' }}
                        placeholder="写回复..."
                        value={replyContent}
                        onChange={e => setReplyContent(e.target.value)}
                        required
                      />
                      <button type="submit" className="btn btn-primary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem' }}>回复</button>
                    </form>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default MessageBoard;
