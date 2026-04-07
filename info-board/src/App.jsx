import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const ADMIN_ID = 'admin'
const ADMIN_PW = 'admin1234'
const CONTACT_PHONE = '010-2930-3705'
const CATEGORIES = ['전체', '사업개요', '사업정보', '입지환경', '접수처', 'Q & A', '문의사항']

function catClass(cat) {
  const map = {
    '공지': 'cat-공지', '사업개요': 'cat-사업개요', '사업정보': 'cat-사업정보',
    '입지환경': 'cat-입지환경', '접수처': 'cat-접수처', 'Q & A': 'cat-QA', '문의사항': 'cat-기타',
  }
  return map[cat] || 'cat-기타'
}

/* ── 이미지 목록 ── */
function ImageList({ images }) {
  if (!images || images.length === 0) return null
  return (
    <div className="post-images-list">
      {images.map((src, i) => (
        <div key={i} className="post-image-item">
          <img src={src} alt="" className="full-res-img" />
        </div>
      ))}
    </div>
  )
}

/* ── 답글 영역 (문의사항 전용) ── */
function ReplySection({ post, isAdmin, apiUrl, onRefresh }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submitReply(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    try {
      await fetch(`${apiUrl}/${post.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text.trim() }),
      })
      setText('')
      onRefresh()
    } catch (err) { console.error(err) }
    finally { setSubmitting(false) }
  }

  async function deleteReply(replyId) {
    if (!window.confirm('답글을 삭제하시겠습니까?')) return
    try {
      const base = apiUrl.replace('/api/posts', '')
      await fetch(`${base}/api/replies/${replyId}`, { method: 'DELETE' })
      onRefresh()
    } catch (err) { console.error(err) }
  }

  const replies = post.replies || []

  return (
    <div className="reply-section">
      {replies.length > 0 && (
        <ul className="reply-list">
          {replies.map(r => (
            <li key={r.id} className="reply-item">
              <span className="reply-admin-label">관리자</span>
              <span className="reply-content">{r.content}</span>
              <span className="reply-date">
                {new Date(r.created_at).toLocaleString('ko-KR', {
                  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                })}
              </span>
              {isAdmin && (
                <button className="btn btn-danger btn-xs reply-del" onClick={() => deleteReply(r.id)}>삭제</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <form className="reply-form" onSubmit={submitReply}>
          <textarea
            className="reply-input"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="답글을 입력하세요..."
            rows={2}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting || !text.trim()}>
            {submitting ? '등록 중...' : '답글 등록'}
          </button>
        </form>
      )}
    </div>
  )
}

/* ── 게시물 카드 (전체탭: 항상 펼침) ── */
function PostCard({ post, isAdmin, isFirst, isLast, onEdit, onDelete, onMove, apiUrl, onRefresh }) {
  const isPublic = post.is_public_post
  return (
    <article className={`post-card${isPublic ? ' post-card-public' : ''}`}>
      <div className="post-card-head">
        <span className={`cat-tag ${catClass(post.category)}`}>{post.category}</span>
        {isPublic && <span className="public-badge">비밀글</span>}
        <div className="post-card-meta">
          <span>{post.author}</span>
          <span className="meta-sep">·</span>
          <span>{post.date}{post.time ? ` ${post.time}` : ''}</span>
          {isAdmin && post.masked_ip && (
            <span className="meta-ip">IP: {post.masked_ip}</span>
          )}
        </div>
      </div>
      <h2 className="post-card-title">{post.title}</h2>
      <div className={`post-card-body${isPublic && !isAdmin ? ' content-locked' : ''}`}>
        {post.content}
      </div>
      {!isPublic && post.images && post.images.length > 0 && (
        <ImageList images={post.images} />
      )}
      {isPublic && (
        <ReplySection post={post} isAdmin={isAdmin} apiUrl={apiUrl} onRefresh={onRefresh} />
      )}
      {isAdmin && (
        <div className="post-card-admin">
          <button className="btn btn-order btn-sm" onClick={() => onMove(post.id, 'up')} disabled={isFirst}>▲</button>
          <button className="btn btn-order btn-sm" onClick={() => onMove(post.id, 'down')} disabled={isLast}>▼</button>
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(post.id)}>삭제</button>
          {!isPublic && <button className="btn btn-secondary btn-sm" onClick={() => onEdit(post)}>수정</button>}
        </div>
      )}
    </article>
  )
}

/* ── 게시물 아코디언 행 (문의사항탭) ── */
function PostAccordion({ post, idx, total, isFirst, isLast, isAdmin, onEdit, onDelete, onMove, apiUrl, onRefresh }) {
  const [open, setOpen] = useState(false)
  const isPublic = post.is_public_post
  const hasReply = (post.replies?.length || 0) > 0
  return (
    <li className={`post-item${post.category === '공지' ? ' is-notice' : ''}${open ? ' is-open' : ''}${isPublic ? ' is-public-post' : ''}`}>
      <div className="post-row" onClick={() => setOpen(o => !o)}>
        <div className="post-row-left">
          <span className="post-num">
            {post.category === '공지'
              ? <span className="cat-tag cat-공지" style={{ fontSize: 10 }}>공지</span>
              : total - idx
            }
          </span>
          <span className={`cat-tag ${catClass(post.category)}`}>{post.category}</span>
          {isPublic && <span className="lock-icon">🔒</span>}
          <span className="post-title-text">{post.title}</span>
          {hasReply && <span className="reply-badge">{post.replies.length}</span>}
        </div>
        <div className="post-row-right">
          <span className="post-date">{post.date}{post.time ? ` ${post.time}` : ''}</span>
          <span className={`accordion-arrow${open ? ' open' : ''}`}>›</span>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
              <button className="btn btn-order btn-sm" onClick={() => onMove(post.id, 'up')} disabled={isFirst}>▲</button>
              <button className="btn btn-order btn-sm" onClick={() => onMove(post.id, 'down')} disabled={isLast}>▼</button>
              {!isPublic && <button className="btn btn-secondary btn-sm" onClick={() => onEdit(post)}>수정</button>}
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(post.id)}>삭제</button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="post-detail-inline">
          <div className="detail-inner">
            <h2 className="detail-title-lg">{post.title}</h2>
            <div className="detail-meta">
              <span className={`cat-tag ${catClass(post.category)}`}>{post.category}</span>
              <span className="meta-sep">|</span>
              <span>{post.author}</span>
              <span className="meta-sep">|</span>
              <span>{post.date}{post.time ? ` ${post.time}` : ''}</span>
              {isAdmin && post.masked_ip && (
                <><span className="meta-sep">|</span><span className="meta-ip">IP: {post.masked_ip}</span></>
              )}
            </div>
            <div className={`detail-body${isPublic && !isAdmin ? ' content-locked' : ''}`}>
              {post.content}
            </div>
            {!isPublic && post.images && post.images.length > 0 && <ImageList images={post.images} />}
            <ReplySection post={post} isAdmin={isAdmin} apiUrl={apiUrl} onRefresh={onRefresh} />
            {isAdmin && (
              <div className="detail-admin-bar">
                <button className="btn btn-danger btn-sm" onClick={() => onDelete(post.id)}>삭제</button>
                {!isPublic && <button className="btn btn-secondary btn-sm" onClick={() => onEdit(post)}>수정</button>}
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/* ── 문의사항 글쓰기 드로어 ── */
function PublicPostDrawer({ onClose, onSaved, apiBaseUrl }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [author, setAuthor] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!title.trim() || !content.trim() || !password.trim()) {
      return setError('제목, 내용, 비밀번호를 모두 입력해주세요.')
    }
    if (password !== confirmPw) {
      return setError('비밀번호가 일치하지 않습니다.')
    }
    if (password.length < 4) {
      return setError('비밀번호는 4자리 이상 입력해주세요.')
    }
    setLoading(true)
    try {
      const res = await fetch(`${apiBaseUrl}/api/posts/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), author: author.trim(), password })
      })
      if (res.ok) {
        onSaved()
        onClose()
      } else {
        const data = await res.json()
        setError(data.error || '등록 중 오류가 발생했습니다.')
      }
    } catch {
      setError('서버에 연결할 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-handle" />
        <div className="drawer-head">
          <h3>문의사항 작성</h3>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          <div className="public-post-notice">
            내용은 암호화되어 저장되며 <strong>관리자만 확인</strong>할 수 있습니다.
          </div>
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={submit}>
            <div className="form-group">
              <label>작성자 <span className="label-optional">(선택)</span></label>
              <input type="text" value={author} onChange={e => setAuthor(e.target.value)}
                maxLength={20} placeholder="익명" />
            </div>
            <div className="form-group">
              <label>제목</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                maxLength={100} required autoFocus placeholder="제목을 입력하세요" />
            </div>
            <div className="form-group">
              <label>내용</label>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                required placeholder="내용을 입력하세요" />
            </div>
            <div className="form-group">
              <label>비밀번호 <span className="label-required">*</span></label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                required placeholder="비밀번호 (4자리 이상)" />
            </div>
            <div className="form-group">
              <label>비밀번호 확인 <span className="label-required">*</span></label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                required placeholder="비밀번호 재입력" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary btn-full" onClick={onClose}>취소</button>
              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? '등록 중...' : '등록'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ── 글쓰기/수정 드로어 (관리자) ── */
function PostDrawer({ post, onClose, onSave }) {
  const [title, setTitle] = useState(post?.title || '')
  const [content, setContent] = useState(post?.content || '')
  const [category, setCategory] = useState(post?.category || '사업정보')
  const [images, setImages] = useState(post?.images || [])
  const fileRef = useRef()

  function handleFiles(e) {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => setImages(prev => [...prev, ev.target.result])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  function submit(e) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    onSave({ title: title.trim(), content: content.trim(), category, images })
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-handle" />
        <div className="drawer-head">
          <h3>{post ? '게시물 수정' : '게시물 작성'}</h3>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          <form onSubmit={submit}>
            <div className="form-group">
              <label>분류</label>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.filter(c => c !== '전체' && c !== '문의사항').map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>제목</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                maxLength={100} required autoFocus placeholder="제목을 입력하세요" />
            </div>
            <div className="form-group">
              <label>내용</label>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                required placeholder="내용을 입력하세요" />
            </div>
            <div className="form-group">
              <label>이미지 첨부</label>
              <input ref={fileRef} type="file" accept="image/*" multiple
                style={{ display: 'none' }} onChange={handleFiles} />
              <button type="button" className="btn btn-secondary btn-full"
                onClick={() => fileRef.current.click()}>+ 이미지 선택</button>
              {images.length > 0 && (
                <div className="upload-preview">
                  {images.map((src, i) => (
                    <div key={i} className="upload-thumb">
                      <img src={src} alt="" />
                      <button type="button" className="upload-remove"
                        onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary btn-full" onClick={onClose}>취소</button>
              <button type="submit" className="btn btn-primary btn-full">{post ? '수정 완료' : '등록'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ── 로그인 드로어 ── */
function LoginDrawer({ onClose, onLogin }) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (id === ADMIN_ID && pw === ADMIN_PW) { onLogin() }
    else { setError('아이디 또는 비밀번호가 올바르지 않습니다.') }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-handle" />
        <div className="drawer-head">
          <h3>관리자 로그인</h3>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={submit}>
            <div className="form-group">
              <label>아이디</label>
              <input type="text" value={id} onChange={e => setId(e.target.value)} autoFocus placeholder="아이디" />
            </div>
            <div className="form-group">
              <label>비밀번호</label>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="비밀번호" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary btn-full" onClick={onClose}>취소</button>
              <button type="submit" className="btn btn-primary btn-full">로그인</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ── App ── */
export default function App() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState('전체')

  const [showLogin, setShowLogin] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showPublicForm, setShowPublicForm] = useState(false)
  const [editingPost, setEditingPost] = useState(null)

  const BASE_URL = import.meta.env.VITE_API_URL || 'https://boramae-public-production.up.railway.app'
  const API_URL = `${BASE_URL}/api/posts`

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const url = isAdmin ? `${API_URL}?admin=1` : API_URL
      const res = await fetch(url)
      const data = await res.json()
      setPosts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('데이터를 가져오는데 실패했습니다:', err)
    } finally {
      setLoading(false)
    }
  }, [isAdmin, API_URL])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  const filtered = activeTab === '전체'
    ? posts.filter(p => p.category !== '문의사항')
    : posts.filter(p => p.category === activeTab)

  function tabCount(cat) {
    if (cat === '전체') return posts.filter(p => p.category !== '문의사항').length
    return posts.filter(p => p.category === cat).length
  }

  function handleLogin() { setIsAdmin(true); setShowLogin(false) }
  function handleLogout() { setIsAdmin(false) }

  async function handleSave({ title, content, category, images }) {
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const time = now.toTimeString().slice(0, 5)

    if (editingPost) {
      try {
        const res = await fetch(`${API_URL}/${editingPost.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, category, images })
        })
        if (res.ok) fetchPosts()
      } catch (err) { console.error(err) }
    } else {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, category, images, author: '관리자', date: today, time })
        })
        if (res.ok) fetchPosts()
      } catch (err) { console.error(err) }
    }
    setShowForm(false)
    setEditingPost(null)
  }

  async function handleMove(id, direction) {
    try {
      const res = await fetch(`${API_URL}/${id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction })
      })
      if (res.ok) fetchPosts()
    } catch (err) { console.error(err) }
  }

  async function handleDelete(id) {
    if (window.confirm('삭제하시겠습니까?')) {
      try {
        const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' })
        if (res.ok) fetchPosts()
      } catch (err) { console.error(err) }
    }
  }

  function openEdit(post) {
    setEditingPost(post)
    setShowForm(true)
  }

  const telHref = `tel:${CONTACT_PHONE.replace(/[^0-9]/g, '')}`
  const isInquiryTab = activeTab === '문의사항'

  return (
    <>
      {/* 헤더 */}
      <header className="header">
        <div className="header-inner">
          <div className="site-title">
            보라매 도심 공공주택 복합사업
            <small>신대방동 360-17번지 정보공유</small>
          </div>
          <div className="header-right">
            <a className="btn btn-call" href={telHref}>
              <span className="call-icon">📞</span>
              <span className="call-text">연락하기</span>
            </a>
            {isAdmin ? (
              <>
                <span className="admin-badge">관리자</span>
                <button className="btn btn-ghost" onClick={handleLogout}>로그아웃</button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setShowLogin(true)}>관리자</button>
            )}
          </div>
        </div>
      </header>

      {/* 탭 */}
      <nav className="nav-bar">
        <div className="nav-inner">
          {CATEGORIES.map(cat => (
            <button key={cat}
              className={`nav-tab${activeTab === cat ? ' active' : ''}`}
              onClick={() => setActiveTab(cat)}
            >
              {cat}
              {tabCount(cat) > 0 && <span className="tab-badge">{tabCount(cat)}</span>}
            </button>
          ))}
        </div>
      </nav>

      {/* 본문 */}
      <div className="page-wrap">
        {/* 문의사항탭: 글쓰기 버튼 (비로그인도 가능) */}
        {isInquiryTab && !isAdmin && (
          <div className="public-write-bar">
            <button className="btn btn-primary" onClick={() => setShowPublicForm(true)}>
              문의하기
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading-row">
            <span className="loading-spinner" />
            데이터를 불러오는 중...
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-row">등록된 게시물이 없습니다.</div>
        ) : isInquiryTab ? (
          <ul className="post-list">
            {filtered.map((post, idx) => (
              <PostAccordion
                key={post.id}
                post={post}
                idx={idx}
                total={filtered.length}
                isAdmin={isAdmin}
                isFirst={idx === 0}
                isLast={idx === filtered.length - 1}
                onEdit={openEdit}
                onDelete={handleDelete}
                onMove={handleMove}
                apiUrl={API_URL}
                onRefresh={fetchPosts}
              />
            ))}
          </ul>
        ) : (
          <div className="card-feed">
            {filtered.map((post, idx) => (
              <PostCard
                key={post.id}
                post={post}
                isAdmin={isAdmin}
                isFirst={idx === 0}
                isLast={idx === filtered.length - 1}
                onEdit={openEdit}
                onDelete={handleDelete}
                onMove={handleMove}
                apiUrl={API_URL}
                onRefresh={fetchPosts}
              />
            ))}
          </div>
        )}
      </div>

      {/* 푸터 */}
      <footer className="footer">
        <div className="footer-contact">
          <a href={telHref} className="footer-tel">📞 {CONTACT_PHONE}</a>
          <span className="footer-tel-desc">문의사항은 전화로 연락 주세요</span>
        </div>
        <div className="footer-copy">
          © 2026 보라매 신속통합개발 정보공유 · 본 사이트의 정보는 참고용으로만 활용하시기 바랍니다.
        </div>
      </footer>

      {/* 관리자 FAB */}
      {isAdmin && (
        <button className="fab" onClick={() => { setEditingPost(null); setShowForm(true) }}>+</button>
      )}

      {showLogin && <LoginDrawer onClose={() => setShowLogin(false)} onLogin={handleLogin} />}
      {showPublicForm && (
        <PublicPostDrawer
          onClose={() => setShowPublicForm(false)}
          onSaved={fetchPosts}
          apiBaseUrl={BASE_URL}
        />
      )}
      {showForm && (
        <PostDrawer
          post={editingPost}
          onClose={() => { setShowForm(false); setEditingPost(null) }}
          onSave={handleSave}
        />
      )}
    </>
  )
}
