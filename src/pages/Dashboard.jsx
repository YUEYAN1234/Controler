import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { changePassword } from '../api';
import FileManager from '../components/FileManager';
import LabReservation from '../components/LabReservation';
import Announcements from '../components/Announcements';
import MessageBoard from '../components/MessageBoard';
import SnakeGame from '../components/SnakeGame';
import AiChat from '../components/AiChat';

function ChangePasswordModal({ onClose }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    if (newPassword.length < 6) {
      setError('新密码至少6个字符');
      return;
    }

    if (oldPassword === newPassword) {
      setError('新密码不能与原密码相同');
      return;
    }

    setLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setSuccess('密码修改成功，请使用新密码登录');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>🔑 修改密码</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>原密码</label>
            <input
              type="password"
              className="input-field"
              placeholder="请输入原密码"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="input-group">
            <label>新密码</label>
            <input
              type="password"
              className="input-field"
              placeholder="至少6个字符"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <label>确认新密码</label>
            <input
              type="password"
              className="input-field"
              placeholder="再次输入新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div style={{ color: 'var(--danger-color)', fontSize: '0.85rem', marginBottom: '1rem', padding: '0.5rem 0.8rem', background: 'rgba(212, 92, 92, 0.1)', borderRadius: '6px', border: '1px solid rgba(212, 92, 92, 0.2)' }}>
              ⚠️ {error}
            </div>
          )}

          {success && (
            <div style={{ color: '#4ade80', fontSize: '0.85rem', marginBottom: '1rem', padding: '0.5rem 0.8rem', background: 'rgba(74, 222, 128, 0.1)', borderRadius: '6px', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
              ✅ {success}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.7rem' }}
            disabled={loading}
          >
            {loading ? '修改中...' : '确认修改'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('files');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatDoneHint, setChatDoneHint] = useState(false);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  return (
    <div className="app-container">
      <header className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="天津大学" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
          <span className="topbar-title">天津大学 Chem-E-Car 实验数据平台</span>
        </div>

        <div className="topbar-toolbar">
          <nav className="topbar-nav">
            <button
              className={`topbar-tab ${activeTab === 'files' ? 'topbar-tab-active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              文件管理
            </button>
            <button
              className={`topbar-tab ${activeTab === 'reservation' ? 'topbar-tab-active' : ''}`}
              onClick={() => setActiveTab('reservation')}
            >
              实验室预约
            </button>
            <button
              className={`topbar-tab ${activeTab === 'announcements' ? 'topbar-tab-active' : ''}`}
              onClick={() => setActiveTab('announcements')}
            >
              系统公告
            </button>
            <button
              className={`topbar-tab ${activeTab === 'messages' ? 'topbar-tab-active' : ''}`}
              onClick={() => setActiveTab('messages')}
            >
              交流板
            </button>
            <button
              className={`topbar-tab ${activeTab === 'games' ? 'topbar-tab-active' : ''}`}
              onClick={() => setActiveTab('games')}
            >
              小游戏
            </button>
            <button
              className={`topbar-tab topbar-tab-chat ${activeTab === 'chat' ? 'topbar-tab-active' : ''} ${chatBusy ? 'topbar-tab-busy' : ''} ${chatDoneHint && activeTab !== 'chat' ? 'topbar-tab-done' : ''}`}
              onClick={() => {
                setActiveTab('chat');
                setChatDoneHint(false);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', verticalAlign: 'middle' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Conter
              {chatBusy && activeTab !== 'chat' && <span className="topbar-tab-dot" title="Conter 正在后台生成"></span>}
              {chatDoneHint && activeTab !== 'chat' && <span className="topbar-tab-badge">完成</span>}
            </button>
          </nav>

          <div className="topbar-user">
            <div className="topbar-avatar">
              {user.displayName?.charAt(0).toUpperCase()}
            </div>
            <div className="topbar-user-info">
              <div className="topbar-user-name">{user.displayName}</div>
              <div className="topbar-user-role" style={{ color: user.role === 'admin' ? 'var(--primary-color)' : 'var(--text-muted)' }}>
                {user.role === 'admin' ? '🛡️ 管理员' : '👤 成员'}
              </div>
            </div>
            <button
              className="theme-toggle"
              onClick={() => setShowChangePwd(true)}
              title="修改密码"
              style={{ fontSize: '0.9rem' }}
            >
              🔑
            </button>
            <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button className="btn btn-danger" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={logout}>退出</button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className={`page-transition ${activeTab === 'chat' ? 'page-hidden' : ''}`} key={activeTab === 'chat' ? 'content-hidden' : activeTab}>
          {activeTab === 'files' && <FileManager />}
          {activeTab === 'reservation' && <LabReservation />}
          {activeTab === 'announcements' && <Announcements />}
          {activeTab === 'messages' && <MessageBoard />}
          {activeTab === 'games' && <SnakeGame />}
        </div>
        <div className={activeTab === 'chat' ? 'page-transition' : 'page-hidden'}>
          <AiChat
            onBusyChange={setChatBusy}
            onBackgroundDone={() => {
              if (activeTab !== 'chat') setChatDoneHint(true);
            }}
          />
        </div>
      </main>

      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
    </div>
  );
}

export default Dashboard;
