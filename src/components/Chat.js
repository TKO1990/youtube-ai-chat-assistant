import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, chatWithCsvTools, chatWithJsonTools, generateImageWithGemini } from '../services/gemini';
import { parseCsvToRows, executeTool, computeDatasetSummary, enrichWithEngagement, buildSlimCsv } from '../services/csvTools';
import { executeJsonTool } from '../services/jsonTools';
import {
  getSessions,
  createSession,
  deleteSession,
  saveMessage,
  loadMessages,
} from '../services/mongoApi';
import EngagementChart from './EngagementChart';
import MetricChart from './MetricChart';
import VideoCard from './VideoCard';
import './Chat.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const parseCSV = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rowCount = lines.length - 1;
  const preview = lines.slice(0, 6).join('\n');
  const raw = text.length > 500000 ? text.slice(0, 500000) : text;
  const base64 = toBase64(raw);
  const truncated = text.length > 500000;
  return { headers, rowCount, preview, base64, truncated };
};

const messageText = (m) => {
  if (m.parts) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// ── Structured part renderer ─────────────────────────────────────────────────

function StructuredParts({ parts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return (
            <div key={i} className="part-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type === 'code') {
          return (
            <div key={i} className="part-code">
              <div className="part-code-header">
                <span className="part-code-lang">
                  {part.language === 'PYTHON' ? 'Python' : part.language}
                </span>
              </div>
              <pre className="part-code-body"><code>{part.code}</code></pre>
            </div>
          );
        }
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return (
            <div key={i} className="part-result">
              <div className="part-result-header">
                <span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Output' : '✗ Error'}
                </span>
              </div>
              <pre className="part-result-body">{part.output}</pre>
            </div>
          );
        }
        if (part.type === 'image') {
          return (
            <img key={i} src={`data:${part.mimeType};base64,${part.data}`}
              alt="Generated plot" className="part-image" />
          );
        }
        return null;
      })}
    </>
  );
}

// ── Image lightbox ───────────────────────────────────────────────────────────

