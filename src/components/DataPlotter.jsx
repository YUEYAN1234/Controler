import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { FaChartLine } from 'react-icons/fa';
import { getDownloadUrl } from '../api';

const DEFAULT_COLORS = ['#EF553B', '#00CC96', '#AB63FA', '#FFA15A', '#19D3F3', '#FF6692'];
const FALLBACK_COLOR = '#999999';
const MAX_DATA_ROWS = 10000;
const MAX_PLOT_POINTS = 1000;
const METRICS = ['R', 'G', 'B', 'Sum', 'AvgSum'];
const groupDataCache = new WeakMap();
const platformWorkbookCache = new Map();
let plotlyPromise = null;

function loadPlotly() {
  if (!plotlyPromise) {
    plotlyPromise = import('plotly.js-dist-min').then(module => module.default || module);
  }
  return plotlyPromise;
}

function waitForFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function getThemeMode() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function useThemeMode() {
  const [themeMode, setThemeMode] = useState(() => getThemeMode());

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeMode(getThemeMode());
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return themeMode;
}

function mkKey(fileIdx, groupIdx) {
  return `f${fileIdx}_g${groupIdx}`;
}

function parseKey(key) {
  const match = /^f(\d+)_g(\d+)$/.exec(key);
  return match ? { fileIdx: Number(match[1]), groupIdx: Number(match[2]) } : null;
}

function createPage(index, name) {
  return {
    id: `p${index}_${Date.now()}`,
    name: name || `页面 ${index}`,
    files: [],
    currentSheet: '',
    currentMetric: 'AvgSum',
    conditionGroups: [],
    nextGroupId: 1,
    showLegend: true,
    manualMode: false,
    manualXName: '',
    manualYName: '',
    manualYOffset: 1,
    manualYCount: 1,
    manualExactMatch: true,
    manualConfirmed: false
  };
}

function clonePages(pages) {
  return pages.map(page => ({
    ...page,
    files: [...page.files],
    conditionGroups: page.conditionGroups.map(group => ({
      ...group,
      indices: [...group.indices]
    }))
  }));
}

function analyzeSheet(raw) {
  if (raw.length < 2) return { timeIndices: [], groups: [], labels: {} };

  const header = raw[0];
  const timeIndices = [];
  const labels = {};
  const ignored = new Set(['time(s)', 'r', 'g', 'b', 'sum', 'filtered', 'avgsum']);

  for (let i = 0; i < header.length; i += 1) {
    const value = header[i];
    if (value !== null && value !== undefined && String(value).toLowerCase().includes('time')) {
      timeIndices.push(i);
    }
    if (value !== null && value !== undefined && !ignored.has(String(value).toLowerCase().trim())) {
      labels[i] = String(value);
    }
  }

  const groups = timeIndices.map((startCol, groupIndex) => ({
    index: groupIndex + 1,
    data: null,
    rows: raw.length - 1,
    timeRange: [0, 0],
    _raw: raw,
    _startCol: startCol
  }));

  return { timeIndices, groups, labels };
}

function buildGroupData(raw, startCol) {
  const data = [];
  const stride = Math.max(1, Math.floor((raw.length - 1) / MAX_PLOT_POINTS));

  for (let rowIndex = 1; rowIndex < raw.length; rowIndex += stride) {
    const row = raw[rowIndex];
    const time = Number.parseFloat(row[startCol]);
    if (!Number.isNaN(time)) {
      data.push({
        time,
        R: Number.parseFloat(row[startCol + 1]) || 0,
        G: Number.parseFloat(row[startCol + 2]) || 0,
        B: Number.parseFloat(row[startCol + 3]) || 0,
        Sum: Number.parseFloat(row[startCol + 4]) || 0,
        AvgSum: Number.parseFloat(row[startCol + 5]) || 0
      });
    }
  }

  if (data.length < 10 && stride > 1) {
    data.length = 0;
    for (let rowIndex = 1; rowIndex < raw.length; rowIndex += 1) {
      const row = raw[rowIndex];
      const time = Number.parseFloat(row[startCol]);
      if (!Number.isNaN(time)) {
        data.push({
          time,
          R: Number.parseFloat(row[startCol + 1]) || 0,
          G: Number.parseFloat(row[startCol + 2]) || 0,
          B: Number.parseFloat(row[startCol + 3]) || 0,
          Sum: Number.parseFloat(row[startCol + 4]) || 0,
          AvgSum: Number.parseFloat(row[startCol + 5]) || 0
        });
      }
    }
  }

  return data;
}

