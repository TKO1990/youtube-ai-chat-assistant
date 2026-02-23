// ── Tool declarations for YouTube channel JSON data ──────────────────────────

const FIELD_NOTE = 'Use the exact field name from the JSON data (e.g. viewCount, likeCount, commentCount, duration).';

export const JSON_TOOL_DECLARATIONS = [
  {
    name: 'compute_stats_json',
    description:
      'Compute descriptive statistics (mean, median, std, min, max) for any numeric field in the loaded YouTube channel JSON data. ' +
      'Call this when the user asks for statistics, average, distribution, or summary of a numeric field like viewCount, likeCount, commentCount, or duration. ' +
      FIELD_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description: 'The numeric field name from the JSON data, e.g. "viewCount", "likeCount", "commentCount", "duration".',
        },
      },
      required: ['field'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Create a chart plotting any numeric field (views, likes, comments, duration, etc.) vs release date for the channel videos. ' +
      'Returns chart data that will be rendered as a React component in the chat. ' +
      'Use this when the user asks to plot, chart, graph, or visualize a metric over time. ' +
      FIELD_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        metric: {
          type: 'STRING',
          description: 'The numeric field to plot on the Y-axis, e.g. "viewCount", "likeCount", "commentCount", "duration".',
        },
        title: {
          type: 'STRING',
          description: 'Optional title for the chart.',
        },
      },
      required: ['metric'],
    },
  },
  {
    name: 'play_video',
    description:
      'Play or open a YouTube video from the loaded channel data. Returns video info (title, thumbnail, URL) that will be displayed as a clickable card. ' +
      'The user can specify which video by title (e.g. "play the asbestos video"), ordinal (e.g. "play the first video"), or "most viewed". ' +
      'Match the user\'s description to the best matching video in the loaded data.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'How the user identified the video: a title fragment, ordinal like "first"/"third"/"last", or "most viewed"/"least viewed".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'generateImage',
    description:
      'Generate an image from a text prompt. If the user has dragged in an anchor/reference image, it will be used as a base. ' +
      'Call this when the user asks to generate, create, or make an image, picture, illustration, or artwork. ' +
      'Returns the generated image to display in the chat.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Detailed text description of the image to generate.',
        },
      },
      required: ['prompt'],
    },
  },
];

// ── Helper functions ─────────────────────────────────────────────────────────

const resolveField = (videos, name) => {
  if (!videos.length || !name) return name;
  const keys = Object.keys(videos[0]);
  if (keys.includes(name)) return name;
  const norm = (s) => s.toLowerCase().replace(/[_\s-]+/g, '');
  const target = norm(name);
  return keys.find((k) => norm(k) === target) || name;
};

const numericValues = (videos, field) =>
  videos.map((v) => parseFloat(v[field])).filter((n) => !isNaN(n));

const median = (sorted) =>
  sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

const fmt = (n) => +n.toFixed(4);

// ── Ordinal resolver ─────────────────────────────────────────────────────────

const ORDINALS = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4,
  sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9,
  last: -1,
};

function findVideo(videos, query) {
  if (!videos.length) return null;
  const q = query.toLowerCase().trim();

  // "most viewed" / "least viewed"
  if (q.includes('most viewed') || q.includes('most popular')) {
    return [...videos].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0];
  }
  if (q.includes('least viewed') || q.includes('least popular')) {
    return [...videos].sort((a, b) => (a.viewCount || 0) - (b.viewCount || 0))[0];
  }
  if (q.includes('most liked')) {
    return [...videos].sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))[0];
  }
  if (q.includes('longest')) {
    return [...videos].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
  }
  if (q.includes('shortest')) {
    return [...videos].sort((a, b) => (a.duration || 0) - (b.duration || 0))[0];
  }
  if (q.includes('newest') || q.includes('latest') || q.includes('most recent')) {
    return [...videos].sort((a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0))[0];
  }
  if (q.includes('oldest')) {
    return [...videos].sort((a, b) => new Date(a.releaseDate || 0) - new Date(b.releaseDate || 0))[0];
  }

  // Ordinal
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (q.includes(word)) {
      return idx === -1 ? videos[videos.length - 1] : videos[idx] || null;
    }
  }

  // Numeric ordinal like "video 3" or "3rd video"
  const numMatch = q.match(/(\d+)/);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
    if (n >= 1 && n <= videos.length) return videos[n - 1];
  }

  // Title fuzzy match
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  let bestMatch = null;
  let bestScore = 0;
  for (const v of videos) {
    const title = (v.title || '').toLowerCase();
    const score = words.filter((w) => title.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = v;
    }
  }

  return bestMatch;
}

// ── Tool executor ────────────────────────────────────────────────────────────

export const executeJsonTool = (toolName, args, videos) => {
  const availableFields = videos.length ? Object.keys(videos[0]) : [];

  switch (toolName) {
    case 'compute_stats_json': {
      const field = resolveField(videos, args.field);
      const vals = numericValues(videos, field);
      if (!vals.length)
        return { error: `No numeric values found for field "${field}". Available fields: ${availableFields.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        field,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'plot_metric_vs_time': {
      const metric = resolveField(videos, args.metric);
      const chartData = videos
        .filter((v) => v.releaseDate && !isNaN(parseFloat(v[metric])))
        .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate))
        .map((v) => ({
          date: v.releaseDate,
          label: new Date(v.releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
          value: parseFloat(v[metric]),
          title: (v.title || '').slice(0, 40),
        }));

      if (!chartData.length)
        return { error: `No data to plot for "${metric}". Available fields: ${availableFields.join(', ')}` };

      return {
        _chartType: 'metric_vs_time',
        metric,
        chartTitle: args.title || `${metric} vs Time`,
        data: chartData,
      };
    }

    case 'play_video': {
      const video = findVideo(videos, args.query);
      if (!video) return { error: `No video found matching "${args.query}"` };
      return {
        _cardType: 'video',
        videoId: video.videoId,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        videoUrl: video.videoUrl,
        viewCount: video.viewCount,
        duration: video.duration,
        releaseDate: video.releaseDate,
      };
    }

    case 'generateImage': {
      return {
        _actionType: 'generateImage',
        prompt: args.prompt,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
};
