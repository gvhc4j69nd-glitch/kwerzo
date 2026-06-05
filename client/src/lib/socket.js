import { io } from 'socket.io-client';

const URL = import.meta.env.PROD ? '/' : 'http://localhost:3002';

let socket = null;

export function getSocket(token) {
  if (!socket || !socket.connected) {
    socket = io(URL, { auth: { token }, autoConnect: false });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
