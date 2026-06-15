import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getReservations, createReservation, updateReservation, deleteReservation } from '../api';

import { useAuth } from '../AuthContext';

const ITEM_HEIGHT = 36;
const VISIBLE_COUNT = 5; // odd number for center selection

function TimeWheelPicker({ options, value, onChange }) {
  const listRef = useRef(null);
  const snapTimer = useRef(null);
  const selectedIdx = options.indexOf(value);
  const padCount = Math.floor(VISIBLE_COUNT / 2);

  useEffect(() => {
    if (listRef.current && selectedIdx >= 0) {
      listRef.current.scrollTop = selectedIdx * ITEM_HEIGHT;
    }
  }, []);

  const snapToNearest = () => {
    if (!listRef.current) return;
    const scrollTop = listRef.current.scrollTop;
    const idx = Math.round(scrollTop / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(idx, options.length - 1));
    listRef.current.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: 'smooth' });
    if (options[clamped] !== value) {
      onChange(options[clamped]);
    }
  };

  const handleScroll = () => {
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(snapToNearest, 80);
  };

  const handleClick = (idx) => {
    onChange(options[idx]);
    if (listRef.current) {
      listRef.current.scrollTo({ top: idx * ITEM_HEIGHT, behavior: 'smooth' });
    }
  };

  return (
    <div className="time-wheel" style={{ height: VISIBLE_COUNT * ITEM_HEIGHT }}>
      <div className="time-wheel-highlight" style={{ top: padCount * ITEM_HEIGHT, height: ITEM_HEIGHT }} />
      <div
        className="time-wheel-list"
        ref={listRef}
        onScroll={handleScroll}
      >
        <div style={{ height: padCount * ITEM_HEIGHT, flexShrink: 0 }} />
        {options.map((t, i) => (
          <div
            key={t}
            className={`time-wheel-item ${t === value ? 'time-wheel-item-active' : ''}`}
            style={{ height: ITEM_HEIGHT, lineHeight: ITEM_HEIGHT + 'px' }}
            onClick={() => handleClick(i)}
          >
            {t}
          </div>
        ))}
        <div style={{ height: padCount * ITEM_HEIGHT, flexShrink: 0 }} />
      </div>
    </div>
  );
}

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00'
];

