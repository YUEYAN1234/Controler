import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getPreviewUrl, getDownloadUrl } from '../api';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

// 文件类型判断
function getFileCategory(fileName, mimeType) {
  const ext = fileName?.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['xlsx', 'xls'].includes(ext)) return 'excel';
  if (ext === 'csv') return 'csv';
  if (['docx'].includes(ext)) return 'word';
  if (['txt', 'md', 'json', 'js', 'py', 'c', 'cpp', 'h', 'java', 'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'sh', 'bat'].includes(ext)) return 'text';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType?.startsWith('text/')) return 'text';
  return 'unsupported';
}

// 从 Excel 图表 XML 中解析数据
function parseChartXml(xmlStr) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'text/xml');

  // 提取标题
  let title = '';
  const titleTexts = doc.querySelectorAll('title t');
  if (titleTexts.length > 0) {
    title = Array.from(titleTexts).map(t => t.textContent).join('');
  }

  // 检测图表类型
  const chartTypes = ['scatterChart', 'lineChart', 'barChart', 'areaChart', 'pieChart'];
  let detectedType = 'scatter';
  for (const ct of chartTypes) {
    if (doc.querySelector(ct)) {
      detectedType = ct.replace('Chart', '');
      break;
    }
  }

  // 提取数据系列
  const series = [];
  const sers = doc.querySelectorAll('ser');
  sers.forEach(ser => {
    const seriesData = { xValues: [], yValues: [], name: '' };

    // 系列名称
    const serName = ser.querySelector('tx strRef strCache pt v');
    if (serName) seriesData.name = serName.textContent;

    // 散点图：xVal/yVal
    const xCache = ser.querySelector('xVal numRef numCache');
    const yCache = ser.querySelector('yVal numRef numCache');
    // 折线/柱状图：cat/val
    const catCache = ser.querySelector('cat numRef numCache') || ser.querySelector('cat strRef strCache');
    const valCache = ser.querySelector('val numRef numCache');

    if (xCache) {
      xCache.querySelectorAll('pt').forEach(pt => {
        seriesData.xValues.push(parseFloat(pt.querySelector('v').textContent));
      });
    } else if (catCache) {
      catCache.querySelectorAll('pt').forEach(pt => {
        const v = pt.querySelector('v').textContent;
        seriesData.xValues.push(isNaN(v) ? v : parseFloat(v));
      });
    }

    if (yCache) {
      yCache.querySelectorAll('pt').forEach(pt => {
        seriesData.yValues.push(parseFloat(pt.querySelector('v').textContent));
      });
    } else if (valCache) {
      valCache.querySelectorAll('pt').forEach(pt => {
        seriesData.yValues.push(parseFloat(pt.querySelector('v').textContent));
      });
    }

    // 检查是否有趋势线
    seriesData.hasTrendline = !!ser.querySelector('trendline');
    seriesData.trendlineType = ser.querySelector('trendlineType')?.getAttribute('val') || 'linear';

    if (seriesData.yValues.length > 0) {
      series.push(seriesData);
    }
  });

  return { title, type: detectedType, series };
}

