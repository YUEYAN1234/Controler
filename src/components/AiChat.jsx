import React, { useState, useRef, useEffect } from 'react';
import { getChatSession, getChatSessions, streamChatMessage } from '../api';
import { useAuth } from '../AuthContext';

const DEFAULT_PROGRESS_ITEM = {
  phase: 'pending',
  label: '正在发送请求',
  detail: '等待服务器响应',
};

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const ACCEPTED_ATTACHMENTS = [
  'image/*',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.json',
  '.html',
  '.css',
  '.js',
  '.xml',
].join(',');

function formatFileSize(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function getAttachmentIcon(attachment) {
  const kind = attachment.kind || '';
  const name = attachment.name || attachment.file?.name || '';
  const type = attachment.mimeType || attachment.file?.type || '';
  const ext = name.split('.').pop()?.toLowerCase();

  if (kind === 'image' || type.startsWith('image/')) return 'IMG';
  if (kind === 'pdf' || ext === 'pdf') return 'PDF';
  if (kind === 'word' || ['doc', 'docx'].includes(ext)) return 'DOC';
  if (kind === 'excel' || ['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS';
  return 'TXT';
}

function getAttachmentName(attachment) {
  return attachment.name || attachment.file?.name || '附件';
}

function getAttachmentSize(attachment) {
  return attachment.size || attachment.file?.size || 0;
}

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSessionTime(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTeamLabel(team) {
  if (team === 'control') return '控制组';
  if (team === 'power') return '动力组';
  return '公共';
}

function renderInline(text, keyPrefix) {
  const nodes = [];
  const pattern = /(`[^`]+`|\*\*[\s\S]+?\*\*|__[\s\S]+?__|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), `${key}-strong`)}</strong>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map(cell => cell.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isDiagramBlock(text) {
  const source = String(text || '').trim();
  if (!source) return false;

  const lines = source.split('\n');
  if (lines.length < 2) return false;

  const boxChars = /[┌┐└┘├┤┬┴┼─│━┃═╔╗╚╝╠╣╦╩╬]/;
  const arrowChars = /(?:--?>|<--?|==?>|=>|←|→|↑|↓|↔)/;
  const shortLineCount = lines.filter(line => line.trim().length <= 120).length;

  return boxChars.test(source) || arrowChars.test(source) || shortLineCount >= Math.max(2, Math.ceil(lines.length * 0.7));
}

function MarkdownMessage({ content }) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let listType = 'ul';
  let codeLines = null;
  let codeLang = '';

  const pushCodeBlock = () => {
    const codeText = codeLines.join('\n');
    const plainLanguage = !codeLang || /^(text|txt|plain|diagram|flow)$/i.test(codeLang);
    const blockClassName = [
      codeLang ? `language-${codeLang}` : '',
      plainLanguage && isDiagramBlock(codeText) ? 'chat-diagram-block' : '',
    ].filter(Boolean).join(' ');

    blocks.push(
      <pre key={`code-${blocks.length}`} className={blockClassName || undefined}>
        <code>{codeText}</code>
      </pre>
    );
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    if (text) {
      blocks.push(
        <p key={`p-${blocks.length}`}>
          {renderInline(text, `p-${blocks.length}`)}
        </p>
      );
    }
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const Tag = listType;
    blocks.push(
      <Tag key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={index}>{renderInline(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </Tag>
    );
    listItems = [];
    listType = 'ul';
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (codeLines) {
      if (trimmed.startsWith('```')) {
        pushCodeBlock();
        codeLines = null;
        codeLang = '';
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushAll();
      codeLines = [];
      codeLang = trimmed.slice(3).trim();
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = Math.min(headingMatch[1].length, 4);
      const Tag = `h${level}`;
      blocks.push(
        <Tag key={`h-${blocks.length}`}>
          {renderInline(headingMatch[2], `h-${blocks.length}`)}
        </Tag>
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushAll();
      const headers = splitTableRow(trimmed);
      i += 1;
      const rows = [];
      while (i + 1 < lines.length && lines[i + 1].trim().includes('|') && lines[i + 1].trim()) {
        i += 1;
        rows.push(splitTableRow(lines[i]));
      }
      blocks.push(
        <div className="chat-table-wrap" key={`table-${blocks.length}`}>
          <table>
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={index}>{renderInline(header, `th-${blocks.length}-${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex}>{renderInline(row[cellIndex] || '', `td-${blocks.length}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushAll();
      const quoteLines = [quoteMatch[1]];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) {
        i += 1;
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
      }
      blocks.push(
        <blockquote key={`quote-${blocks.length}`}>
          {quoteLines.map((quoteLine, index) => (
            <p key={index}>{renderInline(quoteLine, `quote-${blocks.length}-${index}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    const listMatch = trimmed.match(/^((?:[-*+])|\d+\.)\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const nextType = /^\d+\.$/.test(listMatch[1]) ? 'ol' : 'ul';
      if (listItems.length > 0 && listType !== nextType) flushList();
      listType = nextType;
      listItems.push(listMatch[2]);
      continue;
    }

    paragraph.push(line);
  }

  if (codeLines) {
    pushCodeBlock();
  }
  flushAll();

  return <div className="chat-markdown">{blocks.length > 0 ? blocks : <p></p>}</div>;
}

function normalizeProgressItem(status) {
  const label = String(status?.label || '').trim();
  return {
    phase: String(status?.phase || 'status'),
    label: label || DEFAULT_PROGRESS_ITEM.label,
    detail: String(status?.detail || '').trim(),
    at: status?.at || new Date().toISOString(),
  };
}

function mergeProgressItems(items = [], status) {
  const nextItem = normalizeProgressItem(status);
  const previous = items[items.length - 1];

  if (previous && previous.phase === nextItem.phase && previous.label === nextItem.label) {
    return [...items.slice(0, -1), nextItem];
  }

  return [...items, nextItem].slice(-8);
}

function ThinkingProgress({ items = [] }) {
  const progressItems = items.length > 0 ? items : [DEFAULT_PROGRESS_ITEM];
  const activeIndex = progressItems.length - 1;
  const currentItem = progressItems[activeIndex] || DEFAULT_PROGRESS_ITEM;
  const progressPercent = currentItem.phase === 'done'
    ? 100
    : Math.min(92, Math.max(18, progressItems.length * 18));

  return (
    <div className="chat-progress" role="status" aria-live="polite">
      <div className="chat-progress-header">
        <span className="chat-progress-status">
          <span className="chat-progress-status-dot" aria-hidden="true"></span>
          正在处理
        </span>
        <span className="chat-progress-current">{currentItem.label}</span>
        <span className="chat-progress-dots" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </div>
      <div className="chat-progress-rail" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }}></span>
      </div>
      <div className="chat-progress-steps">
        {progressItems.map((item, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
          return (
            <div
              key={`${item.phase}-${item.label}-${index}`}
              className={`chat-progress-step chat-progress-step-${state}`}
            >
              <span className="chat-progress-dot" aria-hidden="true">
                {state === 'done' ? '✓' : ''}
              </span>
              <span className="chat-progress-step-body">
                <span className="chat-progress-step-label">{item.label}</span>
                {item.detail && <span className="chat-progress-step-detail">{item.detail}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttachmentList({ attachments, onRemove, compact = false }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className={`chat-attachments ${compact ? 'chat-attachments-compact' : ''}`}>
      {attachments.map((attachment, index) => (
        <div className="chat-attachment-chip" key={attachment.id || `${getAttachmentName(attachment)}-${index}`}>
          <span className="chat-attachment-icon">{getAttachmentIcon(attachment)}</span>
          <span className="chat-attachment-info">
            <span className="chat-attachment-name">{getAttachmentName(attachment)}</span>
            <span className="chat-attachment-meta">
              {formatFileSize(getAttachmentSize(attachment))}
              {attachment.note ? ` · ${attachment.note}` : ''}
            </span>
          </span>
          {onRemove && (
            <button
              type="button"
              className="chat-attachment-remove"
              onClick={() => onRemove(attachment.id)}
              aria-label={`移除附件 ${getAttachmentName(attachment)}`}
              title="移除附件"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AiChat({ onBusyChange, onBackgroundDone }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatTeam, setChatTeam] = useState('all');
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [draggingAttachment, setDraggingAttachment] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const messagesListRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const inputRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const attachmentDragCounterRef = useRef(0);
  const streamAbortRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const activeAssistantIdRef = useRef(null);

  const typingMessageId = messages.find(msg => msg.role === 'assistant' && msg.status === 'typing')?.id;
  const streamingMessageId = messages.find(msg => msg.role === 'assistant' && msg.status === 'streaming')?.id;
  const busy = loading || streaming || Boolean(typingMessageId) || Boolean(streamingMessageId);
  const busyRef = useRef(busy);

  const scrollToBottom = (behavior = 'auto') => {
    const el = messagesListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const syncAutoScrollState = () => {
    const el = messagesListRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await getChatSessions();
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const loadSession = async (sessionId) => {
    if (busy || sessionLoading) return;

    setSessionLoading(true);
    try {
      const data = await getChatSession(sessionId);
      const loadedMessages = (data.messages || []).map(msg => ({
        id: `history-${msg.id}`,
        role: msg.role,
        content: msg.content,
        displayContent: msg.content,
        status: 'done',
        attachments: msg.attachments || [],
        progressItems: [],
      }));
      stickToBottomRef.current = true;
      setMessages(loadedMessages);
      setCurrentSessionId(data.session.id);
      setChatTeam(data.session.team || 'all');
      setHistoryOpen(false);
      setPendingAttachments([]);
    } catch (err) {
      alert(err.message);
    } finally {
      setSessionLoading(false);
    }
  };

  const startNewChat = () => {
    if (busy) return;
    stickToBottomRef.current = true;
    setCurrentSessionId(null);
    setMessages([]);
    setInput('');
    setPendingAttachments([]);
    inputRef.current?.focus();
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => () => {
    streamAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom('auto');
    }
  }, [messages, loading]);

  useEffect(() => {
    const wasBusy = busyRef.current;
    busyRef.current = busy;
    onBusyChange?.(busy);
    if (wasBusy && !busy) {
      onBackgroundDone?.();
    }
  }, [busy, onBusyChange, onBackgroundDone]);

  const addAttachments = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    const accepted = [];
    const rejected = [];
    const currentKeys = new Set(
      pendingAttachments.map(item => `${item.file.name}-${item.file.size}-${item.file.lastModified}`)
    );

    for (const file of incoming) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (currentKeys.has(key)) continue;
      if (file.size > MAX_ATTACHMENT_SIZE) {
        rejected.push(`${file.name} 超过 ${formatFileSize(MAX_ATTACHMENT_SIZE)}`);
        continue;
      }
      if (pendingAttachments.length + accepted.length >= MAX_ATTACHMENTS) {
        rejected.push(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
        break;
      }
      accepted.push({
        id: createMessageId(),
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type,
      });
      currentKeys.add(key);
    }

    if (accepted.length > 0) {
      setPendingAttachments(prev => [...prev, ...accepted]);
    }
    if (rejected.length > 0) {
      alert(rejected.join('\n'));
    }
  };

  const removeAttachment = (id) => {
    setPendingAttachments(prev => prev.filter(item => item.id !== id));
  };

  const handleAttachmentSelect = (e) => {
    addAttachments(e.target.files);
    e.target.value = '';
  };

  const handleChatDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    attachmentDragCounterRef.current += 1;
    setDraggingAttachment(true);
  };

  const handleChatDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleChatDragLeave = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    attachmentDragCounterRef.current -= 1;
    if (attachmentDragCounterRef.current <= 0) {
      attachmentDragCounterRef.current = 0;
      setDraggingAttachment(false);
    }
  };

  const handleChatDrop = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    attachmentDragCounterRef.current = 0;
    setDraggingAttachment(false);
    addAttachments(e.dataTransfer.files);
  };

  const markStreamStopped = () => {
    const activeAssistantId = activeAssistantIdRef.current;
    setMessages(prev => {
      let found = false;
      const next = prev.map(msg => {
        if (msg.id !== activeAssistantId) return msg;
        found = true;
        if (msg.status === 'stopped') return msg;
        const content = msg.displayContent || msg.content || '已停止输出。';
        return {
          ...msg,
          content,
          displayContent: content,
          status: 'stopped'
        };
      });

      if (found) return next;
      return [
        ...next,
        {
          id: activeAssistantId || createMessageId(),
          role: 'assistant',
          content: '已停止输出。',
          displayContent: '已停止输出。',
          status: 'stopped',
          progressItems: [],
        }
      ];
    });
  };

  const handleStopStreaming = () => {
    if (!busy) return;
    stopRequestedRef.current = true;
    streamAbortRef.current?.abort();
    setLoading(false);
    setStreaming(false);
    markStreamStopped();
    setTimeout(loadSessions, 600);
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || busy) return;

    const attachmentsForSend = pendingAttachments;
    const userContent = text || '请根据我上传的附件进行分析和回答。';
    const assistantMsgId = createMessageId();
    const abortController = new AbortController();
    let assistantText = '';

    const userMsg = {
      id: createMessageId(),
      role: 'user',
      content: userContent,
      displayContent: userContent,
      status: 'done',
      attachments: attachmentsForSend.map(item => ({
        id: item.id,
        name: item.name,
        size: item.size,
        mimeType: item.mimeType,
      })),
    };
    const requestMessages = [...messages, userMsg];
    const assistantMsg = {
      id: assistantMsgId,
      role: 'assistant',
        content: '',
        displayContent: '',
        status: 'streaming',
        progressItems: [normalizeProgressItem(DEFAULT_PROGRESS_ITEM)],
    };
    const newMessages = [...requestMessages, assistantMsg];
    stickToBottomRef.current = true;
    setMessages(newMessages);
    setInput('');
    setPendingAttachments([]);
    setLoading(true);
    setStreaming(false);
    stopRequestedRef.current = false;
    streamAbortRef.current = abortController;
    activeAssistantIdRef.current = assistantMsgId;

    try {
      await streamChatMessage(
        requestMessages.map(m => ({ role: m.role, content: m.content })),
        chatTeam,
        currentSessionId,
        attachmentsForSend.map(item => item.file),
        {
          signal: abortController.signal,
          onEvent: ({ type, data }) => {
            if (type === 'session' && data.sessionId) {
              setCurrentSessionId(data.sessionId);
            }

            if (type === 'attachments' && data.attachments?.length > 0) {
              setMessages(prev => prev.map(msg => (
                msg.id === userMsg.id
                  ? { ...msg, attachments: data.attachments }
                  : msg
              )));
            }

            if (type === 'status') {
              setMessages(prev => prev.map(msg => (
                msg.id === assistantMsgId
                  ? { ...msg, progressItems: mergeProgressItems(msg.progressItems, data), status: 'streaming' }
                  : msg
              )));
            }

            if (type === 'delta' && data.content) {
              assistantText += data.content;
              setLoading(false);
              setStreaming(true);
              setMessages(prev => {
                const exists = prev.some(msg => msg.id === assistantMsgId);
                if (!exists) {
                  return [
                    ...prev,
                    {
                      id: assistantMsgId,
                      role: 'assistant',
                      content: assistantText,
                      displayContent: assistantText,
                      status: 'streaming',
                      progressItems: [normalizeProgressItem({ phase: 'model', label: '正在生成回答', detail: '接收回答内容' })],
                    }
                  ];
                }

                return prev.map(msg => (
                  msg.id === assistantMsgId
                    ? { ...msg, content: assistantText, displayContent: assistantText, status: 'streaming', progressItems: [] }
                    : msg
                ));
              });
            }

            if (type === 'done') {
              setLoading(false);
              setStreaming(false);
              setMessages(prev => prev.map(msg => (
                msg.id === assistantMsgId
                  ? { ...msg, content: assistantText || msg.content, displayContent: assistantText || msg.displayContent, status: 'done', progressItems: [] }
                  : msg
              )));
            }
          }
        }
      );

      if (!assistantText && !stopRequestedRef.current) {
        setMessages(prev => prev.map(msg => (
          msg.id === assistantMsgId
            ? {
              ...msg,
              content: '已处理请求，但未生成内容。',
              displayContent: '已处理请求，但未生成内容。',
              status: 'done',
              progressItems: [],
            }
            : msg
        )));
      }

      setMessages(prev => prev.map(msg => (
        msg.id === assistantMsgId && msg.status === 'streaming'
          ? { ...msg, status: 'done', progressItems: [] }
          : msg
      )));
      loadSessions();
    } catch (err) {
      if (err.name === 'AbortError' || stopRequestedRef.current) {
        markStreamStopped();
      } else {
        const errorContent = '抱歉，请求失败：' + err.message;
        setMessages(prev => {
          let found = false;
          const next = prev.map(msg => {
            if (msg.id !== assistantMsgId) return msg;
            found = true;
            return {
              ...msg,
              content: errorContent,
              displayContent: errorContent,
              status: 'done',
              progressItems: [],
            };
          });

          if (found) return next;
          return [...next, {
            id: assistantMsgId,
            role: 'assistant',
            content: errorContent,
            displayContent: errorContent,
            status: 'done',
            progressItems: [],
          }];
        });
      }
    } finally {
      setLoading(false);
      setStreaming(false);
      streamAbortRef.current = null;
      activeAssistantIdRef.current = null;
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 className="page-title" style={{ marginBottom: 0 }}>Conter 智能助手</h2>
          <div className="team-switcher">
            <button className={`team-btn ${chatTeam === 'control' ? 'team-btn-active' : ''}`} onClick={() => setChatTeam('control')}>控制组</button>
            <button className={`team-btn ${chatTeam === 'all' ? 'team-btn-active' : ''}`} onClick={() => setChatTeam('all')}>公共</button>
            <button className={`team-btn ${chatTeam === 'power' ? 'team-btn-active' : ''}`} onClick={() => setChatTeam('power')}>动力组</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.7rem' }}>
          <button className="btn btn-ghost" onClick={() => setHistoryOpen(v => !v)} style={{ fontSize: '0.85rem' }} disabled={busy && !historyOpen}>
            {historyOpen ? '收起历史' : '历史会话'}
          </button>
          <button className="btn btn-primary" onClick={startNewChat} style={{ fontSize: '0.85rem' }} disabled={busy}>
            新对话
          </button>
        </div>
      </div>

      <div
        className={`chat-container glass-panel ${draggingAttachment ? 'chat-container-dragging' : ''}`}
        onDragEnter={handleChatDragEnter}
        onDragOver={handleChatDragOver}
        onDragLeave={handleChatDragLeave}
        onDrop={handleChatDrop}
      >
        {draggingAttachment && (
          <div className="chat-attachment-drop-overlay">
            <div className="chat-attachment-drop-card">
              <div className="chat-attachment-drop-icon">+</div>
              <div>松开鼠标添加附件</div>
            </div>
          </div>
        )}
        <div className="chat-body">
          {historyOpen && (
            <aside className="chat-history-panel">
              <div className="chat-history-header">
                <span>我的会话</span>
                <button className="btn btn-ghost" onClick={loadSessions} disabled={sessionsLoading || busy} style={{ fontSize: '0.78rem' }}>
                  刷新
                </button>
              </div>
              <div className="chat-history-list">
                {sessionsLoading ? (
                  <div className="chat-history-empty">加载中...</div>
                ) : sessions.length === 0 ? (
                  <div className="chat-history-empty">暂无历史会话</div>
                ) : (
                  sessions.map(session => (
                    <button
                      key={session.id}
                      type="button"
                      className={`chat-history-item ${Number(currentSessionId) === Number(session.id) ? 'chat-history-item-active' : ''}`}
                      onClick={() => loadSession(session.id)}
                      disabled={busy || sessionLoading}
                    >
                      <div className="chat-history-item-title">{session.title}</div>
                      <div className="chat-history-item-meta">
                        <span>{getTeamLabel(session.team)}</span>
                        <span>{session.message_count || 0} 条</span>
                      </div>
                      <div className="chat-history-item-time">{formatSessionTime(session.updated_at)}</div>
                      {session.last_message && (
                        <div className="chat-history-item-preview">{session.last_message}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </aside>
          )}

          <div className="chat-main">
            <div className="chat-messages" ref={messagesListRef} onScroll={syncAutoScrollState}>
              {messages.length === 0 && !sessionLoading && (
                <div className="chat-welcome">
                  <div className="chat-welcome-icon">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L13.5 8.5L20 7L15 12L20 17L13.5 15.5L12 22L10.5 15.5L4 17L9 12L4 7L10.5 8.5L12 2Z" fill="rgba(255,255,255,0.9)" />
                    </svg>
                  </div>
                  <div className="chat-welcome-title">你好，我是 Conter</div>
                  <div className="chat-welcome-desc">
                    我是 Chem-E-Car 实验数据平台的 AI 助手，同时服务控制组与动力组，可以帮你查询平台信息、分析实验数据、回答技术问题。
                  </div>
                  <div className="chat-welcome-hints">
                    <div className="chat-hint" onClick={() => { setInput('最近有什么公告？'); }}>最近有什么公告？</div>
                    <div className="chat-hint" onClick={() => { setInput('控制组今天有预约吗？'); }}>控制组今天有预约吗？</div>
                    <div className="chat-hint" onClick={() => { setInput('动力组最近上传了哪些文件？'); }}>动力组最近上传了哪些文件？</div>
                    <div className="chat-hint" onClick={() => { setInput('Chem-E-Car 是什么比赛？'); }}>Chem-E-Car 是什么比赛？</div>
                  </div>
                </div>
              )}

              {sessionLoading && (
                <div className="chat-session-loading">正在读取会话...</div>
              )}

              {messages.map((msg) => {
                const isAssistantWaiting = msg.role === 'assistant'
                  && (msg.status === 'typing' || msg.status === 'streaming')
                  && !(msg.displayContent || msg.content);

                return (
                  <div key={msg.id} className={`chat-msg ${msg.role === 'user' ? 'chat-msg-user' : 'chat-msg-ai'}`}>
                    <div className="chat-msg-avatar">
                      {msg.role === 'user'
                        ? user.displayName?.charAt(0).toUpperCase()
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L13.5 8.5L20 7L15 12L20 17L13.5 15.5L12 22L10.5 15.5L4 17L9 12L4 7L10.5 8.5L12 2Z" fill="#fff" /></svg>
                      }
                    </div>
                    <div className={`chat-msg-bubble ${isAssistantWaiting ? 'chat-progress-bubble' : ''}`}>
                      <div className="chat-msg-name">
                        {msg.role === 'user' ? user.displayName : 'Conter'}
                      </div>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <AttachmentList attachments={msg.attachments} compact />
                      )}
                      {isAssistantWaiting ? (
                        <ThinkingProgress items={msg.progressItems} />
                      ) : (
                        <div className={`chat-msg-text ${msg.role === 'user' ? 'chat-msg-text-user' : 'chat-msg-text-ai'} ${msg.status === 'typing' || msg.status === 'streaming' ? 'chat-msg-streaming' : ''}`}>
                          {msg.role === 'assistant'
                            ? <MarkdownMessage content={msg.displayContent || ''} />
                            : <span>{msg.content}</span>
                          }
                          {(msg.status === 'typing' || msg.status === 'streaming') && <span className="chat-caret"></span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {loading && !messages.some(msg => msg.id === activeAssistantIdRef.current && msg.role === 'assistant') && (
                <div className="chat-msg chat-msg-ai">
                  <div className="chat-msg-avatar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L13.5 8.5L20 7L15 12L20 17L13.5 15.5L12 22L10.5 15.5L4 17L9 12L4 7L10.5 8.5L12 2Z" fill="#fff" /></svg>
                  </div>
                  <div className="chat-msg-bubble chat-progress-bubble">
                    <div className="chat-msg-name">Conter</div>
                    <ThinkingProgress />
                  </div>
                </div>
              )}
            </div>

            <div className="chat-input-bar">
              <div className="chat-input-stack">
                <AttachmentList attachments={pendingAttachments} onRemove={removeAttachment} />
                <textarea
                  ref={inputRef}
                  className="chat-input"
                  placeholder={pendingAttachments.length > 0 ? '输入问题，或直接发送附件...' : '输入你的问题...'}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={busy}
                />
              </div>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={ACCEPTED_ATTACHMENTS}
                onChange={handleAttachmentSelect}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="chat-attach-btn"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={busy || pendingAttachments.length >= MAX_ATTACHMENTS}
                aria-label="添加附件"
                title="添加附件"
              >
                +
              </button>
              {busy ? (
                <button
                  type="button"
                  className="chat-stop-btn"
                  onClick={handleStopStreaming}
                  aria-label="停止输出"
                  title="停止输出"
                >
                  <span aria-hidden="true"></span>
                </button>
              ) : (
                <button
                  type="button"
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!input.trim() && pendingAttachments.length === 0}
                  aria-label="发送"
                  title="发送"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AiChat;
