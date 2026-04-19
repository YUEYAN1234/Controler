import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { register as registerApi } from '../api';

function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const data = await registerApi(username, password, displayName, inviteCode);
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card glass-panel">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src="/logo.png" alt="天津大学" style={{ width: '56px', height: '56px', borderRadius: '50%', marginBottom: '0.8rem' }} />
          <h2 className="auth-title">注册 Chem-E-Car 数据平台</h2>
        </div>
        {error && <div style={{ color: 'var(--danger-color)', marginBottom: '1rem', textAlign: 'center' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>邀请码</label>
            <input 
              type="text" 
              className="input-field" 
              value={inviteCode} 
              onChange={e => setInviteCode(e.target.value)} 
              required 
              placeholder="请向管理员获取邀请码"
            />
          </div>
          <div className="input-group">
            <label>用户名</label>
            <input 
              type="text" 
              className="input-field" 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              required 
              minLength={3}
            />
          </div>
          <div className="input-group">
            <label>显示昵称</label>
            <input 
              type="text" 
              className="input-field" 
              value={displayName} 
              onChange={e => setDisplayName(e.target.value)} 
              required 
            />
          </div>
          <div className="input-group">
            <label>密码</label>
            <input 
              type="password" 
              className="input-field" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              required 
              minLength={6}
            />
          </div>
          <div className="input-group">
            <label>确认密码</label>
            <input 
              type="password" 
              className="input-field" 
              value={confirmPassword} 
              onChange={e => setConfirmPassword(e.target.value)} 
              required 
              minLength={6}
              placeholder="请再次输入密码"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem' }} disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </button>
        </form>
        <div className="auth-footer">
          已有账号？ <Link to="/login">去登录</Link>
        </div>
      </div>
    </div>
  );
}

export default Register;
