import { GoogleGenerativeAI } from '@google/generative-ai';
import { CSV_TOOL_DECLARATIONS } from './csvTools';
import { JSON_TOOL_DECLARATIONS } from './jsonTools';

const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY || '');

const MODEL = 'gemini-2.5-pro';

const SEARCH_TOOL = { googleSearch: {} };
const CODE_EXEC_TOOL = { codeExecution: {} };

export const CODE_KEYWORDS = /\b(plot|chart|graph|analyz|statistic|regression|correlat|histogram|visualiz|calculat|compute|run code|write code|execute|pandas|numpy|matplotlib|csv|data)\b/i;

let cachedPrompt = null;

async function loadSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    const res = await fetch('/prompt_chat.txt');
    cachedPrompt = res.ok ? (await res.text()).trim() : '';
  } catch {
    cachedPrompt = '';
  }
  return cachedPrompt;
}

function buildChatHistory(systemInstruction, history, userContext) {
  const baseHistory = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const instructions = [systemInstruction, userContext].filter(Boolean).join('\n\n');

  if (instructions) {
    return [
      { role: 'user', parts: [{ text: `Follow these instructions in every response:\n\n${instructions}` }] },
      { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
      ...baseHistory,
    ];
  }
  return baseHistory;
}

// ── Streaming chat (search or code execution) ────────────────────────────────

export const streamChat = async function* (history, newMessage, imageParts = [], useCodeExecution = false, userContext = '') {
  const systemInstruction = await loadSystemPrompt();
  const tools = useCodeExecution ? [CODE_EXEC_TOOL] : [SEARCH_TOOL];
  const model = genAI.getGenerativeModel({ model: MODEL, tools });

  const chatHistory = buildChatHistory(systemInstruction, history, userContext);
  const chat = model.startChat({ history: chatHistory });

  const parts = [
    { text: newMessage },
    ...imageParts.map((img) => ({
      inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
    })),
  ].filter((p) => p.text !== undefined || p.inlineData !== undefined);

  const result = await chat.sendMessageStream(parts);

  for await (const chunk of result.stream) {
    const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of chunkParts) {
      if (part.text) yield { type: 'text', text: part.text };
    }
  }

  const response = await result.response;
  const allParts = response.candidates?.[0]?.content?.parts || [];

  const hasCodeExecution = allParts.some(
    (p) =>
      p.executableCode ||
      p.codeExecutionResult ||
      (p.inlineData && p.inlineData.mimeType?.startsWith('image/'))
  );

  if (hasCodeExecution) {
    const structuredParts = allParts
      .map((p) => {
        if (p.text) return { type: 'text', text: p.text };
        if (p.executableCode)
          return { type: 'code', language: p.executableCode.language || 'PYTHON', code: p.executableCode.code };
        if (p.codeExecutionResult)
          return { type: 'result', outcome: p.codeExecutionResult.outcome, output: p.codeExecutionResult.output };
        if (p.inlineData)
          return { type: 'image', mimeType: p.inlineData.mimeType, data: p.inlineData.data };
        return null;
      })
      .filter(Boolean);
    yield { type: 'fullResponse', parts: structuredParts };
  }

  const grounding = response.candidates?.[0]?.groundingMetadata;
  if (grounding) yield { type: 'grounding', data: grounding };
};

// ── Function-calling chat for CSV tools ──────────────────────────────────────

export const chatWithCsvTools = async (history, newMessage, csvHeaders, executeFn) => {
  const systemInstruction = await loadSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [{ functionDeclarations: CSV_TOOL_DECLARATIONS }],
  });

  const chatHistory = buildChatHistory(systemInstruction, history, '');
  const chat = model.startChat({ history: chatHistory });

  const msgWithContext = csvHeaders?.length
    ? `[CSV columns: ${csvHeaders.join(', ')}]\n\n${newMessage}`
    : newMessage;

  let response = (await chat.sendMessage(msgWithContext)).response;

  const charts = [];
  const toolCalls = [];

  for (let round = 0; round < 5; round++) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const funcCall = parts.find((p) => p.functionCall);
    if (!funcCall) break;

    const { name, args } = funcCall.functionCall;
    const toolResult = executeFn(name, args);
    toolCalls.push({ name, args, result: toolResult });
    if (toolResult?._chartType) charts.push(toolResult);

    response = (
      await chat.sendMessage([{ functionResponse: { name, response: { result: toolResult } } }])
    ).response;
  }

  return { text: response.text(), charts, toolCalls };
};

// ── Function-calling chat for JSON (YouTube data) tools ──────────────────────

export const chatWithJsonTools = async (history, newMessage, jsonFields, executeFn, userContext = '') => {
  const systemInstruction = await loadSystemPrompt();
  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [{ functionDeclarations: JSON_TOOL_DECLARATIONS }],
  });

  const chatHistory = buildChatHistory(systemInstruction, history, userContext);
  const chat = model.startChat({ history: chatHistory });

  const msgWithContext = jsonFields?.length
    ? `[JSON fields: ${jsonFields.join(', ')}]\n\n${newMessage}`
    : newMessage;

  let response = (await chat.sendMessage(msgWithContext)).response;

  const charts = [];
  const videoCards = [];
  const toolCalls = [];
  let imageGenRequest = null;

  for (let round = 0; round < 5; round++) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const funcCall = parts.find((p) => p.functionCall);
    if (!funcCall) break;

    const { name, args } = funcCall.functionCall;
    let toolResult = executeFn(name, args);
    toolCalls.push({ name, args, result: toolResult });

    if (toolResult?._chartType) charts.push(toolResult);
    if (toolResult?._cardType === 'video') videoCards.push(toolResult);
    if (toolResult?._actionType === 'generateImage') imageGenRequest = toolResult;

    // Send a clean summary to Gemini so it writes natural text, not raw JSON
    let geminiResult = toolResult;
    if (toolResult?._cardType === 'video') {
      geminiResult = { status: 'success', message: `Now showing video card for "${toolResult.title}" (${Number(toolResult.viewCount).toLocaleString()} views). The card is displayed to the user with a clickable thumbnail that opens on YouTube.` };
    } else if (toolResult?._chartType) {
      geminiResult = { status: 'success', message: `Chart "${toolResult.chartTitle}" is now displayed to the user with ${toolResult.data?.length} data points. The user can enlarge and download it.` };
    } else if (toolResult?._actionType === 'generateImage') {
      geminiResult = { status: 'success', message: 'Image is being generated and will be displayed to the user.' };
    }

    response = (
      await chat.sendMessage([{ functionResponse: { name, response: { result: geminiResult } } }])
    ).response;
  }

  return { text: response.text(), charts, videoCards, toolCalls, imageGenRequest };
};

// ── Image generation using Gemini (direct REST call for reliability) ──────────

export const generateImageWithGemini = async (prompt, anchorImageParts = []) => {
  const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;

  const parts = [
    { text: prompt },
    ...anchorImageParts.map((img) => ({
      inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
    })),
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Image generation failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const responseParts = data.candidates?.[0]?.content?.parts || [];

  let imageData = null;
  let textResponse = '';

  for (const part of responseParts) {
    if (part.inlineData) {
      imageData = {
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      };
    }
    if (part.text) textResponse += part.text;
  }

  return { imageData, textResponse };
};