function buildManualSheetInfo(raw, page) {
  if (raw.length < 2) return { timeIndices: [], groups: [], labels: {} };

  const dataRows = raw.length > MAX_DATA_ROWS ? MAX_DATA_ROWS : raw.length;
  const headerRow = raw[0];
  const xName = (page.manualXName || '').trim();
  const yName = (page.manualYName || '').trim();
  const yOffset = page.manualYOffset || 1;
  const yCount = page.manualYCount || 1;
  const exactMatch = page.manualExactMatch || false;

  if (!xName) return { timeIndices: [], groups: [], labels: {} };

  const colMatches = (headerValue, searchName) => {
    if (headerValue === null || headerValue === undefined) return false;
    if (!searchName) return true;
    const header = String(headerValue);
    return exactMatch ? header === searchName : header.includes(searchName);
  };

  const xCols = [];
  for (let i = 0; i < headerRow.length; i += 1) {
    if (colMatches(headerRow[i], xName)) xCols.push(i);
  }

  if (xCols.length === 0) return { timeIndices: [], groups: [], labels: {} };

  const groups = [];
  let groupIndex = 0;

  xCols.forEach(xCol => {
    const yStart = xCol + yOffset;
    if (yStart < 0 || yStart + yCount > headerRow.length) return;

    if (yName) {
      let anyMatch = false;
      for (let i = 0; i < yCount; i += 1) {
        if (colMatches(headerRow[yStart + i], yName)) {
          anyMatch = true;
          break;
        }
      }
      if (!anyMatch) return;
    }

    const stride = Math.max(1, Math.floor((dataRows - 1) / MAX_PLOT_POINTS));
    const groupData = [];

    for (let rowIndex = 1; rowIndex < dataRows; rowIndex += stride) {
      const row = raw[rowIndex];
      const xValue = Number.parseFloat(row[xCol]);
      if (Number.isNaN(xValue)) continue;

      const yValues = [];
      for (let i = 0; i < yCount; i += 1) {
        yValues.push(Number.parseFloat(row[yStart + i]) || 0);
      }

      const sum = yValues.reduce((total, value) => total + value, 0);
      groupData.push({
        time: xValue,
        R: yValues[0] || 0,
        G: yValues[1] || 0,
        B: yValues[2] || 0,
        Sum: sum,
        AvgSum: yValues.length > 0 ? sum / yValues.length : yValues[0] || 0
      });
    }

    if (groupData.length > 0) {
      groupIndex += 1;
      const headerParts = [];
      for (let i = 0; i < yCount && yStart + i < headerRow.length; i += 1) {
        const header = headerRow[yStart + i];
        if (header !== null && header !== undefined && String(header).trim() !== '') {
          headerParts.push(String(header).trim());
        }
      }

      groups.push({
        index: groupIndex,
        data: groupData,
        rows: groupData.length,
        timeRange: [groupData[0].time, groupData[groupData.length - 1].time],
        autoName: headerParts.length > 0 ? headerParts.join('/') : `列${yStart}-${yStart + yCount - 1}`
      });
    }
  });

  return { timeIndices: xCols, groups, labels: {} };
}

function getUsableSheetNames(file, manualMode) {
  const source = manualMode ? file.workbookData : file.sheetsInfo;
  if (!source) return [];

  if (manualMode) {
    return Object.keys(source).filter(name => source[name] && source[name].length > 1);
  }

  return Object.keys(source).filter(name => source[name]?.groups?.length > 0);
}

function getSheetNameForFile(file, page) {
  const sheetNames = getUsableSheetNames(file, page.manualMode);
  if (sheetNames.length === 0) return '';
  if (page.currentSheet && sheetNames.includes(page.currentSheet)) return page.currentSheet;
  return sheetNames[0];
}

function getSheetInfoForFile(file, page) {
  const sheetName = getSheetNameForFile(file, page);
  if (!sheetName) return null;

  if (page.manualMode && page.manualConfirmed) {
    const raw = file.workbookData[sheetName];
    return raw ? buildManualSheetInfo(raw, page) : null;
  }

  return file.sheetsInfo[sheetName] || null;
}

function getAllGroups(page) {
  const result = [];

  page.files.forEach((file, fileIdx) => {
    const info = getSheetInfoForFile(file, page);
    if (!info) return;

    info.groups.forEach(group => {
      let normalizedGroup = group;
      if (!normalizedGroup.data && normalizedGroup._raw) {
        let data = groupDataCache.get(normalizedGroup);
        if (!data) {
          data = buildGroupData(normalizedGroup._raw, normalizedGroup._startCol);
          groupDataCache.set(normalizedGroup, data);
        }
        normalizedGroup = {
          ...normalizedGroup,
          data,
          rows: data.length,
          timeRange: data.length > 0 ? [data[0].time, data[data.length - 1].time] : [0, 0]
        };
      }

      if (normalizedGroup.data && normalizedGroup.data.length > 0) {
        result.push({
          key: mkKey(fileIdx, normalizedGroup.index),
          fileIdx,
          file,
          groupIdx: normalizedGroup.index,
          group: normalizedGroup
        });
      }
    });
  });

  return result;
}