function LabReservation() {
  const { user } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingReservation, setEditingReservation] = useState(null);
  const [editingConclusionId, setEditingConclusionId] = useState(null);
  const [conclusionText, setConclusionText] = useState('');
  const [formData, setFormData] = useState({
    experimenter: '',
    startTime: '13:00',
    endTime: '17:00',
    purpose: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [slideDir, setSlideDir] = useState('');
  const [activeTeam, setActiveTeam] = useState('control');

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getReservations(monthStr, activeTeam);
      setReservations(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [monthStr, activeTeam]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  // Calendar helpers
  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfWeek = (y, m) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const prevMonth = () => { setSlideDir('left'); setCurrentDate(new Date(year, month - 1, 1)); };
  const nextMonth = () => { setSlideDir('right'); setCurrentDate(new Date(year, month + 1, 1)); };
  const goToday = () => { setSlideDir(''); setCurrentDate(new Date()); };

  const formatDateStr = (day) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const getReservationsForDay = (day) => {
    const dateStr = formatDateStr(day);
    return reservations.filter(r => r.date === dateStr);
  };

  const isToday = (day) => {
    const today = new Date();
    return year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
  };

  const isPast = (day) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const check = new Date(year, month, day);
    return check < today;
  };

  const handleDayClick = (day) => {
    const dateStr = formatDateStr(day);
    setSelectedDate(dateStr);
    const dayReservations = getReservationsForDay(day);
    if (dayReservations.length > 0) {
      setShowDetailModal(true);
    } else if (!isPast(day)) {
      setFormData({ experimenter: '', startTime: '13:00', endTime: '17:00', purpose: '' });
      setEditingReservation(null);
      setShowBookingModal(true);
    }
  };

  const handleConclusionEdit = (reservation) => {
    setEditingConclusionId(reservation.id);
    setConclusionText(reservation.conclusion || '');
  };

  const handleConclusionSave = async (id) => {
    try {
      await updateReservation(id, { conclusion: conclusionText });
      setEditingConclusionId(null);
      fetchReservations();
    } catch (err) {
      alert(err.message);
    }
  };

  const openBookingFromDetail = () => {
    setShowDetailModal(false);
    setFormData({ experimenter: '', startTime: '13:00', endTime: '17:00', purpose: '' });
    setEditingReservation(null);
    setShowBookingModal(true);
  };

  const handleBookingSubmit = async (e) => {
    e.preventDefault();

    if (formData.startTime >= formData.endTime) {
      alert('结束时间必须晚于开始时间');
      return;
    }

    setSubmitting(true);
    try {
      if (editingReservation) {
        await updateReservation(editingReservation.id, {
          experimenter: formData.experimenter,
          purpose: formData.purpose,
          startTime: formData.startTime,
          endTime: formData.endTime
        });
      } else {
        await createReservation({
          date: selectedDate,
          startTime: formData.startTime,
          endTime: formData.endTime,
          experimenter: formData.experimenter,
          purpose: formData.purpose,
          team: activeTeam
        });
      }
      setShowBookingModal(false);
      fetchReservations();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定取消此预约？')) return;
    try {
      await deleteReservation(id);
      fetchReservations();
      // 如果是从详情弹窗删除，检查是否还有预约
      const remaining = reservations.filter(r => r.date === selectedDate && r.id !== id);
      if (remaining.length === 0) setShowDetailModal(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEditPurpose = (reservation) => {
    setEditingReservation(reservation);
    setFormData({
      experimenter: reservation.experimenter,
      startTime: reservation.start_time,
      endTime: reservation.end_time,
      purpose: reservation.purpose || ''
    });
    setShowDetailModal(false);
    setShowBookingModal(true);
  };

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  // Build calendar cells
  const calendarCells = [];
  for (let i = 0; i < firstDay; i++) {
    calendarCells.push(<div key={`empty-${i}`} className="cal-cell cal-cell-empty"></div>);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dayRes = getReservationsForDay(day);
    const past = isPast(day);
    const today = isToday(day);

    calendarCells.push(
      <div
        key={day}
        className={`cal-cell ${today ? 'cal-cell-today' : ''} ${past ? 'cal-cell-past' : ''} ${dayRes.length > 0 ? 'cal-cell-booked' : ''} ${selectedDate === formatDateStr(day) ? 'cal-cell-selected' : ''}`}
        onClick={() => handleDayClick(day)}
      >
        <div className="cal-day-number">{day}</div>
        {dayRes.length > 0 && (
          <div className="cal-day-bookings">
            {dayRes.slice(0, 2).map((r, i) => (
              <div key={i} className="cal-booking-tag">
                <span className="cal-booking-dot"></span>
                <span className="cal-booking-text">{r.experimenter}</span>
                <span className="cal-booking-time">{r.start_time}-{r.end_time}</span>
              </div>
            ))}
            {dayRes.length > 2 && (
              <div className="cal-booking-more">+{dayRes.length - 2} 更多</div>
            )}
          </div>
        )}
      </div>
    );
  }

  const selectedDayReservations = selectedDate
    ? reservations.filter(r => r.date === selectedDate)
    : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 className="page-title" style={{ marginBottom: 0 }}>🔬 实验室预约</h2>
          <div className="team-switcher">
            <button className={`team-btn ${activeTeam === 'control' ? 'team-btn-active' : ''}`} onClick={() => setActiveTeam('control')}>控制组</button>
            <button className={`team-btn ${activeTeam === 'power' ? 'team-btn-active' : ''}`} onClick={() => setActiveTeam('power')}>动力组</button>
          </div>
        </div>
      </div>

      <div className="team-content-transition" key={activeTeam}>
      {/* Calendar Navigation */}
      <div className="cal-nav">
        <button className="btn btn-ghost cal-nav-btn" onClick={prevMonth}>◀</button>
        <div className="cal-nav-title">
          <span className="cal-nav-year">{year}年</span>
          <span className="cal-nav-month">{monthNames[month]}</span>
        </div>
        <button className="btn btn-ghost cal-nav-btn" onClick={nextMonth}>▶</button>
        <button className="btn btn-ghost" onClick={goToday} style={{ marginLeft: '1rem', fontSize: '0.85rem' }}>今天</button>
      </div>

      {/* Calendar Grid */}
      <div className="cal-grid glass-panel" style={{ padding: '1.5rem' }}>
        {/* Week header */}
        <div className="cal-header">
          {weekDays.map(d => (
            <div key={d} className="cal-header-cell">{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className={`cal-body ${slideDir === 'left' ? 'cal-slide-left' : slideDir === 'right' ? 'cal-slide-right' : ''}`} key={monthStr}>
          {loading ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>加载中...</div>
          ) : calendarCells}
        </div>
      </div>

      {/* Legend */}
      <div className="cal-legend">
        <div className="cal-legend-item">
          <span className="cal-legend-dot" style={{ background: 'var(--primary-color)' }}></span>
          <span>已预约</span>
        </div>
        <div className="cal-legend-item">
          <span className="cal-legend-dot" style={{ background: 'rgba(255,255,255,0.15)' }}></span>
          <span>可预约</span>
        </div>
        <div className="cal-legend-item">
          <span className="cal-legend-dot" style={{ background: 'rgba(255,255,255,0.05)' }}></span>
          <span>已过期</span>
        </div>
      </div>

      {/* Booking Modal */}
      {showBookingModal && (
        <div className="reservation-modal-overlay" onClick={() => setShowBookingModal(false)}>
          <div className="reservation-modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>{editingReservation ? '✏️ 编辑预约' : '🔬 新建预约'}</h3>
              <button className="btn btn-ghost" onClick={() => setShowBookingModal(false)}>✕</button>
            </div>

            <div style={{ marginBottom: '1rem', padding: '0.6rem 1rem', background: 'rgba(0,240,255,0.06)', borderRadius: '6px', border: '1px solid var(--glass-border)', fontSize: '0.9rem', color: 'var(--primary-color)' }}>
              📅 {selectedDate}
            </div>

            <form onSubmit={handleBookingSubmit}>
              <div className="input-group">
                <label>实验人员 *</label>
                <input
                  required
                  type="text"
                  className="input-field"
                  placeholder="输入实验人员姓名"
                  value={formData.experimenter}
                  onChange={e => setFormData({ ...formData, experimenter: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label>开始时间 *</label>
                  <TimeWheelPicker
                    options={TIME_SLOTS.slice(0, -1)}
                    value={formData.startTime}
                    onChange={v => setFormData({ ...formData, startTime: v })}
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label>结束时间 *</label>
                  <TimeWheelPicker
                    options={TIME_SLOTS.slice(1)}
                    value={formData.endTime}
                    onChange={v => setFormData({ ...formData, endTime: v })}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>实验目的 <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>(可稍后补写)</span></label>
                <textarea
                  className="input-field"
                  style={{ height: '80px', resize: 'vertical' }}
                  placeholder="可以暂时留空，之后规划好再补写"
                  value={formData.purpose}
                  onChange={e => setFormData({ ...formData, purpose: e.target.value })}
                ></textarea>
              </div>

              {/* 显示该日已有预约的时间段 */}
              {!editingReservation && selectedDayReservations.length > 0 && (
                <div style={{ marginBottom: '1rem', padding: '0.8rem', background: 'rgba(212,92,92,0.08)', border: '1px solid rgba(212,92,92,0.2)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--danger-color)', marginBottom: '0.4rem' }}>⚠️ 该日已有预约：</div>
                  {selectedDayReservations.map((r, i) => (
                    <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.2rem 0' }}>
                      {r.start_time} - {r.end_time}（{r.experimenter}）
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowBookingModal(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? '提交中...' : (editingReservation ? '保存修改' : '确认预约')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedDate && (
        <div className="reservation-modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="reservation-modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>{selectedDate} 预约详情</h3>
              <button className="btn btn-ghost" onClick={() => setShowDetailModal(false)}>✕</button>
            </div>

            <div className="reservation-detail-list">
              {selectedDayReservations.map(r => (
                <div key={r.id} className="reservation-detail-item">
                  <div className="reservation-detail-header">
                    <div className="reservation-detail-time">
                      <span className="reservation-time-badge">{r.start_time} - {r.end_time}</span>
                    </div>
                    <div className="reservation-detail-meta">
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>预约人: {r.booker_name}</span>
                    </div>
                  </div>
                  <div className="reservation-detail-body">
                    <div className="reservation-detail-row">
                      <span className="reservation-label">实验人员</span>
                      <span className="reservation-value">{r.experimenter}</span>
                    </div>
                    <div className="reservation-detail-row">
                      <span className="reservation-label">实验目的</span>
                      <span className="reservation-value" style={{ color: r.purpose ? 'var(--text-color)' : 'var(--text-muted)' }}>
                        {r.purpose || '暂未填写'}
                      </span>
                    </div>
                    <div className="reservation-detail-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span className="reservation-label" style={{ marginBottom: 0 }}>实验结论</span>
                        {(r.user_id === user.id || user.role === 'admin') && editingConclusionId !== r.id && (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                            onClick={() => handleConclusionEdit(r)}
                          >
                            {r.conclusion ? '修改' : '填写'}
                          </button>
                        )}
                      </div>
                      {editingConclusionId === r.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <textarea
                            className="input-field"
                            style={{ height: '80px', resize: 'vertical', fontSize: '0.85rem' }}
                            placeholder="填写实验结论..."
                            value={conclusionText}
                            onChange={e => setConclusionText(e.target.value)}
                            autoFocus
                          />
                          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={() => setEditingConclusionId(null)}>取消</button>
                            <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={() => handleConclusionSave(r.id)}>保存</button>
                          </div>
                        </div>
                      ) : (
                        <span className="reservation-value" style={{ color: r.conclusion ? 'var(--text-color)' : 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                          {r.conclusion || '暂未填写'}
                        </span>
                      )}
                    </div>
                  </div>
                  {(r.user_id === user.id || user.role === 'admin') && (
                    <div className="reservation-detail-actions">
                      <button className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={() => handleEditPurpose(r)}>
                        编辑
                      </button>
                      <button className="btn btn-danger" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={() => handleDelete(r.id)}>
                        取消预约
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!isPast(parseInt(selectedDate.split('-')[2])) && (
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={openBookingFromDetail}>
                  + 在此日期添加预约
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default LabReservation;