// 计算线性趋势线
function calcLinearTrendline(xVals, yVals) {
  const n = xVals.length;
  if (n < 2) return [];
  const sumX = xVals.reduce((a, b) => a + b, 0);
  const sumY = yVals.reduce((a, b) => a + b, 0);
  const sumXY = xVals.reduce((a, x, i) => a + x * yVals[i], 0);
  const sumX2 = xVals.reduce((a, x) => a + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const minX = Math.min(...xVals);
  const maxX = Math.max(...xVals);
  const step = (maxX - minX) / 50;
  const points = [];
  for (let x = minX; x <= maxX; x += step) {
    points.push({ x, y: slope * x + intercept });
  }
  return points;
}

// Chart.js 渲染组件
function ChartRenderer({ chartData }) {
  const canvasRef = React.useRef(null);
  const chartRef = React.useRef(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);

      if (!isMounted || !canvasRef.current) return;

      const colors = [
        'rgba(68, 114, 196, 1)',
        'rgba(237, 125, 49, 1)',
        'rgba(165, 165, 165, 1)',
        'rgba(255, 192, 0, 1)',
        'rgba(91, 155, 213, 1)',
        'rgba(112, 173, 71, 1)',
      ];

      const datasets = [];
      chartData.series.forEach((s, i) => {
        const color = colors[i % colors.length];

        if (chartData.type === 'scatter') {
          // 散点数据
          const points = s.xValues.map((x, j) => ({ x, y: s.yValues[j] }));
          datasets.push({
            label: s.name || `系列 ${i + 1}`,
            data: points,
            backgroundColor: color,
            borderColor: color,
            pointRadius: 1.5,
            pointHoverRadius: 3,
            showLine: false,
          });

          // 趋势线
          if (s.hasTrendline) {
            const trendPoints = calcLinearTrendline(s.xValues, s.yValues);
            datasets.push({
              label: '趋势线',
              data: trendPoints,
              borderColor: color,
              borderDash: [4, 4],
              borderWidth: 1,
              pointRadius: 0,
              showLine: true,
              fill: false,
            });
          }
        } else {
          // 折线 / 柱状 / 面积图
          datasets.push({
            label: s.name || `系列 ${i + 1}`,
            data: s.yValues,
            backgroundColor: color.replace('1)', '0.6)'),
            borderColor: color,
            borderWidth: 1,
            pointRadius: 0,
            pointHoverRadius: 2,
            fill: chartData.type === 'area',
          });
        }
      });

      const isScatter = chartData.type === 'scatter';
      const config = {
        type: isScatter ? 'scatter' : (chartData.type === 'bar' ? 'bar' : 'line'),
        data: {
          labels: isScatter ? undefined : (chartData.series[0]?.xValues || []),
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: !!chartData.title,
              text: chartData.title,
              font: { size: 14 },
              color: '#666',
            },
            legend: {
              display: datasets.length > 1,
              labels: { filter: (item) => !item.text?.includes('趋势线') }
            },
          },
          scales: {
            x: { grid: { color: 'rgba(0,0,0,0.06)' } },
            y: { grid: { color: 'rgba(0,0,0,0.06)' } },
          },
        },
      };

      if (chartRef.current) chartRef.current.destroy();
      chartRef.current = new Chart(canvasRef.current, config);
    })();

    return () => {
      isMounted = false;
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [chartData]);

  return (
    <div className="excel-chart-item">
      <canvas ref={canvasRef} />
    </div>
  );
}

