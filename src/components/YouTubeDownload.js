import { useState } from 'react';
import { downloadChannelData } from '../services/mongoApi';
import './YouTubeDownload.css';

export default function YouTubeDownload({ username, firstName, lastName, onLogout, activeTab, onTabChange }) {
  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(10);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    if (!channelUrl.trim() || downloading) return;
    setDownloading(true);
    setProgress(0);
    setStatusMsg('Starting...');
    setError('');
    setResult(null);

    try {
      const videos = await downloadChannelData(channelUrl.trim(), maxVideos, (data) => {
        setProgress(data.progress);
        setStatusMsg(data.message);
      });
      setResult(videos);
      setStatusMsg(`Downloaded ${videos.length} videos!`);
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleSaveJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const channelName = channelUrl.match(/@([\w-]+)/)?.[1] || 'channel';
    a.href = url;
    a.download = `${channelName}_videos.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="yt-layout">
      <aside className="yt-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">YouTube AI</h1>
        </div>

        <div className="yt-tabs">
          <button
            className={`yt-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => onTabChange('chat')}
          >
            Chat
          </button>
          <button
            className={`yt-tab ${activeTab === 'youtube' ? 'active' : ''}`}
            onClick={() => onTabChange('youtube')}
          >
            YouTube Channel Download
          </button>
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{firstName || username}</span>
          <button onClick={onLogout} className="sidebar-logout">Log out</button>
        </div>
      </aside>

      <div className="yt-main">
        <header className="yt-header">
          <h2>YouTube Channel Download</h2>
          <p className="yt-header-sub">Download video metadata from any YouTube channel</p>
        </header>

        <div className="yt-content">
          <div className="yt-form">
            <label className="yt-label">Channel URL</label>
            <input
              type="text"
              className="yt-input"
              placeholder="https://www.youtube.com/@veritasium"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              disabled={downloading}
            />

            <label className="yt-label">Max Videos</label>
            <input
              type="number"
              className="yt-input yt-input-short"
              min={1}
              max={100}
              value={maxVideos}
              onChange={(e) => setMaxVideos(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
              disabled={downloading}
            />

            <button
              className="yt-download-btn"
              onClick={handleDownload}
              disabled={downloading || !channelUrl.trim()}
            >
              {downloading ? 'Downloading...' : 'Download Channel Data'}
            </button>
          </div>

          {(downloading || progress > 0) && (
            <div className="yt-progress-section">
              <div className="yt-progress-bar">
                <div className="yt-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="yt-progress-text">{statusMsg} ({progress}%)</p>
            </div>
          )}

          {error && <div className="yt-error">{error}</div>}

          {result && (
            <div className="yt-result">
              <div className="yt-result-header">
                <h3>Downloaded {result.length} Videos</h3>
                <button className="yt-save-btn" onClick={handleSaveJson}>
                  Download JSON
                </button>
              </div>

              <div className="yt-video-list">
                {result.map((v, i) => (
                  <div key={v.videoId || i} className="yt-video-card">
                    <img
                      src={v.thumbnailUrl}
                      alt={v.title}
                      className="yt-video-thumb"
                    />
                    <div className="yt-video-info">
                      <a
                        href={v.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="yt-video-title"
                      >
                        {v.title}
                      </a>
                      <div className="yt-video-stats">
                        <span>{(v.viewCount || 0).toLocaleString()} views</span>
                        <span>{v.releaseDate}</span>
                        <span>{Math.floor((v.duration || 0) / 60)}m {(v.duration || 0) % 60}s</span>
                        {v.transcript && <span className="yt-has-transcript">Has transcript</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
