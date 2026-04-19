import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import FileManager from '../components/FileManager';
import Announcements from '../components/Announcements';
import MessageBoard from '../components/MessageBoard';

function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('files');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

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
          <span className="topbar-title">天津大学 Chem-E-Car 控制组数据平台</span>
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
              className={`topbar-tab ${activeTab === 'announcements' ? 'topbar-tab-active' : ''}`}
              onClick={() => setActiveTab('announcements')}
            >
              系统公告
            </button>
            <button
              className={`topbar-tab ${activeTab === 'messages' ? 'topbar-tab-active' : ''}`}
              onClick={() => setActiveTab('messages')}
            >
              留言板
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
            <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button className="btn btn-danger" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={logout}>退出</button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="page-transition" key={activeTab}>
          {activeTab === 'files' && <FileManager />}
          {activeTab === 'announcements' && <Announcements />}
          {activeTab === 'messages' && <MessageBoard />}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