// Excel 预览
function ExcelViewer({ url }) {
  const [sheets, setSheets] = useState([]);
  const [chartImages, setChartImages] = useState([]);
  const [parsedCharts, setParsedCharts] = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`请求失败 (${res.status})`);
        
        const blob = await res.blob();
        if (blob.type.includes('text/html')) {
          throw new Error('服务器未返回合法的文件，而是返回了HTML（可能是404或未授权网页）');
        }

        const arrayBuf = await blob.arrayBuffer();

        // 用 SheetJS 解析表格数据
        const wb = XLSX.read(new Uint8Array(arrayBuf), { type: 'array' });
        const result = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name];
          const html = (ws && ws['!ref'])
            ? XLSX.utils.sheet_to_html(ws, { id: 'preview-table' })
            : '<div style="padding:2rem;text-align:center;color:var(--text-muted);">（工作表为空）</div>';
          return { name, html };
        });

        // 用 JSZip 提取嵌入的图表和图片
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(arrayBuf);
        
        // 提取缓存图片
        const images = [];
        const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp'];
        for (const [path, file] of Object.entries(zip.files)) {
          if (path.startsWith('xl/media/') && !file.dir) {
            const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
            if (imgExts.includes(ext)) {
              const imgBlob = await file.async('blob');
              const dataUrl = URL.createObjectURL(imgBlob);
              images.push({ name: path.split('/').pop(), url: dataUrl });
            }
          }
        }

        // 解析图表 XML
        const charts = [];
        for (const [path, file] of Object.entries(zip.files)) {
          if (path.match(/^xl\/charts\/chart\d+\.xml$/) && !file.dir) {
            const xmlStr = await file.async('text');
            const chartData = parseChartXml(xmlStr);
            if (chartData.series.length > 0) {
              charts.push(chartData);
            }
          }
        }

        if (!cancelled) {
          setSheets(result);
          setChartImages(images);
          setParsedCharts(charts);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Excel 解析失败: ' + e.message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <div className="preview-loading"><div className="spinner"></div><p>正在解析 Excel 文件...</p></div>;
  if (error) return <div className="preview-error">⚠️ {error}</div>;

  const hasCharts = chartImages.length > 0 || parsedCharts.length > 0;

  return (
    <div className="excel-viewer">
      {sheets.length > 1 && (
        <div className="sheet-tabs">
          {sheets.map((s, i) => (
            <button
              key={i}
              className={`sheet-tab ${i === activeSheet ? 'sheet-tab-active' : ''}`}
              onClick={() => setActiveSheet(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div
        className="excel-content"
        dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html || '' }}
      />
      {hasCharts && (
        <div className="excel-charts">
          <div className="excel-charts-title">📈 图表</div>
          <div className="excel-charts-grid">
            {parsedCharts.map((chart, i) => (
              <ChartRenderer key={i} chartData={chart} />
            ))}
            {chartImages.map((img, i) => (
              <div key={`img-${i}`} className="excel-chart-item">
                <img src={img.url} alt={img.name} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Word 预览
function WordViewer({ url }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`请求失败 (${res.status})`);
        const buf = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) {
          setHtml(result.value);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Word 解析失败: ' + e.message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <div className="preview-loading"><div className="spinner"></div><p>正在解析 Word 文件...</p></div>;
  if (error) return <div className="preview-error">⚠️ {error}</div>;

  return (
    <div className="word-content" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

// 纯文本预览
function TextViewer({ url }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('网络请求失败');
        const t = await res.text();
        if (!cancelled) { setText(t); setLoading(false); }
      } catch {
        if (!cancelled) { setText('文件加载失败'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <div className="preview-loading"><div className="spinner"></div><p>加载中...</p></div>;

  return <pre className="text-content">{text}</pre>;
}

// CSV 预览 (用 SheetJS 解析为表格)
function CsvViewer({ url }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`请求失败 (${res.status})`);
        const text = await res.text();
        const wb = XLSX.read(text, { type: 'string' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const tableHtml = XLSX.utils.sheet_to_html(ws, { id: 'preview-table' });
        if (!cancelled) { setHtml(tableHtml); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setError('CSV 解析失败: ' + e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <div className="preview-loading"><div className="spinner"></div><p>正在解析 CSV...</p></div>;
  if (error) return <div className="preview-error">⚠️ {error}</div>;

  return <div className="excel-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

// 主预览 Modal
function FilePreview({ file, onClose }) {
  const category = getFileCategory(file.original_name, file.mime_type);
  const previewUrl = getPreviewUrl(file.id);
  const downloadUrl = getDownloadUrl(file.id);

  // ESC 关闭
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const renderContent = () => {
    switch (category) {
      case 'image':
        return (
          <div className="preview-image-container">
            <img src={previewUrl} alt={file.original_name} className="preview-image" />
          </div>
        );
      case 'pdf':
        return (
          <iframe
            src={previewUrl}
            className="preview-iframe"
            title={file.original_name}
          />
        );
      case 'excel':
        return <ExcelViewer url={previewUrl} />;
      case 'csv':
        return <CsvViewer url={previewUrl} />;
      case 'word':
        return <WordViewer url={previewUrl} />;
      case 'text':
        return <TextViewer url={previewUrl} />;
      default:
        return (
          <div className="preview-unsupported">
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📄</div>
            <h3>不支持预览此类型文件</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              文件类型: {file.original_name?.split('.').pop()?.toUpperCase() || '未知'}
            </p>
            <a className="btn btn-primary" href={downloadUrl} download={file.original_name}>
              📥 下载查看
            </a>
          </div>
        );
    }
  };

  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-header">
          <div className="preview-title">
            <span className="preview-file-icon">
              {category === 'image' ? '🖼️' : category === 'pdf' ? '📕' : category === 'excel' || category === 'csv' ? '📊' : category === 'word' ? '📝' : category === 'text' ? '📃' : '📄'}
            </span>
            <span className="preview-file-name">{file.original_name}</span>
            <span className="preview-file-size">({(file.size / 1024).toFixed(1)} KB)</span>
          </div>
          <div className="preview-actions">
            <a className="btn btn-ghost" href={downloadUrl} download={file.original_name} title="下载">
              下载
            </a>
            <button className="btn btn-ghost" onClick={onClose} title="关闭">✕</button>
          </div>
        </div>
        <div className="preview-body">
          {renderContent()}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default FilePreview;
