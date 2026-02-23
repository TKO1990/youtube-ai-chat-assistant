import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeDownload from './components/YouTubeDownload';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('chatapp_user');
    if (!saved) return null;
    try { return JSON.parse(saved); } catch { return { username: saved }; }
  });
  const [activeTab, setActiveTab] = useState('chat');

  const handleLogin = (userData) => {
    localStorage.setItem('chatapp_user', JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
    setActiveTab('chat');
  };

  if (!user) return <Auth onLogin={handleLogin} />;

  return (
    <div className="app-layout">
      {activeTab === 'chat' && (
        <Chat
          username={user.username}
          firstName={user.firstName}
          lastName={user.lastName}
          onLogout={handleLogout}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      )}
      {activeTab === 'youtube' && (
        <YouTubeDownload
          username={user.username}
          firstName={user.firstName}
          lastName={user.lastName}
          onLogout={handleLogout}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      )}
    </div>
  );
}

export default App;
