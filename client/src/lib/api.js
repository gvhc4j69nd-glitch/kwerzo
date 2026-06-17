const BASE = import.meta.env.PROD ? '/api' : 'http://localhost:3002/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('kwerzo_token');
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...options
  });
  const data = await res.json();
  if (res.status === 401) {
    localStorage.removeItem('kwerzo_token');
    localStorage.removeItem('kwerzo_user');
    window.location.reload();
    return;
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  register:  (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login:     (body) => request('/auth/login',    { method: 'POST', body: JSON.stringify(body) }),
  leaderboard: ()   => request('/leaderboard'),
  health:      ()   => request('/health'),

  searchUsers:        (q)            => request(`/friends/search?q=${encodeURIComponent(q)}`),
  getFriends:         ()             => request('/friends'),
  sendFriendRequest:  (username)     => request('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),
  respondFriendReq:   (id, action)   => request('/friends/respond', { method: 'POST', body: JSON.stringify({ id, action }) }),
  removeFriend:       (id)           => request(`/friends/${id}`, { method: 'DELETE' }),
};