function autoBuildGroups(page) {
  page.conditionGroups = [];
  page.nextGroupId = 1;

  const allGroups = getAllGroups(page);
  if (allGroups.length === 0) return;

  if (page.manualMode) {
    const nameMap = new Map();
    allGroups.forEach(group => {
      const shortFile = group.file.name.length > 16 ? `${group.file.name.substring(0, 14)}..` : group.file.name;
      const colName = group.group.autoName || `列组${group.groupIdx}`;
      const name = `[${shortFile}] ${colName}`;
      if (!nameMap.has(name)) {
        nameMap.set(name, {
          id: `g${page.nextGroupId}`,
          name,
          color: DEFAULT_COLORS[nameMap.size % DEFAULT_COLORS.length],
          indices: []
        });
        page.nextGroupId += 1;
      }
      nameMap.get(name).indices.push(group.key);
    });
    page.conditionGroups = Array.from(nameMap.values());
    return;
  }

  const assigned = new Set();

  page.files.forEach((file, fileIdx) => {
    const info = getSheetInfoForFile(file, page);
    if (!info) return;

    const fileGroups = allGroups.filter(group => group.fileIdx === fileIdx && !assigned.has(group.key));
    if (fileGroups.length === 0) return;

    const shortFile = file.name.length > 14 ? `${file.name.substring(0, 12)}..` : file.name;
    const fileLabels = Object.entries(info.labels).sort((a, b) => Number(a[0]) - Number(b[0]));
    const timeCols = info.timeIndices;
    const fileAssigned = new Set();

    if (fileLabels.length > 0 && fileGroups.length > 1) {
      const firstLabelCol = Number(fileLabels[0][0]);
      const firstSegment = fileGroups.filter(group => {
        const startCol = timeCols[group.groupIdx - 1];
        return startCol !== undefined && startCol < firstLabelCol && !fileAssigned.has(group.key);
      });

      if (firstSegment.length > 0) {
        page.conditionGroups.push({
          id: `g${page.nextGroupId}`,
          name: `[${shortFile}] 条件 A`,
          color: DEFAULT_COLORS[page.conditionGroups.length % DEFAULT_COLORS.length],
          indices: firstSegment.map(group => group.key)
        });
        page.nextGroupId += 1;
        firstSegment.forEach(group => {
          fileAssigned.add(group.key);
          assigned.add(group.key);
        });
      }

      fileLabels.forEach(([colStr, labelName], labelIndex) => {
        const labelCol = Number(colStr);
        const nextCol = labelIndex + 1 < fileLabels.length ? Number(fileLabels[labelIndex + 1][0]) : Infinity;
        const segment = fileGroups.filter(group => {
          if (fileAssigned.has(group.key)) return false;
          const startCol = timeCols[group.groupIdx - 1];
          return startCol !== undefined && startCol >= labelCol && startCol < nextCol;
        });

        if (segment.length > 0) {
          page.conditionGroups.push({
            id: `g${page.nextGroupId}`,
            name: `[${shortFile}] ${labelName}`,
            color: DEFAULT_COLORS[page.conditionGroups.length % DEFAULT_COLORS.length],
            indices: segment.map(group => group.key)
          });
          page.nextGroupId += 1;
          segment.forEach(group => {
            fileAssigned.add(group.key);
            assigned.add(group.key);
          });
        }
      });
    }

    const remaining = fileGroups.filter(group => !fileAssigned.has(group.key));
    if (remaining.length > 0) {
      page.conditionGroups.push({
        id: `g${page.nextGroupId}`,
        name: `[${shortFile}] 默认`,
        color: DEFAULT_COLORS[page.conditionGroups.length % DEFAULT_COLORS.length],
        indices: remaining.map(group => group.key)
      });
      page.nextGroupId += 1;
      remaining.forEach(group => assigned.add(group.key));
    }
  });

  const remaining = allGroups.filter(group => !assigned.has(group.key));
  if (remaining.length > 0 && page.conditionGroups.length > 0) {
    page.conditionGroups[page.conditionGroups.length - 1].indices.push(...remaining.map(group => group.key));
  } else if (remaining.length > 0) {
    page.conditionGroups.push({
      id: `g${page.nextGroupId}`,
      name: '默认分组',
      color: DEFAULT_COLORS[0],
      indices: remaining.map(group => group.key)
    });
    page.nextGroupId += 1;
  }

  if (page.conditionGroups.length === 0) {
    page.conditionGroups.push({
      id: `g${page.nextGroupId}`,
      name: '默认分组',
      color: DEFAULT_COLORS[0],
      indices: allGroups.map(group => group.key)
    });
    page.nextGroupId += 1;
  }
}

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => {
      setTimeout(() => {
        try {
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const workbookData = {};
          const sheetsInfo = {};

          workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
            const rangeStr = XLSX.utils.encode_range({
              s: range.s,
              e: { r: Math.min(range.e.r, MAX_DATA_ROWS), c: range.e.c }
            });
            let raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, range: rangeStr });
            raw = raw.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));
            if (raw.length > 0) {
              workbookData[sheetName] = raw;
              sheetsInfo[sheetName] = analyzeSheet(raw);
            }
          });

          resolve({ name: file.name, workbookData, sheetsInfo });
        } catch (error) {
          reject(error);
        }
      }, 0);
    };
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

