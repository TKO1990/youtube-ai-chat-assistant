export default function VideoCard({ video }) {
  if (!video) return null;

  const duration = video.duration
    ? `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`
    : '';

  return (
    <div className="video-card">
      <a
        href={video.videoUrl}
        target="_blank"
        rel="noreferrer"
        className="video-card-link"
      >
        <div className="video-card-thumb-wrap">
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="video-card-thumb"
          />
          {duration && <span className="video-card-duration">{duration}</span>}
          <div className="video-card-play-icon">▶</div>
        </div>
        <div className="video-card-info">
          <h4 className="video-card-title">{video.title}</h4>
          <div className="video-card-stats">
            {video.viewCount != null && (
              <span>{Number(video.viewCount).toLocaleString()} views</span>
            )}
            {video.releaseDate && <span>{video.releaseDate}</span>}
          </div>
        </div>
      </a>
    </div>
  );
}