function ImageLightbox({ src, alt, onClose }) {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt} className="lightbox-img" />
        <div className="lightbox-actions">
          <a href={src} download={`generated-image.png`} className="lightbox-download">Download</a>
          <button onClick={onClose} className="lightbox-close">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat({ username, firstName, lastName, onLogout, activeTab, onTabChange }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [csvContext, setCsvContext] = useState(null);
  const [jsonContext, setJsonContext] = useState(null);
  const [sessionCsvRows, setSessionCsvRows] = useState(null);
  const [sessionCsvHeaders, setSessionCsvHeaders] = useState(null);
  const [csvDataSummary, setCsvDataSummary] = useState(null);
  const [sessionSlimCsv, setSessionSlimCsv] = useState(null);
  const [sessionJsonData, setSessionJsonData] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  const justCreatedSessionRef = useRef(false);

  const displayName = firstName ? `${firstName} ${lastName || ''}`.trim() : username;
  const userContextForAI = firstName
    ? `The user's name is ${firstName}${lastName ? ' ' + lastName : ''}. Address them by their first name.`
    : '';

  useEffect(() => {
    const init = async () => {
      const list = await getSessions(username);
      setSessions(list);
      setActiveSessionId('new');
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') {
      setMessages([]);
      return;
    }
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setMessages([]);
    loadMessages(activeSessionId).then(setMessages);
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Session management ──────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new');
    setMessages([]);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setSessionJsonData(null);
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setSessionJsonData(null);
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);
    await deleteSession(sessionId);
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const processJsonFile = (text, fileName) => {
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : [data];
      if (!arr.length) return;
      setJsonContext({ name: fileName, count: arr.length, fields: Object.keys(arr[0]) });
      setSessionJsonData(arr);
    } catch { /* invalid JSON */ }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      const file = jsonFiles[0];
      const text = await fileToText(file);
      processJsonFile(text, file.name);
    }

    if (csvFiles.length > 0) {
      const file = csvFiles[0];
      const text = await fileToText(file);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: file.name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      const text = await fileToText(jsonFiles[0]);
      processJsonFile(text, jsonFiles[0].name);
    }

    if (csvFiles.length > 0) {
      const text = await fileToText(csvFiles[0]);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: csvFiles[0].name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }
    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ data: reader.result.split(',')[1], mimeType: file.type, name: 'pasted-image' });
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => { abortRef.current = true; };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !csvContext && !jsonContext) || streaming || !activeSessionId) return;

    let sessionId = activeSessionId;
    if (sessionId === 'new') {
      const title = chatTitle();
      const { id } = await createSession(username, 'assistant', title);
      sessionId = id;
      justCreatedSessionRef.current = true;
      setActiveSessionId(id);
      setSessions((prev) => [{ id, agent: 'assistant', title, createdAt: new Date().toISOString(), messageCount: 0 }, ...prev]);
    }

    // ── Route intent ──────────────────────────────────────────────────────────
    const PYTHON_ONLY_KEYWORDS = /\b(regression|scatter|histogram|seaborn|matplotlib|numpy|time.?series|heatmap|box.?plot|violin|distribut|linear.?model|logistic|forecast|trend.?line)\b/i;
    const wantPythonOnly = PYTHON_ONLY_KEYWORDS.test(text);
    const capturedCsv = csvContext;
    const capturedJson = jsonContext;
    const hasJsonInSession = !!sessionJsonData || !!capturedJson;
    const hasCsvData = !!sessionCsvRows || !!capturedCsv;
    const needsBase64 = !!capturedCsv && wantPythonOnly;

    // Detect image generation intent
    const IMAGE_KEYWORDS = /\b(generate|create|make|draw|design)\b.*\b(image|picture|photo|illustration|thumbnail|artwork|poster|banner)\b/i;
    const wantImage = IMAGE_KEYWORDS.test(text);

    // JSON tools when JSON loaded OR when user wants image generation
    // CSV tools when CSV rows exist (no Python needed)
    // Code execution only for Python-specific requests WITH actual CSV data
    // Everything else uses Google Search streaming
    const useJsonTools = (hasJsonInSession || wantImage) && !wantPythonOnly;
    const useCsvTools = !useJsonTools && !!sessionCsvRows && !wantPythonOnly && !capturedCsv;
    const useCodeExecution = !useJsonTools && !useCsvTools && wantPythonOnly && hasCsvData;

    // ── Build prompt ──────────────────────────────────────────────────────────
    const sessionSummary = csvDataSummary || '';
    const slimCsvBlock = sessionSlimCsv
      ? `\n\nFull dataset (key columns):\n\`\`\`csv\n${sessionSlimCsv}\n\`\`\``
      : '';

    let csvPrefix = '';
    if (capturedCsv) {
      csvPrefix = needsBase64
        ? `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]\n\n${sessionSummary}${slimCsvBlock}\n\nIMPORTANT — to load the full data in Python use this exact pattern:\n\`\`\`python\nimport pandas as pd, io, base64\ndf = pd.read_csv(io.BytesIO(base64.b64decode("${capturedCsv.base64}")))\n\`\`\`\n\n---\n\n`
        : `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]\n\n${sessionSummary}${slimCsvBlock}\n\n---\n\n`;
    } else if (sessionSummary && !hasJsonInSession) {
      csvPrefix = `[CSV columns: ${sessionCsvHeaders?.join(', ')}]\n\n${sessionSummary}\n\n---\n\n`;
    }

    let jsonPrefix = '';
    if (capturedJson && sessionJsonData) {
      const fields = Object.keys(sessionJsonData[0] || {});
      const videoTitles = sessionJsonData.slice(0, 5).map((v) => `"${v.title}"`).join(', ');
      jsonPrefix = `[YouTube Channel JSON: ${capturedJson.name} | ${sessionJsonData.length} videos | Fields: ${fields.join(', ')}]\nSample titles: ${videoTitles}${sessionJsonData.length > 5 ? '...' : ''}\n\n---\n\n`;
    } else if (sessionJsonData && !capturedJson) {
      const fields = Object.keys(sessionJsonData[0] || {});
      jsonPrefix = `[YouTube Channel JSON loaded: ${sessionJsonData.length} videos | Fields: ${fields.join(', ')}]\n\n---\n\n`;
    }

    const userContent = text || (images.length ? '(Image)' : capturedJson ? '(JSON attached)' : '(CSV attached)');
    const promptForGemini = csvPrefix + jsonPrefix + (text || (images.length ? 'What do you see in this image?' : capturedJson ? 'Please analyze this YouTube channel data.' : 'Please analyze this CSV data.'));

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
      csvName: capturedCsv?.name || null,
      jsonName: capturedJson?.name || null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = [...images];
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setStreaming(true);

    await saveMessage(sessionId, 'user', userContent, capturedImages.length ? capturedImages : null);

    const imageParts = capturedImages.map((img) => ({ mimeType: img.mimeType, data: img.data }));

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() },
    ]);

    abortRef.current = false;

    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolVideoCards = [];
    let toolCalls = [];
    let generatedImage = null;

    try {
      if (useJsonTools) {
        // ── JSON tool-calling path ────────────────────────────────────────────
        const jsonFields = sessionJsonData?.length ? Object.keys(sessionJsonData[0]) : [];
        const { text: answer, charts, videoCards, toolCalls: calls, imageGenRequest } = await chatWithJsonTools(
          history,
          promptForGemini,
          jsonFields,
          (toolName, args) => executeJsonTool(toolName, args, sessionJsonData || []),
          userContextForAI
        );
        fullContent = answer;
        toolCharts = charts || [];
        toolVideoCards = videoCards || [];
        toolCalls = calls || [];

        // Handle image generation if requested
        if (imageGenRequest) {
          // Show progress while generating (takes 1-3 minutes)
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: fullContent + '\n\n⏳ Generating image... (this may take 1-2 minutes)' }
                : msg
            )
          );
          try {
            const { imageData, textResponse } = await generateImageWithGemini(
              imageGenRequest.prompt,
              imageParts
            );
            if (imageData) {
              generatedImage = imageData;
              if (textResponse) fullContent += '\n\n' + textResponse;
            } else {
              fullContent += '\n\n(Image generation returned no image data)';
            }
          } catch (err) {
            fullContent += `\n\n(Image generation failed: ${err.message})`;
          }
        }

        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  videoCards: toolVideoCards.length ? toolVideoCards : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                  generatedImage: generatedImage || undefined,
                }
              : msg
          )
        );
      } else if (useCsvTools) {
        // ── CSV tool-calling path ─────────────────────────────────────────────
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithCsvTools(
          history,
          promptForGemini,
          sessionCsvHeaders,
          (toolName, args) => executeTool(toolName, args, sessionCsvRows)
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                }
              : msg
          )
        );
      } else {
        // ── Streaming path ────────────────────────────────────────────────────
        for await (const chunk of streamChat(history, promptForGemini, imageParts, useCodeExecution, userContextForAI)) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            const snapshot = fullContent;
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: snapshot } : msg))
            );
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            const partsSnapshot = structuredParts;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId ? { ...msg, content: '', parts: partsSnapshot } : msg
              )
            );
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      const errText = `Error: ${err.message}`;
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg))
      );
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg))
      );
    }

    const savedContent = structuredParts
      ? structuredParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;
    await saveMessage(
      sessionId, 'model', savedContent, null,
      toolCharts.length ? toolCharts : null,
      toolCalls.length ? toolCalls : null
    );

    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s))
    );

    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} alt="Enlarged" onClose={() => setLightboxSrc(null)} />
      )}

      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">YouTube AI</h1>
          <button className="new-chat-btn" onClick={handleNewChat}>+ New Chat</button>
        </div>

        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => onTabChange('chat')}
          >
            Chat
          </button>
          <button
            className={`sidebar-tab ${activeTab === 'youtube' ? 'active' : ''}`}
            onClick={() => onTabChange('youtube')}
          >
            YouTube Download
          </button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div
                className="sidebar-session-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === session.id ? null : session.id);
                }}
              >
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button className="session-delete-btn" onClick={(e) => handleDeleteSession(session.id, e)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{displayName}</span>
          <button onClick={onLogout} className="sidebar-logout">Log out</button>
        </div>
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <h2 className="chat-header-title">{activeSession?.title ?? 'New Chat'}</h2>
        </header>

        <div
          className={`chat-messages${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-meta">
                <span className="chat-msg-role">{m.role === 'user' ? displayName : 'YouTube AI'}</span>
                <span className="chat-msg-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {m.csvName && <div className="msg-csv-badge">📄 {m.csvName}</div>}
              {m.jsonName && <div className="msg-json-badge">📋 {m.jsonName}</div>}

              {m.images?.length > 0 && (
                <div className="chat-msg-images">
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                  ))}
                </div>
              )}

              <div className="chat-msg-content">
                {m.role === 'model' ? (
                  m.parts ? (
                    <StructuredParts parts={m.parts} />
                  ) : m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <span className="thinking-dots"><span /><span /><span /></span>
                  )
                ) : (
                  m.content
                )}
              </div>

              {/* Generated image */}
              {m.generatedImage && (
                <div className="generated-image-wrap">
                  <img
                    src={`data:${m.generatedImage.mimeType};base64,${m.generatedImage.data}`}
                    alt="Generated"
                    className="generated-image"
                    onClick={() => setLightboxSrc(`data:${m.generatedImage.mimeType};base64,${m.generatedImage.data}`)}
                  />
                  <a
                    href={`data:${m.generatedImage.mimeType};base64,${m.generatedImage.data}`}
                    download="generated-image.png"
                    className="generated-image-download"
                  >
                    Download
                  </a>
                </div>
              )}

              {/* Tool calls log */}
              {m.toolCalls?.length > 0 && (
                <details className="tool-calls-details">
                  <summary className="tool-calls-summary">
                    🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                  </summary>
                  <div className="tool-calls-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="tool-call-item">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                        {tc.result && !tc.result._chartType && !tc.result._cardType && !tc.result._actionType && (
                          <span className="tool-call-result">
                            → {JSON.stringify(tc.result).slice(0, 200)}
                            {JSON.stringify(tc.result).length > 200 ? '…' : ''}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Charts */}
              {m.charts?.map((chart, ci) =>
                chart._chartType === 'engagement' ? (
                  <EngagementChart key={ci} data={chart.data} metricColumn={chart.metricColumn} />
                ) : chart._chartType === 'metric_vs_time' ? (
                  <MetricChart
                    key={ci}
                    data={chart.data}
                    metric={chart.metric}
                    chartTitle={chart.chartTitle}
                    onEnlarge={(src) => setLightboxSrc(src)}
                  />
                ) : null
              )}

              {/* Video cards */}
              {m.videoCards?.map((card, vi) => (
                <VideoCard key={vi} video={card} />
              ))}

              {/* Search sources */}
              {m.grounding?.groundingChunks?.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="sources-label">Sources</span>
                  <div className="sources-list">
                    {m.grounding.groundingChunks.map((chunk, i) =>
                      chunk.web ? (
                        <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">
                          {chunk.web.title || chunk.web.uri}
                        </a>
                      ) : null
                    )}
                  </div>
                  {m.grounding.webSearchQueries?.length > 0 && (
                    <div className="sources-queries">
                      Searched: {m.grounding.webSearchQueries.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {dragOver && <div className="chat-drop-overlay">Drop CSV, JSON, or images here</div>}

        <div className="chat-input-area">
          {csvContext && (
            <div className="csv-chip">
              <span className="csv-chip-icon">📄</span>
              <span className="csv-chip-name">{csvContext.name}</span>
              <span className="csv-chip-meta">{csvContext.rowCount} rows · {csvContext.headers.length} cols</span>
              <button className="csv-chip-remove" onClick={() => setCsvContext(null)} aria-label="Remove CSV">×</button>
            </div>
          )}

          {jsonContext && (
            <div className="json-chip">
              <span className="json-chip-icon">📋</span>
              <span className="json-chip-name">{jsonContext.name}</span>
              <span className="json-chip-meta">{jsonContext.count} videos · {jsonContext.fields.length} fields</span>
              <button className="json-chip-remove" onClick={() => { setJsonContext(null); setSessionJsonData(null); }} aria-label="Remove JSON">×</button>
            </div>
          )}

          {images.length > 0 && (
            <div className="chat-image-previews">
              {images.map((img, i) => (
                <div key={i} className="chat-img-preview">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.csv,text/csv,.json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <div className="chat-input-row">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              title="Attach image, CSV, or JSON"
            >
              📎
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder={sessionJsonData ? 'Ask about the YouTube channel data...' : 'Ask a question, request analysis, or generate an image…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              onPaste={handlePaste}
              disabled={streaming}
            />
            {streaming ? (
              <button onClick={handleStop} className="stop-btn">■ Stop</button>
            ) : (
              <button onClick={handleSend} disabled={!input.trim() && !images.length && !csvContext && !jsonContext}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