async function readWorkbookFromPlatformFile(file) {
  const cacheKey = file.id ? String(file.id) : '';
  if (cacheKey && platformWorkbookCache.has(cacheKey)) {
    return platformWorkbookCache.get(cacheKey);
  }

  const loadPromise = (async () => {
    const response = await fetch(getDownloadUrl(file.id));
    if (!response.ok) {
      throw new Error(`${file.original_name || file.name || '文件'} 下载失败`);
    }
    const blob = await response.blob();
    const excelFile = new File([blob], file.original_name || file.name || `file-${file.id}.xlsx`, {
      type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const parsed = await readWorkbook(excelFile);
    return {
      ...parsed,
      sourceFileId: file.id
    };
  })();

  if (cacheKey) platformWorkbookCache.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } catch (error) {
    if (cacheKey) platformWorkbookCache.delete(cacheKey);
    throw error;
  }
}

function getSheetNames(page) {
  const sheetNames = [];
  page.files.forEach(file => {
    getUsableSheetNames(file, page.manualMode).forEach(name => {
      if (!sheetNames.includes(name)) sheetNames.push(name);
    });
  });
  return sheetNames;
}

function getGradientColor(hex, step, total) {
  if (total <= 1) return hex;
  const normalized = hex.replace('#', '');
  let r = Number.parseInt(normalized.substring(0, 2), 16);
  let g = Number.parseInt(normalized.substring(2, 4), 16);
  let b = Number.parseInt(normalized.substring(4, 6), 16);
  const factor = (step / (total - 1)) * 0.7;

  r = Math.round(r + (255 - r) * factor);
  g = Math.round(g + (255 - g) * factor);
  b = Math.round(b + (255 - b) * factor);

  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function buildPlotData(page, allGroups, isDarkTheme, showLegend = true) {
  const metricKey = page.currentMetric;
  const metricTitles = {
    R: 'R值 (红光通道)',
    G: 'G值 (绿光通道)',
    B: 'B值 (蓝光通道)',
    Sum: 'Sum (原始总和)',
    AvgSum: 'AvgSum (平滑总和)'
  };

  const traces = [];
  const traceGroupMapping = [];
  const processedKeys = new Set();

  page.conditionGroups.forEach(conditionGroup => {
    const validKeys = conditionGroup.indices.filter(key => allGroups.some(group => group.key === key));
    validKeys.forEach((key, step) => {
      const group = allGroups.find(item => item.key === key);
      if (!group) return;
      processedKeys.add(key);

      const lineColor = getGradientColor(conditionGroup.color, step, validKeys.length);
      const shortFile = group.file.name.length > 14 ? `${group.file.name.substring(0, 12)}..` : group.file.name;
      const traceName = `[${shortFile}] ${conditionGroup.name} - 重复${step + 1} (组${group.groupIdx})`;
      traceGroupMapping.push({ group: conditionGroup.name, groupId: conditionGroup.id });
      traces.push({
        x: group.group.data.map(row => row.time),
        y: group.group.data.map(row => row[metricKey]),
        mode: 'lines',
        name: traceName,
        legendgroup: conditionGroup.name,
        legendgrouptitle: { text: conditionGroup.name },
        line: { width: 1.5, color: lineColor },
        opacity: 0.9,
        hovertemplate: `时间: <b>%{x:.2f} s</b><br>${traceName}<extra></extra>`
      });
    });
  });

  const remaining = allGroups.filter(group => !processedKeys.has(group.key));
  remaining.forEach((group, step) => {
    const lineColor = getGradientColor(FALLBACK_COLOR, step, remaining.length || 1);
    const shortFile = group.file.name.length > 14 ? `${group.file.name.substring(0, 12)}..` : group.file.name;
    const traceName = `[未分组] ${shortFile} 组${group.groupIdx}`;
    traceGroupMapping.push({ group: '未分组', groupId: '__unassigned' });
    traces.push({
      x: group.group.data.map(row => row.time),
      y: group.group.data.map(row => row[metricKey]),
      mode: 'lines',
      name: traceName,
      legendgroup: '未分组',
      legendgrouptitle: { text: '未分组数据' },
      line: { width: 1, color: lineColor, dash: 'dot' },
      opacity: 0.5,
      hovertemplate: `时间: <b>%{x:.2f} s</b><br>${traceName}<extra></extra>`
    });
  });

  const seenGroups = new Set();
  traces.forEach(trace => {
    if (trace.legendgrouptitle?.text) {
      if (seenGroups.has(trace.legendgroup)) delete trace.legendgrouptitle;
      else seenGroups.add(trace.legendgroup);
    }
  });

  const uniqueGroups = [];
  traceGroupMapping.forEach(item => {
    if (!uniqueGroups.find(group => group.group === item.group)) uniqueGroups.push(item);
  });

  const dropdownButtons = [
    { label: '[全部] 显示全部分组', method: 'restyle', args: ['visible', traces.map(() => true)] }
  ];
  uniqueGroups.forEach(item => {
    const visible = traceGroupMapping.map(mapping => (mapping.group === item.group ? true : 'legendonly'));
    dropdownButtons.push({ label: `[筛选] 仅看: ${item.group}`, method: 'restyle', args: ['visible', visible] });
  });

  const paperBg = isDarkTheme ? 'rgba(30,33,40,0.96)' : '#ffffff';
  const plotBg = isDarkTheme ? 'rgba(22,25,30,0.92)' : '#f8fafc';
  const fontColor = isDarkTheme ? '#d4d4dc' : '#1f2937';
  const mutedFontColor = isDarkTheme ? '#b8bcc7' : '#4b5563';
  const gridColor = isDarkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)';
  const axisLineColor = isDarkTheme ? 'rgba(255,255,255,0.24)' : 'rgba(15,23,42,0.28)';
  const modebarBg = isDarkTheme ? 'rgba(22,25,30,0.92)' : 'rgba(255,255,255,0.9)';

  const layout = {
    title: {
      text: `<b>${metricTitles[metricKey]} 演变曲线</b><br><sup>${page.files.length}文件 · ${allGroups.length}组数据 · 左上角筛选 | 图例单击整组开关</sup>`,
      font: { size: 17, color: fontColor },
      x: 0.5
    },
    paper_bgcolor: paperBg,
    plot_bgcolor: plotBg,
    font: { color: fontColor },
    modebar: {
      bgcolor: modebarBg,
      color: mutedFontColor,
      activecolor: isDarkTheme ? '#ffffff' : '#111827'
    },
    hoverlabel: {
      bgcolor: isDarkTheme ? '#242831' : '#ffffff',
      bordercolor: axisLineColor,
      font: { color: fontColor }
    },
    hovermode: 'y unified',
    updatemenus: [{
      type: 'dropdown',
      direction: 'down',
      active: 0,
      buttons: dropdownButtons,
      x: 0.01,
      xanchor: 'left',
      y: 1.12,
      yanchor: 'top',
      font: { size: 10, color: fontColor },
      bgcolor: isDarkTheme ? '#242831' : '#F8F9FA',
      bordercolor: isDarkTheme ? 'rgba(128,148,176,0.35)' : 'rgba(15,23,42,0.24)',
      borderwidth: 1
    }],
    legend: {
      title: { text: '<b>实验条件与平行组</b>', font: { size: 11, color: fontColor } },
      font: { size: 8.5, color: fontColor },
      groupclick: 'togglegroup',
      bordercolor: isDarkTheme ? 'rgba(128,148,176,0.3)' : 'rgba(15,23,42,0.18)',
      borderwidth: 1,
      bgcolor: isDarkTheme ? 'rgba(30,33,40,0.88)' : 'rgba(255,255,255,0.92)',
      itemwidth: 30,
      tracegroupgap: 2,
      itemsizing: 'constant',
      x: 0.995,
      xanchor: 'right',
      y: 0.995,
      yanchor: 'top'
    },
    showlegend: showLegend,
    margin: { l: 56, r: 8, t: 92, b: 64 },
    xaxis: {
      title: { text: '<b>反应时间 Time (s)</b>', font: { color: fontColor } },
      tickfont: { color: mutedFontColor },
      gridcolor: gridColor,
      zerolinecolor: gridColor,
      linecolor: axisLineColor,
      rangeslider: {
        visible: true,
        thickness: 0.06,
        bgcolor: isDarkTheme ? 'rgba(22,25,30,0.92)' : '#eef2f7',
        bordercolor: axisLineColor,
        borderwidth: 1
      }
    },
    yaxis: {
      title: { text: '<b>光学强度 Intensity</b>', font: { color: fontColor } },
      tickfont: { color: mutedFontColor },
      gridcolor: gridColor,
      zerolinecolor: gridColor,
      linecolor: axisLineColor,
      showspikes: true,
      spikemode: 'across',
      spikethickness: 1,
      spikedash: 'dash',
      spikecolor: '#999',
      hoverformat: '.2f'
    },
    hoverdistance: -1,
    spikedistance: -1
  };

  return { traces, layout };
}

function metricLabel(metric, page) {
  if (page.manualMode && page.manualConfirmed) {
    return {
      AvgSum: 'Y均值',
      Sum: 'Y总和',
      R: 'Y列1',
      G: 'Y列2',
      B: 'Y列3'
    }[metric];
  }
  return {
    AvgSum: 'AvgSum 平滑',
    Sum: 'Sum 总和',
    R: 'R 通道',
    G: 'G 通道',
    B: 'B 通道'
  }[metric];
}

function DataPlotter({ fileRequest }) {
  const initialPage = useMemo(() => createPage(1, '滴定实验'), []);
  const [pages, setPages] = useState([initialPage]);
  const [activePageId, setActivePageId] = useState(initialPage.id);
  const [pageCounter, setPageCounter] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('就绪');
  const fileInputRef = useRef(null);
  const handledRequestIdRef = useRef(null);
  const [pendingPageId, setPendingPageId] = useState(null);

  const activePage = useMemo(
    () => pages.find(page => page.id === activePageId) || pages[0],
    [pages, activePageId]
  );
  const allGroups = useMemo(() => (activePage ? getAllGroups(activePage) : []), [activePage]);
  const sheetNames = useMemo(() => (activePage ? getSheetNames(activePage) : []), [activePage]);
  const totalRows = useMemo(
    () => allGroups.reduce((total, group) => total + group.group.rows, 0),
    [allGroups]
  );

  const updatePages = updater => {
    setPages(prev => {
      const next = clonePages(prev);
      updater(next);
      return next;
    });
  };

  const addParsedFilesToPage = (pageId, parsedFiles) => {
    if (!parsedFiles || parsedFiles.length === 0) return;
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page) return;

      parsedFiles.forEach(parsedFile => {
        const existingIndex = page.files.findIndex(file => {
          if (parsedFile.sourceFileId && file.sourceFileId) return file.sourceFileId === parsedFile.sourceFileId;
          return file.name === parsedFile.name;
        });
        if (existingIndex >= 0) page.files[existingIndex] = parsedFile;
        else page.files.push(parsedFile);
      });

      const sheetsWithGroups = page.files.flatMap(file =>
        Object.keys(file.sheetsInfo).filter(name => file.sheetsInfo[name].groups.length > 0)
      );
      const allSheets = page.files.flatMap(file =>
        Object.keys(file.sheetsInfo).filter(name => file.workbookData[name] && file.workbookData[name].length > 1)
      );

      if (!page.currentSheet && sheetsWithGroups.length > 0) page.currentSheet = sheetsWithGroups[0];
      else if (!page.currentSheet && allSheets.length > 0) page.currentSheet = allSheets[0];

      autoBuildGroups(page);
    });
  };

  useEffect(() => {
    if (!fileRequest || handledRequestIdRef.current === fileRequest.id) return;
    handledRequestIdRef.current = fileRequest.id;

    const requestedFiles = Array.isArray(fileRequest.files) ? fileRequest.files : [];
    if (requestedFiles.length === 0) return;

    let cancelled = false;
    const pageId = activePageId;

    const loadRequestedFiles = async () => {
      setLoading(true);
      setStatus(`正在从文件管理读取 ${requestedFiles.length} 个 Excel 文件...`);
      await waitForFrame();
      let loadedCount = 0;
      try {
        for (const file of requestedFiles) {
          if (cancelled) return;
          setStatus(`正在读取 ${loadedCount + 1}/${requestedFiles.length}: ${file.original_name || file.name || 'Excel 文件'}`);
          const parsedFile = await readWorkbookFromPlatformFile(file);
          if (cancelled) return;
          addParsedFilesToPage(pageId, [parsedFile]);
          loadedCount += 1;
          setStatus(`已加入 ${loadedCount}/${requestedFiles.length} 个 Excel 文件`);
          await waitForFrame();
        }
        setStatus(`已从文件管理加入 ${loadedCount} 个 Excel 文件`);
      } catch (error) {
        if (!cancelled) setStatus(`读取失败: ${error.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadRequestedFiles();
    return () => {
      cancelled = true;
    };
  }, [fileRequest]);

  const addPage = () => {
    const nextIndex = pageCounter + 1;
    const nextPage = createPage(nextIndex);
    setPages(prev => [...prev, nextPage]);
    setPageCounter(nextIndex);
    setActivePageId(nextPage.id);
  };

  const deletePage = pageId => {
    if (pages.length <= 1) {
      window.alert('至少保留一个页面');
      return;
    }

    const page = pages.find(item => item.id === pageId);
    if (page?.files.length > 0 && !window.confirm(`页面 "${page.name}" 含 ${page.files.length} 个文件，确定删除？`)) {
      return;
    }

    const pageIndex = pages.findIndex(item => item.id === pageId);
    const nextPages = pages.filter(item => item.id !== pageId);
    setPages(nextPages);
    if (activePageId === pageId) {
      setActivePageId(nextPages[Math.min(pageIndex, nextPages.length - 1)].id);
    }
  };

  const renamePage = pageId => {
    const page = pages.find(item => item.id === pageId);
    if (!page) return;
    const name = window.prompt('请输入页面名称', page.name);
    if (!name) return;
    updatePages(next => {
      const target = next.find(item => item.id === pageId);
      if (target) target.name = name.trim() || '未命名';
    });
  };

  const openFilePicker = pageId => {
    setPendingPageId(pageId);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileUpload = async event => {
    const files = Array.from(event.target.files || []);
    const pageId = pendingPageId || activePageId;
    if (files.length === 0 || !pageId) return;

    setLoading(true);
    setStatus('读取文件中...');
    await waitForFrame();

    try {
      let loadedCount = 0;
      for (const file of files) {
        setStatus(`正在读取 ${loadedCount + 1}/${files.length}: ${file.name}`);
        const parsedFile = await readWorkbook(file);
        addParsedFilesToPage(pageId, [parsedFile]);
        loadedCount += 1;
        setStatus(`已加载 ${loadedCount}/${files.length} 个文件`);
        await waitForFrame();
      }
      setStatus(`已加载 ${loadedCount} 个文件`);
    } catch (error) {
      setStatus(`读取失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const removeFile = (pageId, fileIdx) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page) return;

      page.conditionGroups.forEach(conditionGroup => {
        conditionGroup.indices = conditionGroup.indices.filter(key => {
          const parsed = parseKey(key);
          return !parsed || parsed.fileIdx !== fileIdx;
        });
      });

      page.files.splice(fileIdx, 1);

      page.conditionGroups.forEach(conditionGroup => {
        conditionGroup.indices = conditionGroup.indices.map(key => {
          const parsed = parseKey(key);
          if (!parsed) return key;
          if (parsed.fileIdx > fileIdx) return mkKey(parsed.fileIdx - 1, parsed.groupIdx);
          return key;
        });
      });

      if (page.files.length === 0) {
        page.currentSheet = '';
        page.conditionGroups = [];
      }
    });
  };

  const changeSheet = (pageId, sheetName) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page) return;
      page.currentSheet = sheetName;
      page.conditionGroups = [];
      if (!page.manualMode || page.manualConfirmed) autoBuildGroups(page);
    });
  };

  const setMode = (pageId, manualMode) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page || page.manualMode === manualMode) return;
      page.manualMode = manualMode;
      page.conditionGroups = [];
      page.manualConfirmed = false;
      if (!manualMode) autoBuildGroups(page);
    });
  };

  const confirmManual = pageId => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page) return;
      if (!page.manualXName.trim()) {
        window.alert('请输入 X 轴列名');
        return;
      }
      page.manualXName = page.manualXName.trim();
      page.manualYName = page.manualYName.trim();
      page.manualYOffset = Number(page.manualYOffset) || 1;
      page.manualYCount = Math.max(1, Math.min(20, Number(page.manualYCount) || 1));
      page.manualConfirmed = true;
      page.conditionGroups = [];
      autoBuildGroups(page);
      setStatus(`手动配置已应用: X=${page.manualXName}, Y=${page.manualYName || '(数值)'}`);
    });
  };

  const updateManualField = (pageId, field, value) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page) return;
      page[field] = value;
      page.manualConfirmed = false;
      page.conditionGroups = [];
    });
  };

  const addGroup = pageId => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page) return;
      page.conditionGroups.push({
        id: `g${page.nextGroupId}`,
        name: `新分组${page.conditionGroups.length + 1}`,
        color: DEFAULT_COLORS[page.conditionGroups.length % DEFAULT_COLORS.length],
        indices: []
      });
      page.nextGroupId += 1;
    });
  };

  const deleteGroup = (pageId, groupId) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page || page.conditionGroups.length <= 1) {
        window.alert('至少保留一个分组');
        return;
      }
      const group = page.conditionGroups.find(item => item.id === groupId);
      if (group?.indices.length > 0 && !window.confirm(`分组 "${group.name}" 含有 ${group.indices.length} 条数据，确定删除？`)) {
        return;
      }
      page.conditionGroups = page.conditionGroups.filter(item => item.id !== groupId);
    });
  };

  const updateGroup = (pageId, groupId, patch) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      const group = page?.conditionGroups.find(item => item.id === groupId);
      if (group) Object.assign(group, patch);
    });
  };

  const assignTrace = (pageId, key, groupId) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (!page) return;
      page.conditionGroups.forEach(group => {
        group.indices = group.indices.filter(item => item !== key);
      });
      if (groupId) {
        const target = page.conditionGroups.find(group => group.id === groupId);
        if (target) target.indices.push(key);
      }
    });
  };

  const removeTrace = (pageId, groupId, key) => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      const group = page?.conditionGroups.find(item => item.id === groupId);
      if (group) group.indices = group.indices.filter(item => item !== key);
    });
  };

  const toggleLegend = pageId => {
    updatePages(next => {
      const page = next.find(item => item.id === pageId);
      if (page) page.showLegend = !page.showLegend;
    });
  };

  if (!activePage) {
    return <div className="data-plotter-empty">请新建页面</div>;
  }

  return (
    <div className="data-plotter">
      <div className="data-plotter-header">
        <div>
          <h2 className="page-title" style={{ marginBottom: 0 }}><FaChartLine aria-hidden="true" />数据绘图</h2>
          <div className="data-plotter-subtitle">Excel 多文件合并、数据分组与曲线导出</div>
        </div>
        <div className="data-plotter-header-actions">
          <button
            type="button"
            className={`data-plotter-legend-toggle ${activePage.showLegend ? 'active' : ''}`}
            onClick={() => toggleLegend(activePage.id)}
            title={activePage.showLegend ? '隐藏图例' : '显示图例'}
          >
            {activePage.showLegend ? '隐藏图例' : '显示图例'}
          </button>
          <div className="data-plotter-status">{status}</div>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept=".xlsx,.xls"
        multiple
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      <div className="data-plotter-tabs">
        {pages.map(page => (
          <button
            key={page.id}
            className={`data-plotter-tab ${page.id === activePageId ? 'data-plotter-tab-active' : ''}`}
            onClick={() => setActivePageId(page.id)}
            onDoubleClick={() => renamePage(page.id)}
          >
            <span className="data-plotter-tab-name">{page.name}</span>
            <span
              className="data-plotter-tab-close"
              onClick={event => {
                event.stopPropagation();
                deletePage(page.id);
              }}
              title="删除页面"
            >
              ×
            </span>
          </button>
        ))}
        <button className="data-plotter-new-tab" onClick={addPage} title="新建页面">+</button>
      </div>

      <div className="data-plotter-workspace glass-panel">
        <aside className="data-plotter-sidebar">
          <section className="data-plotter-section">
            <div className="data-plotter-section-title">文件 ({activePage.files.length})</div>
            <div className="data-plotter-file-list">
              {activePage.files.length === 0 ? (
                <div className="data-plotter-empty-line">暂无文件</div>
              ) : activePage.files.map((file, index) => (
                <div className="data-plotter-file-chip" key={`${file.name}-${index}`} title={file.name}>
                  <span className="data-plotter-file-dot"></span>
                  <span>{file.name.length > 18 ? `${file.name.substring(0, 16)}..` : file.name}</span>
                  <button type="button" onClick={() => removeFile(activePage.id, index)} title="移除">×</button>
                </div>
              ))}
              <button className="data-plotter-add-file" onClick={() => openFilePicker(activePage.id)} disabled={loading}>
                {loading ? '读取中...' : '+ 添加文件'}
              </button>
            </div>
            {allGroups.length > 0 && (
              <div className="data-plotter-file-info">{allGroups.length}组数据 · {totalRows}行</div>
            )}
            {sheetNames.length > 1 && (
              <select
                className="data-plotter-select"
                value={activePage.currentSheet}
                onChange={event => changeSheet(activePage.id, event.target.value)}
              >
                {sheetNames.map(sheetName => (
                  <option key={sheetName} value={sheetName}>{sheetName}</option>
                ))}
              </select>
            )}
          </section>

          <section className="data-plotter-section">
            <div className="data-plotter-section-title">检测模式</div>
            <div className="data-plotter-segmented">
              <button
                className={!activePage.manualMode ? 'active' : ''}
                onClick={() => setMode(activePage.id, false)}
              >
                自动
              </button>
              <button
                className={activePage.manualMode ? 'active' : ''}
                onClick={() => setMode(activePage.id, true)}
              >
                手动配置
              </button>
            </div>

            {activePage.manualMode ? (
              <div className="data-plotter-manual">
                <label>
                  <span>X轴列名</span>
                  <input
                    value={activePage.manualXName}
                    placeholder="如 time、时间、浓度"
                    onChange={event => updateManualField(activePage.id, 'manualXName', event.target.value)}
                  />
                </label>
                <label>
                  <span>Y轴列名</span>
                  <input
                    value={activePage.manualYName}
                    placeholder="如 R、吸光度、Abs"
                    onChange={event => updateManualField(activePage.id, 'manualYName', event.target.value)}
                  />
                </label>
                <div className="data-plotter-manual-row">
                  <span>Y位置</span>
                  <select
                    value={activePage.manualYOffset >= 0 ? 1 : -1}
                    onChange={event => updateManualField(activePage.id, 'manualYOffset', Number(event.target.value) * Math.abs(activePage.manualYOffset || 1))}
                  >
                    <option value={1}>X后</option>
                    <option value={-1}>X前</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={Math.abs(activePage.manualYOffset || 1)}
                    onChange={event => {
                      const direction = activePage.manualYOffset >= 0 ? 1 : -1;
                      updateManualField(activePage.id, 'manualYOffset', direction * Math.abs(Number(event.target.value) || 1));
                    }}
                  />
                  <span>列</span>
                </div>
                <label>
                  <span>每组Y列数</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={activePage.manualYCount}
                    onChange={event => updateManualField(activePage.id, 'manualYCount', Number(event.target.value))}
                  />
                </label>
                <label className="data-plotter-checkbox">
                  <input
                    type="checkbox"
                    checked={activePage.manualExactMatch}
                    onChange={event => updateManualField(activePage.id, 'manualExactMatch', event.target.checked)}
                  />
                  <span>精确匹配</span>
                </label>
                <button className="btn btn-primary" onClick={() => confirmManual(activePage.id)}>确认配置</button>
                {!activePage.manualConfirmed && (
                  <div className="data-plotter-warning">请填写列名后点击确认</div>
                )}
              </div>
            ) : (
              <div className="data-plotter-help">自动扫描表头中包含 "time" 的列来定位数据组。</div>
            )}
          </section>

          <section className="data-plotter-section">
            <div className="data-plotter-section-title">指标选择</div>
            <div className="data-plotter-metrics">
              {METRICS.map(metric => (
                <button
                  key={metric}
                  className={metric === activePage.currentMetric ? 'active' : ''}
                  onClick={() => updatePages(next => {
                    const page = next.find(item => item.id === activePage.id);
                    if (page) page.currentMetric = metric;
                  })}
                >
                  {metricLabel(metric, activePage)}
                </button>
              ))}
            </div>
          </section>

          <section className="data-plotter-section">
            <div className="data-plotter-section-title">分组与颜色</div>
            {allGroups.length === 0 ? (
              <div className="data-plotter-empty-line">请先添加文件</div>
            ) : (
              <div className="data-plotter-group-list">
                {activePage.conditionGroups.map(group => (
                  <div className="data-plotter-group-card" key={group.id} style={{ borderLeftColor: group.color }}>
                    <div className="data-plotter-group-header">
                      <input
                        type="color"
                        value={group.color}
                        onChange={event => updateGroup(activePage.id, group.id, { color: event.target.value })}
                      />
                      <input
                        type="text"
                        value={group.name}
                        onChange={event => updateGroup(activePage.id, group.id, { name: event.target.value || '未命名' })}
                      />
                      <button type="button" onClick={() => deleteGroup(activePage.id, group.id)}>×</button>
                    </div>
                    <div className="data-plotter-chip-row">
                      {group.indices.length > 0 ? group.indices.map(key => {
                        const parsed = parseKey(key);
                        if (!parsed) return null;
                        const file = activePage.files[parsed.fileIdx];
                        const shortFile = file ? (file.name.length > 10 ? `${file.name.substring(0, 8)}..` : file.name) : '?';
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => removeTrace(activePage.id, group.id, key)}
                            title={`${file?.name || '?'} 组${parsed.groupIdx}`}
                          >
                            {shortFile} · 组{parsed.groupIdx} ×
                          </button>
                        );
                      }) : (
                        <span>无数据</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="data-plotter-add-group" onClick={() => addGroup(activePage.id)}>+ 新建条件分组</button>
          </section>

          <section className="data-plotter-section">
            <div className="data-plotter-section-title">数据组分配</div>
            {allGroups.length === 0 ? (
              <div className="data-plotter-empty-line">等待数据加载...</div>
            ) : (
              <div className="data-plotter-trace-list">
                {allGroups.map(group => {
                  const assignedGroup = activePage.conditionGroups.find(item => item.indices.includes(group.key));
                  const shortFile = group.file.name.length > 12 ? `${group.file.name.substring(0, 10)}..` : group.file.name;
                  return (
                    <div className="data-plotter-trace-item" key={group.key}>
                      <span className="data-plotter-color-dot" style={{ background: assignedGroup ? assignedGroup.color : FALLBACK_COLOR }}></span>
                      <span className="data-plotter-trace-label">{shortFile} 组{group.groupIdx}</span>
                      <span className="data-plotter-trace-info">
                        {group.group.rows}行 {group.group.timeRange[0].toFixed(1)}~{group.group.timeRange[1].toFixed(1)}s
                      </span>
                      <select value={assignedGroup?.id || ''} onChange={event => assignTrace(activePage.id, group.key, event.target.value)}>
                        <option value="">-- 选择 --</option>
                        {activePage.conditionGroups.map(conditionGroup => (
                          <option key={conditionGroup.id} value={conditionGroup.id}>{conditionGroup.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>

        <PlotPanel page={activePage} allGroups={allGroups} />
      </div>

      {loading && (
        <div className="data-plotter-loading">
          <div className="data-plotter-loading-card">
            <div className="spinner"></div>
            <div>文件较大，请稍候...</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlotPanel({ page, allGroups }) {
  const chartRef = useRef(null);
  const [plotlyReady, setPlotlyReady] = useState(false);
  const themeMode = useThemeMode();

  useEffect(() => {
    const chart = chartRef.current;
    let cancelled = false;

    if (!chart || allGroups.length === 0) {
      if (chart && chart._plotlyInstance) {
        chart._plotlyInstance.purge(chart);
        chart._plotlyInstance = null;
      }
      return undefined;
    }

    loadPlotly().then(Plotly => {
      if (cancelled || !chartRef.current) return;
      chart._plotlyInstance = Plotly;
      setPlotlyReady(true);

      const isDarkTheme = themeMode !== 'light';
      const { traces, layout } = buildPlotData(page, allGroups, isDarkTheme, page.showLegend !== false);
      const config = {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        editable: true,
        edits: {
          legendPosition: true,
          titleText: false,
          axisTitleText: false,
          annotationPosition: false,
          annotationTail: false,
          annotationText: false,
          colorbarPosition: false,
          shapePosition: false
        },
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        toImageButtonOptions: { format: 'png', filename: 'chart_export', scale: 2 }
      };

      chart._traceYMeta = traces.map(trace => ({
        name: trace.name || '',
        range: (() => {
          const ys = trace.y.filter(value => value !== null && !Number.isNaN(value));
          return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
        })()
      }));

      Plotly.react(chart, traces, layout, config);

      if (!chart._hoverHooked) {
        chart._hoverHooked = true;
        chart.on('plotly_hover', event => {
          if (!event?.points?.length) return;
          const meta = chart._traceYMeta;
          if (!meta) return;
          const hoverY = event.points[0].y;
          const anyValid = event.points.some(point => {
            const item = meta[point.curveNumber];
            const range = item?.range;
            return !range || (hoverY >= range[0] && hoverY <= range[1]);
          });
          const hoverLayer = chart.querySelector('.hoverlayer');
          if (hoverLayer) hoverLayer.style.display = anyValid ? '' : 'none';
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [page, allGroups, themeMode]);

  useEffect(() => () => {
    const chart = chartRef.current;
    if (chart?._plotlyInstance) chart._plotlyInstance.purge(chart);
  }, []);

  return (
    <div className="data-plotter-chart-area">
      <div ref={chartRef} className="data-plotter-chart"></div>
      {allGroups.length > 0 && !plotlyReady && (
        <div className="data-plotter-chart-empty">
          <div className="spinner"></div>
          <div>正在加载绘图库...</div>
        </div>
      )}
      {allGroups.length === 0 && (
        <div className="data-plotter-chart-empty">
          <div className="data-plotter-chart-empty-icon">📈</div>
          <div>添加 Excel 文件以开始做图</div>
        </div>
      )}
    </div>
  );
}

export default DataPlotter;
